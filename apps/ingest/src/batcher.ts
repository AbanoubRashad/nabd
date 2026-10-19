import type { DeadLetter, ReadingRow } from '@nabd/db';

export interface Batch {
  readings: ReadingRow[];
  deadLetters: DeadLetter[];
  /** Latest device timestamp seen per device in this batch, for `devices.last_seen_at`. */
  seen: Map<string, Date>;
}

export interface BatcherOptions {
  /** Writes one batch. Throwing keeps the rows and retries with backoff. */
  write: (batch: Batch) => Promise<void>;
  flushMs?: number;
  maxRows?: number;
  /** Upper bound on rows held in memory while the database is unreachable; beyond it the oldest are dropped. */
  maxBuffered?: number;
  onFlush?: (info: { rows: number; ms: number }) => void;
  onError?: (error: unknown, retryInMs: number) => void;
  onDrop?: (rows: number) => void;
}

/**
 * Collects readings and dead letters and writes them in batches: every 250 ms or as soon as 500 rows are
 * waiting, whichever comes first. Only one write runs at a time. A failed write is retried with exponential
 * backoff (up to 10 s), and `drain()` flushes everything before shutdown.
 */
export class Batcher {
  private readings: ReadingRow[] = [];
  private deadLetters: DeadLetter[] = [];
  private seen = new Map<string, Date>();
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;
  private backoffMs = 0;
  private readonly flushMs: number;
  private readonly maxRows: number;
  private readonly maxBuffered: number;

  constructor(private readonly o: BatcherOptions) {
    this.flushMs = o.flushMs ?? 250;
    this.maxRows = o.maxRows ?? 500;
    this.maxBuffered = o.maxBuffered ?? 100_000;
  }

  get pending(): number {
    return this.readings.length + this.deadLetters.length;
  }

  addReadings(deviceId: string, rows: readonly ReadingRow[], ts: Date): void {
    this.readings.push(...rows);
    const prev = this.seen.get(deviceId);
    if (!prev || prev < ts) this.seen.set(deviceId, ts);
    this.enforceBound();
    this.schedule();
  }

  addDeadLetter(letter: DeadLetter): void {
    this.deadLetters.push(letter);
    this.schedule();
  }

  private enforceBound(): void {
    const excess = this.readings.length - this.maxBuffered;
    if (excess > 0) {
      this.readings.splice(0, excess);
      this.o.onDrop?.(excess);
    }
  }

  private schedule(): void {
    if (this.writing) return; // the running write reschedules when it finishes
    if (this.pending >= this.maxRows && this.backoffMs === 0) {
      this.clearTimer();
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.backoffMs || this.flushMs);
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Writes up to `maxRows` waiting rows. Resolves when that write has finished (or failed). */
  flush(): Promise<void> {
    if (this.writing) return this.writing;
    if (this.pending === 0) return Promise.resolve();

    const readings = this.readings.splice(0, this.maxRows);
    const deadLetters = this.deadLetters.splice(0, Math.max(0, this.maxRows - readings.length));
    const seen = this.seen;
    this.seen = new Map();
    const started = performance.now();

    this.writing = this.o
      .write({ readings, deadLetters, seen })
      .then(() => {
        this.backoffMs = 0;
        this.o.onFlush?.({ rows: readings.length, ms: performance.now() - started });
      })
      .catch((error: unknown) => {
        // Put the rows back in front, in their original order, and try again later.
        this.readings.unshift(...readings);
        this.deadLetters.unshift(...deadLetters);
        for (const [id, ts] of seen) {
          const now = this.seen.get(id);
          if (!now || now < ts) this.seen.set(id, ts);
        }
        this.enforceBound();
        this.backoffMs = Math.min(10_000, this.backoffMs ? this.backoffMs * 2 : 500);
        this.o.onError?.(error, this.backoffMs);
      })
      .finally(() => {
        this.writing = null;
        if (this.pending > 0) this.schedule();
      });
    return this.writing;
  }

  /** Flushes until nothing is left, giving up after `timeoutMs` (rows still waiting are reported). */
  async drain(timeoutMs = 10_000): Promise<number> {
    this.clearTimer();
    const until = Date.now() + timeoutMs;
    while (this.pending > 0 && Date.now() < until) {
      this.backoffMs = 0;
      await this.flush();
      this.clearTimer();
      if (this.pending > 0) await new Promise((r) => setTimeout(r, 100));
    }
    return this.pending;
  }
}
