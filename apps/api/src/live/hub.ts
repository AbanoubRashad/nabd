/**
 * WebSocket fan-out (ADR 0005). Clients subscribe to sites or devices; the hub forwards matching events the
 * moment the MQTT bridge sees them, without touching the database. On (re)subscribe a client can send the
 * last `seq` it has per device, and the hub back-fills the gap from `readings`.
 */
import { z } from 'zod';
import type { Store, StoredMessage } from '../store.js';

export type LiveEvent =
  | {
      type: 'reading';
      deviceId: string;
      siteSlug: string;
      seq: number;
      ts: string;
      m: Record<string, number | null>;
      pushedAt?: string;
    }
  | {
      type: 'status';
      deviceId: string;
      siteSlug: string;
      online: boolean;
      fw?: string;
      rssi?: number;
      uptimeS?: number;
    }
  | { type: 'command'; deviceId: string; siteSlug: string; command: Record<string, unknown> }
  | { type: 'alert'; deviceId: string; siteSlug: string; alert: Record<string, unknown> }
  | { type: 'raw'; deviceId: string; siteSlug: string; topic: string; payload: string; at: string };

export type ServerMessage =
  | LiveEvent
  | { type: 'hello'; serverTime: string; role: string }
  | { type: 'heartbeat'; at: string }
  | { type: 'backfill'; deviceId: string; readings: StoredMessage[] }
  | { type: 'subscribed'; sites: string[]; devices: string[] }
  | { type: 'error'; message: string };

export const clientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    /** Site slugs, or ["*"] for the whole fleet. */
    sites: z.array(z.string().max(64)).max(32).default([]),
    devices: z.array(z.string().max(64)).max(64).default([]),
    /** Last seq the client has, per device, for back-fill. */
    since: z.record(z.string(), z.int().min(-1)).optional(),
    /** Also stream raw MQTT messages (the device page's message log). */
    raw: z.boolean().optional(),
  }),
  z.object({ type: z.literal('ping') }),
]);

export interface Socket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount: number;
}

interface Client {
  socket: Socket;
  sites: Set<string>;
  devices: Set<string>;
  raw: boolean;
}

/** Back-fill only covers the live chart window; older history comes from the readings endpoint. */
const BACKFILL_WINDOW_MS = 15 * 60_000;
const BACKFILL_LIMIT = 450;
/** A client this far behind is dropped rather than letting its buffer grow without bound. */
const MAX_BUFFERED = 1_000_000;

export class Hub {
  private readonly clients = new Set<Client>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    private readonly store: Pick<Store, 'messagesSince'>,
    heartbeatMs = 15_000,
  ) {
    this.heartbeat = setInterval(
      () => this.broadcast({ type: 'heartbeat', at: new Date().toISOString() }),
      heartbeatMs,
    );
    this.heartbeat.unref();
  }

  get size(): number {
    return this.clients.size;
  }

  add(socket: Socket, role: string): Client {
    const client: Client = { socket, sites: new Set(), devices: new Set(), raw: false };
    this.clients.add(client);
    this.send(client, { type: 'hello', serverTime: new Date().toISOString(), role });
    return client;
  }

  remove(client: Client): void {
    this.clients.delete(client);
  }

  async onMessage(client: Client, data: string, knownDevices: ReadonlyMap<string, string>): Promise<void> {
    let parsed: z.infer<typeof clientMessage>;
    try {
      parsed = clientMessage.parse(JSON.parse(data));
    } catch {
      this.send(client, { type: 'error', message: 'invalid message' });
      return;
    }
    if (parsed.type === 'ping') {
      this.send(client, { type: 'heartbeat', at: new Date().toISOString() });
      return;
    }
    client.sites = new Set(parsed.sites);
    client.devices = new Set(parsed.devices.filter((d) => knownDevices.has(d)));
    client.raw = parsed.raw ?? false;
    this.send(client, { type: 'subscribed', sites: [...client.sites], devices: [...client.devices] });

    for (const [deviceId, seq] of Object.entries(parsed.since ?? {})) {
      const site = knownDevices.get(deviceId);
      if (site === undefined || !this.matches(client, deviceId, site)) continue;
      const readings = await this.store.messagesSince(
        deviceId,
        seq,
        new Date(Date.now() - BACKFILL_WINDOW_MS),
        BACKFILL_LIMIT,
      );
      if (readings.length) this.send(client, { type: 'backfill', deviceId, readings });
    }
  }

  private matches(c: Client, deviceId: string, siteSlug: string): boolean {
    return c.sites.has('*') || c.sites.has(siteSlug) || c.devices.has(deviceId);
  }

  /** Sends an event to every subscribed client. Returns how many received it. */
  publish(event: LiveEvent): number {
    let n = 0;
    for (const c of this.clients) {
      if (event.type === 'raw' && !c.raw) continue;
      if (!this.matches(c, event.deviceId, event.siteSlug)) continue;
      this.send(c, event);
      n++;
    }
    return n;
  }

  private broadcast(msg: ServerMessage): void {
    for (const c of this.clients) this.send(c, msg);
  }

  private send(c: Client, msg: ServerMessage): void {
    if (c.socket.bufferedAmount > MAX_BUFFERED) {
      c.socket.close(1013, 'too slow');
      this.clients.delete(c);
      return;
    }
    c.socket.send(JSON.stringify(msg));
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.socket.close(1001, 'server shutting down');
    this.clients.clear();
  }
}
