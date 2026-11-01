import { SEED_DEVICES } from '@nabd/shared';
import type { RulesEngine } from '@nabd/ingest/rules/engine';
import type { Fleet } from '@nabd/simulator/fleet';
import { TICK_MS, coldRoomDoorOffline } from '@nabd/simulator/models';
import type { DemoStore } from './store.js';

/** How often the engine's clock ticks during the back-fill: every 30 s, as in ingest. */
const ENGINE_TICK_MS = 30_000;

export interface BackfillOptions {
  fleet: Fleet;
  store: DemoStore;
  /** A rules engine whose clock is `clock.now`, so readings from the past count as live. */
  engine: RulesEngine;
  clock: { now: number };
  seq: (deviceId: string) => number;
  from: Date;
  to: Date;
  skip?: (deviceId: string) => boolean;
}

/**
 * Plays the simulated world forward from `from` to `to` at the simulator's real 2-second tick, through the
 * same store and rules engine as live data. Charts then show a full day the moment the demo starts, and the
 * alert history (the fridge door left ajar every 20 minutes, nabd-11 going silent every hour) is real
 * output of the rules engine, not made-up rows. Returns the number of messages written.
 */
export async function backfill(o: BackfillOptions): Promise<number> {
  let written = 0;
  let nextEngineTick = o.from.getTime() + ENGINE_TICK_MS;
  for (let t = o.from.getTime(); t < o.to.getTime(); t += TICK_MS) {
    const at = new Date(t);
    o.clock.now = t;
    o.fleet.tick(at);
    for (const d of SEED_DEVICES) {
      if (o.skip?.(d.id)) continue;
      if (d.id === 'nabd-11' && coldRoomDoorOffline(at)) continue;
      const m = o.fleet.metricsFor(d.id);
      o.store.addMessage(d.id, o.seq(d.id), at, m);
      // Awaited, so the engine judges each reading while the clock still reads its time.
      await o.engine.onReading(d.id, at, m);
      written++;
    }
    if (t >= nextEngineTick) {
      await o.engine.tick(at);
      nextEngineTick += ENGINE_TICK_MS;
    }
  }
  await o.engine.tick(new Date(o.to));
  await o.engine.idle();
  return written;
}
