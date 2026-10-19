import { describe, expect, it } from 'vitest';
import { route } from './route.js';

const known = new Map([
  ['nabd-01', 'wadi-natrun'],
  ['nabd-07', 'heliopolis'],
]);
const now = new Date('2026-10-14T11:32:12Z');
const msg = (body: unknown) => Buffer.from(JSON.stringify(body));

describe('route', () => {
  it('turns telemetry into one row per metric and skips failed sensors', () => {
    const r = route(
      'nabd/v1/heliopolis/nabd-07/telemetry',
      msg({
        seq: 9,
        ts: '2026-10-14T11:32:10.000Z',
        m: { probe_c: 7.9, door: 0, compressor: null },
        errors: ['x'],
      }),
      known,
      now,
    );
    expect(r).toEqual({
      kind: 'readings',
      deviceId: 'nabd-07',
      ts: new Date('2026-10-14T11:32:10.000Z'),
      rows: [
        { deviceId: 'nabd-07', ts: '2026-10-14T11:32:10.000Z', seq: 9, metric: 'probe_c', value: 7.9 },
        { deviceId: 'nabd-07', ts: '2026-10-14T11:32:10.000Z', seq: 9, metric: 'door', value: 0 },
      ],
    });
  });

  it('applies status messages and Last Wills', () => {
    expect(route('nabd/v1/wadi-natrun/nabd-01/status', msg({ online: false }), known, now)).toEqual({
      kind: 'status',
      update: {
        deviceId: 'nabd-01',
        online: false,
        fw: undefined,
        rssi: undefined,
        uptimeS: undefined,
        bootReason: undefined,
        at: now,
      },
    });
  });

  it.each([
    ['a topic outside the contract', 'other/topic', msg({}), 'bad_topic', null],
    ['an unregistered device', 'nabd/v1/fayoum/nabd-99/telemetry', msg({}), 'unknown_device', null],
    [
      'a device under the wrong site',
      'nabd/v1/fayoum/nabd-01/telemetry',
      msg({}),
      'site_mismatch:fayoum',
      'nabd-01',
    ],
    ['invalid JSON', 'nabd/v1/wadi-natrun/nabd-01/telemetry', Buffer.from('{'), 'invalid_json', 'nabd-01'],
    [
      'an unknown metric',
      'nabd/v1/wadi-natrun/nabd-01/telemetry',
      msg({ seq: 1, ts: '2026-10-14T11:32:10Z', m: { warp: 9 } }),
      'unknown_metric:warp',
      'nabd-01',
    ],
    ['a command echoed back', 'nabd/v1/wadi-natrun/nabd-01/cmd', msg({}), 'unexpected_leaf:cmd', 'nabd-01'],
  ])('sends %s to dead letters', (_name, topic, payload, reason, deviceId) => {
    const r = route(topic, payload, known, now);
    expect(r.kind).toBe('dead');
    if (r.kind === 'dead') expect(r.letter).toMatchObject({ topic, reason, deviceId });
  });
});
