import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingRow } from '@nabd/db';
import { Batcher, type Batch } from './batcher.js';

const row = (seq: number): ReadingRow => ({
  deviceId: 'nabd-01',
  ts: new Date(1_760_000_000_000 + seq * 2000).toISOString(),
  seq,
  metric: 'pv_w',
  value: seq,
});
const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => row(from + i));

describe('Batcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flushes after 250 ms when fewer than 500 rows are waiting', async () => {
    const batches: Batch[] = [];
    const b = new Batcher({ write: async (batch) => void batches.push(batch) });
    b.addReadings('nabd-01', rows(0, 4), new Date());

    await vi.advanceTimersByTimeAsync(249);
    expect(batches).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.readings).toHaveLength(4);
  });

  it('flushes at once when 500 rows are waiting, in batches of at most 500', async () => {
    const sizes: number[] = [];
    const b = new Batcher({ write: async (batch) => void sizes.push(batch.readings.length) });
    b.addReadings('nabd-01', rows(0, 1200), new Date());

    await vi.advanceTimersByTimeAsync(0);
    expect(sizes[0]).toBe(500);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sizes).toEqual([500, 500, 200]);
  });

  it('tracks the latest device timestamp, so a replay never moves last_seen_at backwards', async () => {
    const batches: Batch[] = [];
    const b = new Batcher({ write: async (batch) => void batches.push(batch) });
    b.addReadings('nabd-01', rows(10, 1), new Date('2026-10-14T12:00:00Z'));
    b.addReadings('nabd-01', rows(1, 1), new Date('2026-10-14T09:00:00Z')); // replayed from the buffer
    await vi.advanceTimersByTimeAsync(250);
    expect(batches[0]?.seen.get('nabd-01')?.toISOString()).toBe('2026-10-14T12:00:00.000Z');
  });

  it('keeps the rows and retries with backoff while the database is down', async () => {
    let failures = 2;
    const written: number[] = [];
    const errors: number[] = [];
    const b = new Batcher({
      write: async (batch) => {
        if (failures-- > 0) throw new Error('connection refused');
        written.push(...batch.readings.map((r) => r.seq));
      },
      onError: (_e, retryIn) => errors.push(retryIn),
    });
    b.addReadings('nabd-01', rows(0, 3), new Date());
    await vi.advanceTimersByTimeAsync(250); // fails, retry in 500 ms
    b.addReadings('nabd-01', rows(3, 2), new Date());
    await vi.advanceTimersByTimeAsync(500); // fails, retry in 1 s
    await vi.advanceTimersByTimeAsync(1000); // succeeds

    expect(errors).toEqual([500, 1000]);
    expect(written).toEqual([0, 1, 2, 3, 4]);
    expect(b.pending).toBe(0);
  });

  it('drops the oldest rows beyond the memory bound and reports them', async () => {
    const dropped: number[] = [];
    const b = new Batcher({
      write: async () => {
        throw new Error('down');
      },
      maxBuffered: 10,
      onDrop: (n) => dropped.push(n),
    });
    b.addReadings('nabd-01', rows(0, 12), new Date());
    expect(dropped).toEqual([2]);
    expect(b.pending).toBe(10);
    await vi.advanceTimersByTimeAsync(5000);
  });

  it('drains everything on shutdown', async () => {
    vi.useRealTimers();
    const written: number[] = [];
    const b = new Batcher({ write: async (batch) => void written.push(batch.readings.length) });
    b.addReadings('nabd-01', rows(0, 1100), new Date());
    b.addDeadLetter({ topic: 't', deviceId: null, reason: 'invalid_json', payload: '{' });
    expect(await b.drain()).toBe(0);
    expect(written.reduce((a, n) => a + n, 0)).toBe(1100);
  });
});
