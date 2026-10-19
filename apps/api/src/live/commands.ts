/**
 * Command dispatch (Phase 3): create the row, publish to `…/cmd` with an expiry, follow the device's acks,
 * and time out after 10 s. Every state change is written to the database and pushed over the WebSocket.
 */
import {
  COMMAND_EXPIRY_MS,
  COMMAND_TIMEOUT_MS,
  SEED_DEVICES,
  TERMINAL_STATES,
  applyAck,
  newCommandId,
  topic,
  type Ack,
  type CommandState,
} from '@nabd/shared';
import type { CommandDto } from '@nabd/shared';
import type { Store } from '../store.js';
import type { Hub } from './hub.js';

export interface Publisher {
  /** Resolves once the broker has acknowledged the publish (QoS 1 PUBACK). */
  publish(topic: string, payload: string): Promise<void>;
}

export interface Actor {
  role: 'admin' | 'viewer' | 'anon';
  name: string;
  ip: string;
}

export interface DeviceInfo {
  siteSlug: string;
  isSimulated: boolean;
}

export type CreateResult =
  | { ok: true; command: CommandDto }
  | { ok: false; status: 400 | 403 | 404 | 429; error: string; message: string };

/** Anonymous and viewer users: at most one command every 3 seconds per IP. */
export const DEMO_COMMAND_INTERVAL_MS = 3000;

export class CommandService {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lastByIp = new Map<string, number>();

  constructor(
    private readonly store: Store,
    private readonly publisher: Publisher,
    private readonly hub: Pick<Hub, 'publish'>,
    private readonly devices: () => ReadonlyMap<string, DeviceInfo>,
    private readonly timeoutMs = COMMAND_TIMEOUT_MS,
  ) {}

  async create(
    deviceId: string,
    body:
      { op: 'relay.set'; args: { ch: 1 | 2; on: boolean } } | { op: 'reboot'; args: Record<string, never> },
    actor: Actor,
  ): Promise<CreateResult> {
    const device = this.devices().get(deviceId);
    if (!device) return { ok: false, status: 404, error: 'not_found', message: `no device ${deviceId}` };

    // Demo isolation: only an admin may command the real board, and only an admin may reboot anything.
    if (actor.role !== 'admin' && (!device.isSimulated || body.op !== 'relay.set')) {
      return {
        ok: false,
        status: 403,
        error: 'forbidden',
        message: device.isSimulated
          ? 'only an admin can reboot a device'
          : 'only an admin can control the real board',
      };
    }
    if (body.op === 'relay.set') {
      const relays = SEED_DEVICES.find((d) => d.id === deviceId)?.relays as readonly number[] | undefined;
      if (relays && !relays.includes(body.args.ch)) {
        return {
          ok: false,
          status: 400,
          error: 'no_such_relay',
          message: `${deviceId} has no relay ${body.args.ch}`,
        };
      }
    }
    if (actor.role !== 'admin') {
      const last = this.lastByIp.get(actor.ip) ?? 0;
      if (Date.now() - last < DEMO_COMMAND_INTERVAL_MS) {
        return {
          ok: false,
          status: 429,
          error: 'rate_limited',
          message: 'one command every 3 seconds in the demo',
        };
      }
      this.lastByIp.set(actor.ip, Date.now());
      if (this.lastByIp.size > 10_000) this.lastByIp.clear(); // bounded memory
    }

    const now = Date.now();
    const id = newCommandId(now);
    const expiresAt = new Date(now + COMMAND_EXPIRY_MS);
    let command = await this.store.createCommand({
      id,
      deviceId,
      op: body.op,
      args: body.args,
      requestedBy: actor.name,
      sourceIp: actor.ip,
      expiresAt,
    });
    this.push(device.siteSlug, command);

    this.timers.set(
      id,
      setTimeout(() => void this.expire(id, deviceId, device.siteSlug), this.timeoutMs),
    );

    const payload = JSON.stringify({ id, op: body.op, args: body.args, exp: expiresAt.toISOString() });
    try {
      await this.publisher.publish(topic(device.siteSlug, deviceId, 'cmd'), payload);
      // An ack can beat the PUBACK; only move forward from pending.
      const current = await this.store.getCommand(id);
      if (current?.state === 'pending') {
        command = (await this.store.updateCommand(id, { state: 'sent', sentAt: new Date() })) ?? command;
        this.push(device.siteSlug, command);
      } else if (current) {
        command = current;
      }
    } catch (error) {
      this.clear(id);
      command =
        (await this.store.updateCommand(id, {
          state: 'rejected',
          error: `broker: ${error instanceof Error ? error.message : String(error)}`,
        })) ?? command;
      this.push(device.siteSlug, command);
    }
    return { ok: true, command };
  }

  /** Applies a `…/cmd/ack` from a device. Stale or out-of-order acks are ignored. */
  async onAck(deviceId: string, ack: Ack): Promise<void> {
    const current = await this.store.getCommand(ack.id);
    if (!current || current.deviceId !== deviceId) return; // a device can only ack its own commands
    const next = applyAck(current.state, ack.state);
    if (!next) return;
    const now = new Date();
    const updated = await this.store.updateCommand(ack.id, {
      state: next,
      ...(next === 'delivered' ? { deliveredAt: now } : {}),
      ...(next === 'done' ? { doneAt: now, result: ack.relay ? { relay: ack.relay } : null } : {}),
      ...(next === 'rejected' ? { error: ack.reason ?? 'rejected by device' } : {}),
      ...(next === 'done' && current.state === 'timeout' ? { error: 'confirmed after the timeout' } : {}),
    });
    if (TERMINAL_STATES.has(next)) this.clear(ack.id);
    const site = this.devices().get(deviceId)?.siteSlug;
    if (updated && site) this.push(site, updated);
  }

  private async expire(id: string, deviceId: string, siteSlug: string): Promise<void> {
    this.timers.delete(id);
    const current = await this.store.getCommand(id);
    if (!current || TERMINAL_STATES.has(current.state)) return;
    const updated = await this.store.updateCommand(id, {
      state: 'timeout' satisfies CommandState,
      error: `no reply from ${deviceId} within ${this.timeoutMs / 1000} s`,
    });
    if (updated) this.push(siteSlug, updated);
  }

  /** On start-up, commands left open by a previous process can never complete; time them out. */
  async recover(): Promise<number> {
    const open = await this.store.openCommands();
    for (const c of open) await this.store.updateCommand(c.id, { state: 'timeout', error: 'api restarted' });
    return open.length;
  }

  private clear(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  private push(siteSlug: string, command: CommandDto) {
    this.hub.publish({ type: 'command', deviceId: command.deviceId, siteSlug, command });
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
