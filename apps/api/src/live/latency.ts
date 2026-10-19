/**
 * Measures the two halves of "device → screen" latency for live readings:
 * - receive: when the API's MQTT client got the message, minus the device timestamp
 * - push: when the reading was written to the WebSocket clients, minus the device timestamp
 *
 * Replayed readings from a device's offline buffer are excluded (anything older than 60 s): they are late on
 * purpose and would swamp the numbers. Device clocks are synced by SNTP, so small negative values can occur;
 * they are clamped to zero.
 */
export class LatencyTracker {
  private readonly receive: number[] = [];
  private readonly push: number[] = [];
  private messages: number[] = [];

  constructor(private readonly window = 1000) {}

  /** Returns false for replays, which are not counted. */
  record(deviceTsMs: number, receivedAtMs: number, pushedAtMs: number): boolean {
    this.messages.push(receivedAtMs);
    const receive = receivedAtMs - deviceTsMs;
    if (receive > 60_000) return false;
    this.add(this.receive, Math.max(0, receive));
    this.add(this.push, Math.max(0, pushedAtMs - deviceTsMs));
    return true;
  }

  private add(list: number[], v: number) {
    list.push(v);
    if (list.length > this.window) list.shift();
  }

  /** Messages per second over the last 10 seconds. */
  rate(now = Date.now()): number {
    this.messages = this.messages.filter((t) => now - t <= 10_000);
    return Math.round((this.messages.length / 10) * 10) / 10;
  }

  p95(kind: 'receive' | 'push'): number | null {
    return percentile(kind === 'receive' ? this.receive : this.push, 0.95);
  }

  get samples(): number {
    return this.push.length;
  }
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)]!);
}
