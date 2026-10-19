import { describe, expect, it } from 'vitest';
import { ago, formatMetric, rssi, summary, uptime } from './format';

describe('format', () => {
  it('formats readings the way the design does', () => {
    expect(formatMetric('probe_c', 8.26)).toBe('8.3 °C');
    expect(formatMetric('probe_c', -18.2)).toBe('−18.2 °C');
    expect(formatMetric('pv_w', 3420)).toBe('3.42 kW');
    expect(formatMetric('load_w', 640)).toBe('640 W');
    expect(formatMetric('relay1', 1)).toBe('ON');
    expect(formatMetric('soc', null)).toBe('no data');
    expect(rssi(-61)).toBe('−61 dBm');
  });

  it('writes relative times and uptimes', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(ago('2026-10-14T12:00:00Z', now)).toBe('just now');
    expect(ago('2026-10-14T11:46:00Z', now)).toBe('14 min ago');
    expect(uptime(18 * 86_400 + 4 * 3600 + 59)).toBe('18 d 4 h');
  });

  it('summarises a device like the devices table', () => {
    expect(summary({ pv_w: { value: 3420 }, bus_v: { value: 51.6 } })).toBe('3.42 kW · 51.6 V');
    expect(summary({ relay1: { value: 1 }, soil_pct: { value: 38 } })).toBe('Relay ON · soil 38 %');
    expect(summary({ probe_c: { value: 7.9 }, door: { value: 0 } })).toBe('7.9 °C · door closed');
    expect(summary({})).toBe('no data');
  });
});
