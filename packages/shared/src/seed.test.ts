import { describe, expect, it } from 'vitest';
import { isMetricKey } from './metrics.js';
import { PRODUCTS } from './products.js';
import { SEED_DEVICES, SEED_RULES, SEED_SITES } from './seed.js';
import { topic } from './topics.js';

describe('seed data', () => {
  it('has 4 sites and 12 devices, and nabd-01 is the real board', () => {
    expect(SEED_SITES).toHaveLength(4);
    expect(SEED_DEVICES).toHaveLength(12);
    expect(SEED_DEVICES.filter((d) => !d.isSimulated).map((d) => d.id)).toEqual(['nabd-01']);
  });

  it('uses only registry metrics, known sites and valid topic segments', () => {
    const slugs = new Set<string>(SEED_SITES.map((s) => s.slug));
    for (const d of SEED_DEVICES) {
      expect(slugs.has(d.siteSlug)).toBe(true);
      expect(d.metrics.every(isMetricKey)).toBe(true);
      expect(() => topic(d.siteSlug, d.id, 'telemetry')).not.toThrow();
    }
  });

  it('points every device-scoped rule at a device that publishes that metric', () => {
    for (const r of SEED_RULES) {
      if (r.deviceId === null || r.metric === null) continue;
      const device = SEED_DEVICES.find((d) => d.id === r.deviceId);
      expect(device?.metrics as readonly string[]).toContain(r.metric);
    }
  });

  it('lists the 8 products in design order, 5 of them prototypes', () => {
    expect(PRODUCTS.map((p) => p.code)).toEqual(['P1', 'C1', 'F1', 'R1', 'W1', 'G1', 'T1', 'K1']);
    const prototypes = PRODUCTS.filter((p) => p.status === 'Prototype').map((p) => p.code);
    expect(prototypes).toEqual(['P1', 'C1', 'F1', 'R1', 'K1']);
  });
});
