'use client';

/**
 * WebSocket client for live updates. Reconnects with exponential backoff and jitter, re-sends its
 * subscription with the last `seq` it has per device, and turns the server's back-fill into ordinary
 * reading events, so a chart never shows a gap after a reconnect.
 */
import { useEffect, useRef, useState } from 'react';
import { WS_URL } from './api';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

export interface ReadingEvent {
  type: 'reading';
  deviceId: string;
  siteSlug: string;
  seq: number;
  ts: string;
  m: Record<string, number | null>;
  pushedAt?: string;
  /** True for points that arrived through back-fill rather than live. */
  backfilled?: boolean;
}
export interface StatusEvent {
  type: 'status';
  deviceId: string;
  siteSlug: string;
  online: boolean;
  fw?: string;
  rssi?: number;
  uptimeS?: number;
}
export interface CommandEvent {
  type: 'command';
  deviceId: string;
  siteSlug: string;
  command: {
    id: string;
    state: string;
    sentAt: string | null;
    deliveredAt: string | null;
    doneAt: string | null;
    createdAt: string;
    error: string | null;
    result: { relay?: { ch: number; on: boolean } } | null;
    args: Record<string, unknown>;
  };
}
export interface AlertEvent {
  type: 'alert';
  deviceId: string;
  siteSlug: string;
  alert: {
    alertId: string;
    ruleId: number;
    state: string;
    severity: 'warning' | 'critical';
    peakValue: number | null;
    at: string;
  };
}
export interface RawEvent {
  type: 'raw';
  deviceId: string;
  siteSlug: string;
  topic: string;
  payload: string;
  at: string;
}
export type LiveEvent = ReadingEvent | StatusEvent | CommandEvent | AlertEvent | RawEvent;

export interface Subscription {
  sites?: string[];
  devices?: string[];
  raw?: boolean;
}

type Listener = (e: LiveEvent) => void;

export class LiveClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private readonly lastSeq = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private readonly stateListeners = new Set<(s: ConnectionState) => void>();
  state: ConnectionState = 'connecting';

  constructor(
    private subscription: Subscription,
    private readonly url = WS_URL,
  ) {}

  start(): void {
    this.closed = false;
    this.open();
  }

  private setState(s: ConnectionState) {
    this.state = s;
    for (const l of this.stateListeners) l(s);
  }

  private open() {
    // A website-only deployment has no WebSocket to connect to.
    if (this.closed || !this.url) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.sendSubscription();
      this.setState('live');
    };
    ws.onmessage = (msg) => this.onMessage(String(msg.data));
    ws.onclose = () => {
      this.ws = null;
      if (this.closed) return;
      this.setState('reconnecting');
      // 1 s, 2 s, 4 s … capped at 15 s, with ±30 % jitter so clients don't reconnect in lockstep.
      const base = Math.min(15_000, 1000 * 2 ** this.attempt++);
      this.timer = setTimeout(() => this.open(), base * (0.7 + Math.random() * 0.6));
    };
    ws.onerror = () => ws.close();
  }

  private sendSubscription() {
    this.ws?.send(
      JSON.stringify({
        type: 'subscribe',
        sites: this.subscription.sites ?? [],
        devices: this.subscription.devices ?? [],
        raw: this.subscription.raw ?? false,
        since: Object.fromEntries(this.lastSeq),
      }),
    );
  }

  update(subscription: Subscription) {
    this.subscription = subscription;
    if (this.ws?.readyState === WebSocket.OPEN) this.sendSubscription();
  }

  private emit(e: LiveEvent) {
    if (e.type === 'reading') {
      const last = this.lastSeq.get(e.deviceId) ?? -1;
      // A device restart resets nothing (seq is persisted), so anything not newer is a duplicate.
      if (e.seq <= last && !e.backfilled) return;
      this.lastSeq.set(e.deviceId, Math.max(last, e.seq));
    }
    for (const l of this.listeners) l(e);
  }

  private onMessage(data: string) {
    let msg: { type: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      return;
    }
    if (msg.type === 'backfill') {
      const deviceId = msg.deviceId as string;
      const readings = msg.readings as { seq: number; ts: string; m: Record<string, number | null> }[];
      const last = this.lastSeq.get(deviceId) ?? -1;
      for (const r of readings) {
        if (r.seq <= last) continue;
        this.emit({
          type: 'reading',
          deviceId,
          siteSlug: '',
          seq: r.seq,
          ts: r.ts,
          m: r.m,
          backfilled: true,
        });
      }
      return;
    }
    if (['reading', 'status', 'command', 'alert', 'raw'].includes(msg.type))
      this.emit(msg as unknown as LiveEvent);
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}

/** Subscribes for the lifetime of a component. `onEvent` may change between renders. */
export function useLive(subscription: Subscription, onEvent: Listener): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');
  const handler = useRef(onEvent);
  const key = JSON.stringify(subscription);

  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    const client = new LiveClient(JSON.parse(key) as Subscription);
    const offState = client.onState(setState);
    const off = client.on((e) => handler.current(e));
    client.start();
    return () => {
      off();
      offState();
      client.stop();
    };
  }, [key]);

  return state;
}
