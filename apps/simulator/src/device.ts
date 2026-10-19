import mqtt, { type MqttClient } from 'mqtt';
import type { Logger } from 'pino';
import { parseCommand, topic, type Ack, type SeedDevice } from '@nabd/shared';
import type { Fleet } from './fleet.js';
import type { Rng } from './models.js';
import type { SeqStore } from './seq-store.js';

export interface DeviceOptions {
  device: SeedDevice;
  password: string;
  mqttUrl: string;
  fleet: Fleet;
  seq: SeqStore;
  log: Logger;
  rng?: Rng;
  /** Share of commands that get no reply at all, to exercise the API's 10 s timeout. */
  timeoutRate?: number;
}

/** Typical signal strength per device (from the design), with a little jitter per status message. */
const BASE_RSSI: Record<string, number> = { 'nabd-01': -61, 'nabd-04': -68, 'nabd-05': -70, 'nabd-07': -57 };

/**
 * One virtual device. It speaks exactly the firmware's protocol: its own credentials, a Last Will on
 * `…/status`, a retained online status, telemetry every tick, and two-step command acknowledgements.
 */
export class SimDevice {
  private client: MqttClient | null = null;
  private bootedAt = Date.now();
  private bootReason = 'power_on';
  private readonly rng: Rng;
  readonly stats = { published: 0, commands: 0 };

  constructor(private readonly o: DeviceOptions) {
    this.rng = o.rng ?? Math.random;
  }

  get id(): string {
    return this.o.device.id;
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  private t(leaf: Parameters<typeof topic>[2]): string {
    return topic(this.o.device.siteSlug, this.o.device.id, leaf);
  }

  connect(): void {
    if (this.client) return;
    const client = mqtt.connect(this.o.mqttUrl, {
      clientId: this.id,
      username: this.id,
      password: this.o.password,
      // MQTT 3.1.1, the same as the firmware. The contract needs nothing from MQTT 5, and EMQX shared
      // subscriptions work with 3.1.1 clients.
      protocolVersion: 4,
      keepalive: 30,
      clean: true,
      // Spread reconnects so 12 devices do not hit the broker in the same instant.
      reconnectPeriod: 1000 + Math.floor(this.rng() * 2000),
      will: { topic: this.t('status'), payload: Buffer.from('{"online":false}'), qos: 1, retain: true },
    });
    this.client = client;

    client.on('connect', () => {
      this.o.log.info({ device: this.id }, 'connected');
      this.publishStatus();
      client.subscribe([this.t('cmd'), this.t('ota')], { qos: 1 });
    });
    client.on('message', (t, payload) => {
      if (t === this.t('cmd')) this.onCommand(payload);
      else if (t === this.t('ota'))
        this.o.log.info({ device: this.id }, 'ota offer ignored (simulated device)');
    });
    client.on('error', (err) => this.o.log.warn({ device: this.id, err: err.message }, 'mqtt error'));
  }

  /** Drops the link without a DISCONNECT packet, so the broker publishes the Last Will (offline). */
  dropLink(): void {
    if (!this.client) return;
    this.client.stream?.destroy();
    this.client.end(true);
    this.client = null;
  }

  /** Clean shutdown: mark offline ourselves, then disconnect. */
  async close(): Promise<void> {
    const client = this.client;
    if (!client) return;
    this.client = null;
    if (client.connected) {
      await client
        .publishAsync(this.t('status'), '{"online":false}', { qos: 1, retain: true })
        .catch(() => {});
    }
    await client.endAsync();
  }

  publishTelemetry(at: Date): void {
    const client = this.client;
    if (!client?.connected) return;
    const m = this.o.fleet.metricsFor(this.id);
    if (Object.keys(m).length === 0) return;
    const payload = JSON.stringify({ seq: this.o.seq.take(this.id), ts: at.toISOString(), m });
    client.publish(this.t('telemetry'), payload, { qos: 1 });
    this.stats.published++;
  }

  private publishStatus(): void {
    const rssi = (BASE_RSSI[this.id] ?? -66) + Math.round((this.rng() * 2 - 1) * 2);
    const status = {
      online: true,
      fw: this.o.device.fw,
      rssi,
      uptime_s: Math.floor((Date.now() - this.bootedAt) / 1000),
      boot_reason: this.bootReason,
      profile: this.o.device.profile,
    };
    this.client?.publish(this.t('status'), JSON.stringify(status), { qos: 1, retain: true });
  }

  /** Refreshes the retained status (uptime, signal) once a minute, as the firmware does. */
  heartbeat(): void {
    if (this.connected) this.publishStatus();
  }

  private ack(ack: Ack): void {
    this.client?.publish(this.t('cmd/ack'), JSON.stringify(ack), { qos: 1 });
  }

  private onCommand(payload: Buffer): void {
    this.stats.commands++;
    const parsed = parseCommand(payload);
    if (!parsed.ok) {
      // Answer only if there is an id to answer to; anything else is noise.
      const id = (() => {
        try {
          return (JSON.parse(payload.toString()) as { id?: unknown }).id;
        } catch {
          return undefined;
        }
      })();
      if (typeof id === 'string' && /^c-[A-Za-z0-9-]{1,40}$/.test(id)) {
        this.ack({ id, state: 'rejected', reason: 'invalid' });
      }
      return;
    }
    const cmd = parsed.value;
    if (Date.parse(cmd.exp) < Date.now()) {
      this.ack({ id: cmd.id, state: 'rejected', reason: 'expired' });
      return;
    }
    if (cmd.op === 'relay.set' && !(this.o.device.relays as readonly number[]).includes(cmd.args.ch)) {
      this.ack({ id: cmd.id, state: 'rejected', reason: 'no_such_relay' });
      return;
    }
    if (this.rng() < (this.o.timeoutRate ?? 0)) {
      this.o.log.info({ device: this.id, cmd: cmd.id }, 'dropping command on purpose (timeout test)');
      return;
    }

    // Realistic timings: delivered ≈ 300–450 ms, done ≈ 800–1000 ms after the command arrives.
    const deliveredMs = 300 + this.rng() * 150;
    const doneMs = 800 + this.rng() * 200;
    setTimeout(() => this.ack({ id: cmd.id, state: 'delivered' }), deliveredMs);
    setTimeout(() => {
      if (cmd.op === 'relay.set') {
        this.o.fleet.setRelay(this.id, cmd.args.ch, cmd.args.on);
        this.ack({
          id: cmd.id,
          state: 'done',
          relay: { ch: cmd.args.ch, on: this.o.fleet.relay(this.id, cmd.args.ch) },
        });
      } else {
        this.ack({ id: cmd.id, state: 'done' });
        this.reboot();
      }
    }, doneMs);
  }

  /** Simulated software reboot: link drops, relays fail safe to OFF, and the device is back in ~4 s. */
  private reboot(): void {
    setTimeout(() => {
      void this.close().then(() => {
        this.o.fleet.resetRelays(this.id);
        this.bootedAt = Date.now();
        this.bootReason = 'software';
        setTimeout(() => this.connect(), 4000);
      });
    }, 200);
  }
}
