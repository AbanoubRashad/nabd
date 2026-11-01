/**
 * Device behaviours for the demo fleet (prompt section 9). Pure: each step takes the wall-clock time, the
 * previous state and a random source, and returns the next state. The MQTT side lives in device.ts.
 */
import type { MetricKey } from '@nabd/shared';

export type Rng = () => number;
export type Metrics = Partial<Record<MetricKey, number>>;

export const TICK_MS = 2000;
const TICK_S = TICK_MS / 1000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;
const noise = (rng: Rng, amplitude: number) => (rng() * 2 - 1) * amplitude;

// Built once: constructing a DateTimeFormat is far slower than using one.
const cairoClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

/** Hours since local midnight in Africa/Cairo (the demo sites are all in Egypt). */
export function cairoHour(at: Date): number {
  const parts = cairoClock.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') + get('minute') / 60 + get('second') / 3600;
}

// ---- Wadi El Natrun: off-grid villa (nabd-01 power node, nabd-02 battery, nabd-03 inverter) ---------------

export interface VillaState {
  soc: number;
  /** Relay 1 on nabd-01 drives the water heater, +1.5 kW of load when on. */
  heater: boolean;
  pvW: number;
  loadW: number;
}

const BATTERY_WH = 10_000;
const PV_PEAK_W = 3400;
const HEATER_W = 1500;

/** Clear-sky solar curve between 06:00 and 18:00 local time, peaking near 3.4 kW at noon. */
export function solarW(hour: number, rng: Rng): number {
  if (hour <= 6 || hour >= 18) return 0;
  const shape = Math.sin((Math.PI * (hour - 6)) / 12) ** 1.3;
  return clamp(PV_PEAK_W * shape * (0.97 + noise(rng, 0.03)), 0, PV_PEAK_W * 1.02);
}

/** House load without the heater: 0.6 kW overnight, a morning bump and an evening peak near 2.8 kW. */
export function houseLoadW(hour: number, rng: Rng): number {
  const evening = Math.exp(-(((hour - 20.5) / 2) ** 2)) * 2000;
  const morning = Math.exp(-(((hour - 7.5) / 1.2) ** 2)) * 700;
  return clamp(600 + evening + morning + noise(rng, 60), 600, 2800);
}

export function stepVilla(state: VillaState, at: Date, rng: Rng): VillaState {
  const hour = cairoHour(at);
  const pvW = solarW(hour, rng);
  const loadW = houseLoadW(hour, rng) + (state.heater ? HEATER_W : 0);
  const soc = clamp(state.soc + (((pvW - loadW) * TICK_S) / 3600 / BATTERY_WH) * 100, 20, 100);
  return { ...state, pvW, loadW, soc };
}

/** Bus voltage follows state of charge: 48 V near empty, 54 V full, sagging slightly under net discharge. */
export function busVoltage(state: VillaState): number {
  const sag = ((state.loadW - state.pvW) / 3000) * 0.4;
  return clamp(48 + ((state.soc - 20) / 80) * 6 - sag, 48, 54);
}

export function villaMetrics(deviceId: string, s: VillaState, rng: Rng): Metrics {
  const busV = busVoltage(s);
  switch (deviceId) {
    case 'nabd-01':
      return {
        pv_w: Math.round(s.pvW),
        bus_v: round(busV, 1),
        soc: Math.round(s.soc),
        load_w: Math.round(s.loadW),
        relay1: s.heater ? 1 : 0,
      };
    case 'nabd-02':
      return {
        bus_v: round(busV + noise(rng, 0.05), 2),
        batt_a: round((s.pvW - s.loadW) / busV, 1),
        batt_c: round(29 + (Math.abs(s.pvW - s.loadW) / 3000) * 4 + noise(rng, 0.2), 1),
        soc: Math.round(s.soc),
      };
    case 'nabd-03':
      return {
        inv_w: Math.round(s.loadW * 1.04),
        ac_v: Math.round(230 + noise(rng, 2)),
        inv_c: round(34 + s.loadW / 150 + noise(rng, 0.3), 1),
      };
    default:
      return {};
  }
}

// ---- Fayoum: tomato greenhouse (nabd-04 climate, nabd-05 pump, nabd-06 shade) -----------------------------

/** Air 22 °C before dawn to about 34.5 °C mid-afternoon; humidity moves the other way, 55–85 %. */
export function greenhouseClimate(at: Date, rng: Rng): { airC: number; rh: number } {
  const hour = cairoHour(at);
  const airC = clamp(28.25 + 6.25 * Math.sin((2 * Math.PI * (hour - 8)) / 24) + noise(rng, 0.15), 22, 36);
  const rh = clamp(85 - ((airC - 22) / 14) * 30 + noise(rng, 0.8), 55, 85);
  return { airC: round(airC, 1), rh: Math.round(rh) };
}

/**
 * Soil moisture: the pump's inflow shrinks as the soil nears saturation (62 %), and evaporation follows the
 * sun (about 0.5 %/h at night, 2 %/h at noon). With the pump running it levels off near 55–60 % with a
 * daily wave; with the pump off it dries, fastest at midday. Rates are per 2-second tick.
 */
