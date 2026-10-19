import { METRICS, isMetricKey } from '@nabd/shared';

/** The design uses a true minus sign (U+2212) in readings: "−18.2 °C", "−61 dBm". */
export const minus = (s: string) => s.replace(/^-/, '−').replace(/ -/g, ' −');

export function fixed(value: number, places: number): string {
  return minus(value.toFixed(places));
}

/** "8.3 °C", "3.42 kW" (watts above 1,000 shown as kW, as in the design), "87 %". */
export function formatMetric(metric: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return 'no data';
  if (!isMetricKey(metric)) return fixed(value, 1);
  const def = METRICS[metric];
  if (def.unit === 'W' && Math.abs(value) >= 1000) return `${fixed(value / 1000, 2)} kW`;
  if (def.unit === '') return value ? 'ON' : 'OFF';
  return `${fixed(value, def.precision)}${def.unit ? ` ${def.unit}` : ''}`;
}

export function kw(watts: number | null | undefined): string {
  return watts === null || watts === undefined ? '—' : fixed(watts / 1000, 2);
}

export function rssi(dbm: number | null | undefined): string {
  return dbm === null || dbm === undefined ? '—' : `${minus(String(dbm))} dBm`;
}

/** "just now", "2 s ago", "14 min ago", "2 h ago". */
export function ago(iso: string | null | undefined, now = Date.now(), locale: 'en' | 'ar' = 'en'): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (locale === 'ar') {
    if (s < 2) return 'الآن';
    if (s < 60) return `منذ ${s} ث`;
    if (s < 3600) return `منذ ${Math.round(s / 60)} د`;
    return `منذ ${Math.round(s / 3600)} س`;
  }
  if (s < 2) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** Minutes since a timestamp, for "offline 14 min". */
export function minutesSince(iso: string | null | undefined, now = Date.now()): number | null {
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)) : null;
}

/** "18 d 4 h", "3 h 12 min", "45 s". */
export function uptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${seconds} s`;
}

/** Local clock time in Cairo, "14:36". */
export function clock(iso: string, withSeconds = false): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** A one-line summary of a device's latest readings, as in the devices table. */
export function summary(latest: Record<string, { value: number } | number | null | undefined>): string {
  const v = (k: string) => {
    const x = latest[k];
    return typeof x === 'number' ? x : (x?.value ?? null);
  };
  const parts: string[] = [];
  if (v('pv_w') !== null) parts.push(`${kw(v('pv_w'))} kW`);
  if (v('bus_v') !== null) parts.push(`${fixed(v('bus_v')!, 1)} V`);
  if (v('inv_w') !== null) parts.push(`${kw(v('inv_w'))} kW out`);
  if (v('probe_c') !== null) parts.push(`${fixed(v('probe_c')!, 1)} °C`);
  if (v('air_c') !== null) parts.push(`${fixed(v('air_c')!, 1)} °C`);
  if (v('rh') !== null) parts.push(`${Math.round(v('rh')!)} % RH`);
  if (v('duty_pct') !== null) parts.push(`duty ${Math.round(v('duty_pct')!)} %`);
  if (v('power_w') !== null) parts.push(`${kw(v('power_w'))} kW`);
  if (v('relay1') !== null && v('soil_pct') !== null) {
    return `Relay ${v('relay1') ? 'ON' : 'OFF'} · soil ${Math.round(v('soil_pct')!)} %`;
  }
  if (v('door') !== null) parts.push(v('door') ? 'door open' : 'door closed');
  if (parts.length === 0 && v('relay1') !== null) parts.push(`Relay ${v('relay1') ? 'ON' : 'OFF'}`);
  return parts.slice(0, 2).join(' · ') || 'no data';
}
