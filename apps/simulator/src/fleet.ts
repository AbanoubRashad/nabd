import { SEED_DEVICES, type DeviceId } from '@nabd/shared';
import {
  coldRoom,
  coldRoomDoorOpen,
  fridgeMetrics,
  greenhouseClimate,
  initialFridge,
  roomClimate,
  stepFridge,
  stepSoil,
  stepVilla,
  villaMetrics,
  type FridgeState,
  type Metrics,
  type Rng,
  type VillaState,
} from './models.js';

type Relays = Record<1 | 2, boolean>;

/**
 * The simulated world: one state per site, advanced once per tick, plus every device's relays. Devices that
 * share a site (the villa's three nodes, the cold room's three) read the same state, so their readings agree.
 */
export class Fleet {
  private villa: VillaState = { soc: 72, heater: false, pvW: 0, loadW: 0 };
  private fridge: FridgeState;
  private soil = 38;
  private readonly relays = new Map<string, Relays>();
  private metrics = new Map<string, Metrics>();

  constructor(
    private readonly rng: Rng = Math.random,
    start = new Date(),
  ) {
    this.fridge = initialFridge(start);
    for (const d of SEED_DEVICES) this.relays.set(d.id, { 1: false, 2: false });
    // The design shows the irrigation pump running.
    this.relays.set('nabd-05', { 1: true, 2: false });
  }

  /** Advances every site to `at` and computes each device's readings for this tick. */
  tick(at: Date): void {
    this.villa = stepVilla({ ...this.villa, heater: this.relay('nabd-01', 1) }, at, this.rng);
    this.fridge = stepFridge(this.fridge, at, this.rng);
    this.soil = stepSoil(this.soil, this.relay('nabd-05', 1), this.rng);
    const greenhouse = greenhouseClimate(at, this.rng);
    const cold = coldRoom(at, this.rng);

    const next = new Map<DeviceId, Metrics>([
      ['nabd-01', villaMetrics('nabd-01', this.villa, this.rng)],
      ['nabd-02', villaMetrics('nabd-02', this.villa, this.rng)],
      ['nabd-03', villaMetrics('nabd-03', this.villa, this.rng)],
      ['nabd-04', { air_c: greenhouse.airC, rh: greenhouse.rh }],
      ['nabd-05', { soil_pct: Math.round(this.soil), relay1: this.relay('nabd-05', 1) ? 1 : 0 }],
      ['nabd-06', { relay1: this.relay('nabd-06', 1) ? 1 : 0 }],
      ['nabd-07', fridgeMetrics(this.fridge)],
      ['nabd-08', roomClimate({ airC: 24.1, rh: 45 }, at, this.rng)],
      ['nabd-09', { probe_c: cold.roomC, duty_pct: cold.dutyPct }],
      ['nabd-10', { power_w: cold.powerW, current_a: Math.round((cold.powerW / 230) * 10) / 10 }],
      ['nabd-11', { door: coldRoomDoorOpen(at) ? 1 : 0 }],
      [
        'nabd-12',
        { ...roomClimate({ airC: 24, rh: 45 }, at, this.rng), relay1: this.relay('nabd-12', 1) ? 1 : 0 },
      ],
    ]);
    this.metrics = next;
  }

  metricsFor(deviceId: string): Metrics {
    return this.metrics.get(deviceId) ?? {};
  }

  relay(deviceId: string, ch: 1 | 2): boolean {
    return this.relays.get(deviceId)?.[ch] ?? false;
  }

  setRelay(deviceId: string, ch: 1 | 2, on: boolean): void {
    const current = this.relays.get(deviceId) ?? { 1: false, 2: false };
    this.relays.set(deviceId, { ...current, [ch]: on });
  }

  /** Fail-safe, as on the firmware: every relay goes OFF when a device boots. */
  resetRelays(deviceId: string): void {
    this.relays.set(deviceId, { 1: false, 2: false });
  }
}
