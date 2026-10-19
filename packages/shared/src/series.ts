/**
 * Picks the readings source for a chart: raw rows or one of the continuous aggregates, whichever is the
 * finest that keeps the series at or under `MAX_POINTS` per metric. Raw readings arrive every 2 s.
 */
export const MAX_POINTS = 2000;

export type SeriesSource = 'raw' | '1m' | '1h' | '1d';

const STEP_MS: Record<SeriesSource, number> = {
  raw: 2_000,
  '1m': 60_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
};

export function pickSource(fromMs: number, toMs: number, maxPoints = MAX_POINTS): SeriesSource {
  const span = Math.max(0, toMs - fromMs);
  for (const source of ['raw', '1m', '1h'] as const) {
    if (span / STEP_MS[source] <= maxPoints) return source;
  }
  return '1d';
}

export function stepMs(source: SeriesSource): number {
  return STEP_MS[source];
}

/** The chart range buttons on /fleet and /devices. */
export const RANGES = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
} as const;
export type RangeKey = keyof typeof RANGES;