export function stepSoil(soil: number, pumpOn: boolean, at: Date, rng: Rng): number {
  const hour = cairoHour(at);
  const sun = hour > 6 && hour < 18 ? Math.sin((Math.PI * (hour - 6)) / 12) : 0;
  const evaporation = 0.0003 + 0.0008 * sun;
  const inflow = pumpOn ? 0.01 * Math.max(0, 1 - soil / 62) : 0;
  return clamp(soil + inflow - evaporation + noise(rng, 0.004), 25, 62);
}

// ---- Heliopolis: clinic medicine fridge (nabd-07) -----------------------------------------------------------

export interface FridgeState {
  tempC: number;
  compressor: boolean;
  door: boolean;
  /** The 20-minute cycle in which the door was last left open. */
  doorCycle: number;
  /** When the probe last crossed above 8 °C with the door open, or null. */
  aboveSince: number | null;
}

/** The "door left ajar" demo scenario starts every 20 minutes, aligned to the wall clock. */
export const DOOR_CYCLE_MS = 20 * 60_000;
export const WARM_C = 8;
/** Peak probe temperature while the door is open. Recovering from it to 8 °C takes about one minute. */
const DOOR_PEAK_C = 8.6;
const RECOVERY_MS = 60_000;

/**
 * How long the probe stays above 8 °C in a given cycle: 6–8 minutes, chosen per cycle so a run is
 * repeatable. That is longer than the 5-minute rule, so every cycle opens one alert.
 */
export function warmTargetMs(cycle: number): number {
  const jitter = ((cycle * 2654435761) % 1000) / 1000; // Knuth multiplicative hash, deterministic per cycle
  return (6 + 2 * jitter) * 60_000;
}

export function initialFridge(at: Date): FridgeState {
  return {
    tempC: 5,
    compressor: false,
    door: false,
    doorCycle: Math.floor(at.getTime() / DOOR_CYCLE_MS),
    aboveSince: null,
  };
}

export function stepFridge(state: FridgeState, at: Date, rng: Rng): FridgeState {
  const now = at.getTime();
  const cycle = Math.floor(now / DOOR_CYCLE_MS);
  let { door, doorCycle, aboveSince } = state;

  // Door opens at the start of each cycle. It closes once the probe has been warm long enough that, with
  // about a minute to cool back below 8 °C, the warm spell lasts the cycle's target.
  if (!door && cycle !== doorCycle && now % DOOR_CYCLE_MS < 60_000) {
    door = true;
    doorCycle = cycle;
  }
  if (door && state.tempC >= WARM_C && aboveSince === null) aboveSince = now;
  if (door && aboveSince !== null && now - aboveSince >= warmTargetMs(doorCycle) - RECOVERY_MS) door = false;
  if (!door && state.tempC < WARM_C) aboveSince = null;

  // Thermostat with hysteresis: on above 6.5 °C, off below 3.5 °C. With the door open it runs flat out and
  // still loses (1 °C/min, levelling off at the peak).
  const compressor = door || (state.compressor ? state.tempC > 3.5 : state.tempC > 6.5);
  let ratePerMin: number;
  if (door) ratePerMin = state.tempC < DOOR_PEAK_C ? 1.0 : 0;
  else ratePerMin = compressor ? -0.6 : 0.25;

  const tempC = clamp(state.tempC + (ratePerMin * TICK_S) / 60 + noise(rng, 0.01), 2, 9.5);
  return { tempC, compressor, door, doorCycle, aboveSince };
}

export function fridgeMetrics(s: FridgeState): Metrics {
  return { probe_c: round(s.tempC, 1), door: s.door ? 1 : 0, compressor: s.compressor ? 1 : 0 };
}

// ---- 10th of Ramadan: frozen-goods cold room (nabd-09 room, nabd-10 power, nabd-11 door) -------------------

/** Room −20 to −16 °C on a 12-minute compressor cycle, duty 50–75 %. */
export function coldRoom(at: Date, rng: Rng): { roomC: number; dutyPct: number; powerW: number } {
  const minutes = at.getTime() / 60_000;
  const roomC = clamp(-18 + 1.6 * Math.sin((2 * Math.PI * minutes) / 12) + noise(rng, 0.1), -20, -16);
  const dutyPct = clamp(62.5 + 12 * Math.sin((2 * Math.PI * minutes) / 90) + noise(rng, 0.5), 50, 75);
  const powerW = clamp(7800 * (dutyPct / 64) + noise(rng, 120), 5000, 9500);
  return { roomC: round(roomC, 1), dutyPct: Math.round(dutyPct), powerW: Math.round(powerW) };
}

/** nabd-11 drops off the network for the first 15 minutes of every hour, to exercise the offline rule. */
export function coldRoomDoorOffline(at: Date): boolean {
  return at.getUTCMinutes() < 15;
}

/** The cold-room door opens for about 40 s every 7 minutes (loading). */
export function coldRoomDoorOpen(at: Date): boolean {
  return at.getTime() % (7 * 60_000) < 40_000;
}

// ---- Heliopolis clinic room (nabd-08) and the spare node (nabd-12) -----------------------------------------

export function roomClimate(base: { airC: number; rh: number }, at: Date, rng: Rng): Metrics {
  const drift = Math.sin((2 * Math.PI * cairoHour(at)) / 24);
  return {
    air_c: round(base.airC + 0.6 * drift + noise(rng, 0.1), 1),
    rh: Math.round(clamp(base.rh - 3 * drift + noise(rng, 0.5), 0, 100)),
  };
}
