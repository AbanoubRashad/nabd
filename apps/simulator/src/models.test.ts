import { describe, expect, it } from 'vitest';
import {
  DOOR_CYCLE_MS,
  TICK_MS,
  WARM_C,
  cairoHour,
  coldRoom,
  coldRoomDoorOffline,
  greenhouseClimate,
  initialFridge,
  solarW,
  stepFridge,
  stepVilla,
  villaMetrics,
} from './models.js';

/** Small seeded PRNG (mulberry32) so the runs are repeatable. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('time', () => {
  it('converts to Cairo local time', () => {
    // Egypt is UTC+3 in summer (DST), UTC+2 in winter.
    expect(cairoHour(new Date('2026-07-01T09:00:00Z'))).toBeCloseTo(12, 5);
    expect(cairoHour(new Date('2026-12-01T10:00:00Z'))).toBeCloseTo(12, 5);
  });
});

describe('villa', () => {
  const rng = seeded(1);

  it('makes no solar power at night and about 3.4 kW at noon', () => {
    expect(solarW(2, rng)).toBe(0);
    expect(solarW(19, rng)).toBe(0);
    const noon = solarW(12, rng);
    expect(noon).toBeGreaterThan(3200);
    expect(noon).toBeLessThanOrEqual(3468);
  });

  it('keeps every reading inside the ranges from the brief over a full day', () => {
    let state = { soc: 70, heater: false, pvW: 0, loadW: 0 };
    const start = Date.parse('2026-10-14T00:00:00Z');
    // Track the extremes and assert once: 43,200 ticks of expect() calls would dominate the run time.
    const lo = { soc: Infinity, bus_v: Infinity, load_w: Infinity };
    const hi = { soc: -Infinity, bus_v: -Infinity, load_w: -Infinity };
    for (let t = start; t < start + 86_400_000; t += TICK_MS) {
      state = stepVilla(state, new Date(t), rng);
      const m = villaMetrics('nabd-01', state, rng);
      for (const k of ['soc', 'bus_v', 'load_w'] as const) {
        lo[k] = Math.min(lo[k], m[k] ?? NaN);
        hi[k] = Math.max(hi[k], m[k] ?? NaN);
      }
    }
    expect(lo.soc).toBeGreaterThanOrEqual(20);
    expect(hi.soc).toBeLessThanOrEqual(100);
    expect(lo.bus_v).toBeGreaterThanOrEqual(48);
    expect(hi.bus_v).toBeLessThanOrEqual(54);
    expect(lo.load_w).toBeGreaterThanOrEqual(600);
    expect(hi.load_w).toBeLessThanOrEqual(2800);
  });

  it('adds 1.5 kW of load while the water heater relay is on', () => {
    const at = new Date('2026-10-14T01:00:00Z');
    const off = stepVilla({ soc: 70, heater: false, pvW: 0, loadW: 0 }, at, () => 0.5);
    const on = stepVilla({ soc: 70, heater: true, pvW: 0, loadW: 0 }, at, () => 0.5);
    expect(on.loadW - off.loadW).toBe(1500);
    expect(villaMetrics('nabd-01', on, () => 0.5).relay1).toBe(1);
  });
});

describe('medicine fridge door-ajar scenario', () => {
  it('stays above 8 °C for 6–8 minutes once every 20 minutes, then recovers below 7.5 °C', () => {
    const rng = seeded(7);
    const start = Math.ceil(Date.parse('2026-10-14T10:00:00Z') / DOOR_CYCLE_MS) * DOOR_CYCLE_MS - 5 * 60_000;
    let state = initialFridge(new Date(start));
    const warmSpells: number[] = [];
    let warmFrom: number | null = null;
    let minAfterSpell = Infinity;

    for (let t = start; t < start + 3 * DOOR_CYCLE_MS; t += TICK_MS) {
      state = stepFridge(state, new Date(t), rng);
      if (state.tempC > WARM_C && warmFrom === null) warmFrom = t;
      if (state.tempC <= WARM_C && warmFrom !== null) {
        warmSpells.push((t - warmFrom) / 60_000);
        warmFrom = null;
        minAfterSpell = Infinity;
      }
      if (warmFrom === null) minAfterSpell = Math.min(minAfterSpell, state.tempC);
      expect(state.tempC).toBeGreaterThanOrEqual(2);
    }

    expect(warmSpells).toHaveLength(3);
    for (const minutes of warmSpells) {
      expect(minutes).toBeGreaterThanOrEqual(5.9);
      expect(minutes).toBeLessThanOrEqual(8.1);
    }
    expect(minAfterSpell).toBeLessThan(7.5);
  });

  it('cycles the compressor between 3.5 and 6.5 °C while the door is shut', () => {
    const rng = seeded(3);
    // Start just after a door cycle has finished so the 10 minutes below are door-free.
    const start = Math.ceil(Date.parse('2026-10-14T10:00:00Z') / DOOR_CYCLE_MS) * DOOR_CYCLE_MS + 60_000;
    let state = { ...initialFridge(new Date(start)), doorCycle: Math.floor(start / DOOR_CYCLE_MS) };
    for (let t = start; t < start + 18 * 60_000; t += TICK_MS) {
      state = stepFridge(state, new Date(t), rng);
      expect(state.door).toBe(false);
      expect(state.tempC).toBeGreaterThan(3.2);
      expect(state.tempC).toBeLessThan(6.8);
    }
  });
});

describe('other sites', () => {
  const rng = seeded(11);

  it('keeps the greenhouse between 22 and 36 °C and 55–85 % RH, below the 35 °C rule', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const { airC, rh } = greenhouseClimate(new Date(Date.UTC(2026, 9, 14, 0, h * 60)), rng);
      expect(airC).toBeGreaterThanOrEqual(22);
      expect(airC).toBeLessThan(35);
      expect(rh).toBeGreaterThanOrEqual(55);
      expect(rh).toBeLessThanOrEqual(85);
    }
  });

  it('keeps the cold room between −20 and −16 °C at 50–75 % duty', () => {
    for (let m = 0; m < 180; m++) {
      const c = coldRoom(new Date(Date.UTC(2026, 9, 14, 0, m)), rng);
      expect(c.roomC).toBeGreaterThanOrEqual(-20);
      expect(c.roomC).toBeLessThanOrEqual(-16);
      expect(c.dutyPct).toBeGreaterThanOrEqual(50);
      expect(c.dutyPct).toBeLessThanOrEqual(75);
    }
  });

  it('takes nabd-11 offline for 15 minutes every hour', () => {
    const offline = Array.from({ length: 60 }, (_, m) =>
      coldRoomDoorOffline(new Date(Date.UTC(2026, 9, 14, 3, m))),
    );
    expect(offline.filter(Boolean)).toHaveLength(15);
  });
});
