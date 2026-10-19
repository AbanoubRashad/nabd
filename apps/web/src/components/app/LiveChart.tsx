'use client';

/**
 * Time-series chart on uPlot (fast enough for live streams). History comes from the readings endpoint,
 * which picks raw or roll-up data for the range; live points are appended through the imperative handle
 * without re-rendering React, and the 15-minute and 1-hour views keep a rolling window.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { RANGES, type RangeKey, type SeriesDto } from '@nabd/shared';
import { apiGet } from '@/lib/api';

export interface ChartSeries {
  metric: string;
  label: string;
  color: string;
  /** Display transform, e.g. W → kW. */
  scale?: (v: number) => number;
  fill?: boolean;
}

export interface LiveChartHandle {
  append(ts: string, m: Record<string, number | null>): void;
}

interface Props {
  deviceId: string;
  series: ChartSeries[];
  range: RangeKey;
  height: number;
  /** Draw min/avg/max as a band around the average (first series only). */
  band?: boolean;
  ariaLabel: string;
  /** Called with the latest displayed value per metric, for the legend and the text summary. */
  onLatest?: (latest: Record<string, number>) => void;
}

const LIVE_RANGES: ReadonlySet<RangeKey> = new Set(['15m', '1h']);

function rgba(hex: string, alpha: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function latestOf(d: number[][], series: ChartSeries[], band: boolean): Record<string, number> | null {
  const n = d[0]?.length ?? 0;
  if (!n) return null;
  const latest: Record<string, number> = {};
  series.forEach((s, i) => {
    const v = d[band ? 1 : i + 1]?.[n - 1];
    if (typeof v === 'number' && !Number.isNaN(v)) latest[s.metric] = v;
  });
  return latest;
}

export const LiveChart = forwardRef<LiveChartHandle, Props>(function LiveChart(
  { deviceId, series, range, height, band = false, ariaLabel, onLatest },
  ref,
) {
  const box = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const data = useRef<number[][]>([[]]);
  const [summary, setSummary] = useState('');
  const latestCb = useRef(onLatest);
  useEffect(() => {
    latestCb.current = onLatest;
  });

  // Rebuild only when what is drawn changes, so callers needn't memoise the series array.
  const seriesKey = JSON.stringify(series.map((s) => [s.metric, s.label, s.color, Boolean(s.fill)]));
  const seriesRef = useRef(series);
  useEffect(() => {
    seriesRef.current = series;
  });

  /** Tells the parent (legend) and the screen-reader summary about the newest point. */
  function report() {
    const latest = latestOf(data.current, series, band);
    if (!latest) return;
    latestCb.current?.(latest);
    setSummary(series.map((s) => `${s.label} ${latest[s.metric]?.toFixed(2) ?? 'no data'}`).join(', '));
  }
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  });

  // Build the chart once per range and series set.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const series = seriesRef.current;
    const width = el.clientWidth || 600;
    const axis = {
      stroke: '#93A3B5',
      grid: { stroke: '#1E2733', width: 1 },
      ticks: { stroke: '#1E2733', width: 1 },
      font: '12px "IBM Plex Mono", monospace',
    };
    const lines: uPlot.Series[] = band
      ? [
          { label: series[0]!.label, stroke: series[0]!.color, width: 2.5 },
          { label: 'min', stroke: 'transparent', points: { show: false } },
          { label: 'max', stroke: 'transparent', points: { show: false } },
        ]
      : series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 2.5,
          fill: s.fill ? rgba(s.color, 0.12) : undefined,
          points: { show: false },
        }));
    const opts: uPlot.Options = {
      width,
      height,
      legend: { show: false },
      cursor: { points: { size: 6 } },
      scales: { x: { time: true } },
      axes: [
        { ...axis, space: 80 },
        { ...axis, size: 52, values: (_u, vals) => vals.map((v) => v.toFixed(Math.abs(v) < 10 ? 1 : 0)) },
      ],
      series: [{}, ...lines],
      bands: band ? [{ series: [3, 2], fill: rgba(series[0]!.color, 0.14) }] : undefined,
    };
    data.current = [[], ...lines.map(() => [])];
    const u = new uPlot(opts, data.current as uPlot.AlignedData, el);
    plot.current = u;

    const resize = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
    resize.observe(el);

    // History for the range.
    let cancelled = false;
    const to = new Date();
    const from = new Date(to.getTime() - RANGES[range]);
    const q = (metric: string) =>
      apiGet<SeriesDto>(
        `/devices/${deviceId}/readings?metric=${metric}&from=${from.toISOString()}&to=${to.toISOString()}`,
      );
    void Promise.all(series.map((s) => q(s.metric))).then((results) => {
      if (cancelled) return;
      const byTime = new Map<number, number[]>();
      results.forEach((r, i) => {
        for (const p of r?.points ?? []) {
          const t = Date.parse(p.t) / 1000;
          const row = byTime.get(t) ?? new Array(band ? 3 : series.length).fill(Number.NaN);
          const scale = series[i]!.scale ?? ((v: number) => v);
          if (band) {
            row[0] = scale(p.avg);
            row[1] = scale(p.min);
            row[2] = scale(p.max);
          } else {
            row[i] = scale(p.avg);
          }
          byTime.set(t, row);
        }
      });
      const times = [...byTime.keys()].sort((a, b) => a - b);
      data.current = [times, ...lines.map((_, i) => times.map((t) => byTime.get(t)![i]!))];
      u.setData(data.current as uPlot.AlignedData);
      reportRef.current();
    });

    return () => {
      cancelled = true;
      resize.disconnect();
      u.destroy();
      plot.current = null;
    };
  }, [deviceId, range, height, band, seriesKey]);

  useImperativeHandle(
    ref,
    () => ({
      append(ts, m) {
        const series = seriesRef.current;
        const u = plot.current;
        if (!u || !LIVE_RANGES.has(range) || band) return;
        const t = Date.parse(ts) / 1000;
        const d = data.current;
        const xs = d[0]!;
        if (xs.length && t <= xs[xs.length - 1]!) return; // out of order or duplicate
        xs.push(t);
        series.forEach((s, i) => {
          const v = m[s.metric];
          d[i + 1]!.push(typeof v === 'number' ? (s.scale ?? ((x: number) => x))(v) : Number.NaN);
        });
        // Rolling window: drop points that have scrolled out of the range.
        const cutoff = t - RANGES[range] / 1000;
        let drop = 0;
        while (drop < xs.length && xs[drop]! < cutoff) drop++;
        if (drop) for (const col of d) col.splice(0, drop);
        u.setData(d as uPlot.AlignedData);
        reportRef.current();
      },
    }),
    [range, band],
  );

  return (
    <figure className="m-0" dir="ltr">
      <div ref={box} role="img" aria-label={ariaLabel} className="w-full" style={{ minHeight: height }} />
      <figcaption className="sr-only" aria-live="off">
        {ariaLabel}. {summary}
      </figcaption>
    </figure>
  );
});
