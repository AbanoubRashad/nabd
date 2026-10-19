import { METRICS, isMetricKey, type RuleDto } from '@nabd/shared';
import { fixed } from './format';

/** Short metric names used in rule conditions, as in the design ("temp > 8.0 °C for 5 min"). */
const SHORT: Record<string, string> = { probe_c: 'temp', air_c: 'air', soc: 'soc', bus_v: 'bus', rh: 'rh' };

export function unitOf(metric: string | null): string {
  return metric && isMetricKey(metric) ? METRICS[metric].unit : '';
}

function value(metric: string | null, v: number | null): string {
  if (v === null) return '—';
  const unit = unitOf(metric);
  const places = metric && isMetricKey(metric) ? Math.max(METRICS[metric].precision, 1) : 1;
  const shown = unit === '%' ? String(Math.round(v)) : fixed(v, places);
  return unit ? `${shown} ${unit}` : shown;
}

/** One-line condition: "temp > 8.0 °C for 5 min", "no message for 5 min". */
export function condition(
  r: Pick<RuleDto, 'operator' | 'metric' | 'threshold' | 'thresholdHigh' | 'forSeconds'>,
): string {
  const minutes = Math.round(r.forSeconds / 60);
  if (r.operator === 'offline') return `no message for ${minutes} min`;
  const name = (r.metric && SHORT[r.metric]) ?? r.metric ?? '';
  const cond =
    r.operator === 'outside'
      ? `${name} outside ${value(r.metric, r.threshold)}–${value(r.metric, r.thresholdHigh)}`
      : `${name} ${r.operator === 'gt' ? '>' : '<'} ${value(r.metric, r.threshold)}`;
  return minutes ? `${cond} for ${minutes} min` : cond;
}

export function formatValue(metric: string | null, v: number | null): string {
  return value(metric, v);
}
