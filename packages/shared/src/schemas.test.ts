import { describe, expect, it } from 'vitest';
import {
  MAX_PAYLOAD_BYTES,
  parseAck,
  parseCommand,
  parseOta,
  parseStatus,
  parseTelemetry,
} from './schemas.js';

const now = new Date('2026-10-14T11:32:12.000Z');
const telemetry = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    seq: 48210,
    ts: '2026-10-14T11:32:10.412Z',
    m: { pv_w: 3420, bus_v: 51.6, soc: 87, load_w: 1180 },
    ...over,
  });

describe('parseTelemetry', () => {
  it('accepts the contract example', () => {
    const r = parseTelemetry(telemetry(), now);
    expect(r).toEqual({
      ok: true,
      value: {
        seq: 48210,
        ts: '2026-10-14T11:32:10.412Z',
        m: { pv_w: 3420, bus_v: 51.6, soc: 87, load_w: 1180 },
      },
    });
  });

  it('accepts bytes as well as strings', () => {
    expect(parseTelemetry(new TextEncoder().encode(telemetry()), now).ok).toBe(true);
  });

  it('keeps a failed sensor as null with its error', () => {
    const r = parseTelemetry(telemetry({ m: { probe_c: null, door: 0 }, errors: ['ds18b20:crc'] }), now);
    expect(r.ok && r.value.m.probe_c).toBeNull();
  });

  it.each([
    ['payload over 2 KB', telemetry({ errors: ['x'.repeat(MAX_PAYLOAD_BYTES)] }), /^payload_too_large/],
    ['not JSON', '{"seq":', /^invalid_json$/],
    [
      'unknown metric key',
      telemetry({ m: { pv_w: 1, flux_capacitor: 1 } }),
      /^unknown_metric:flux_capacitor$/,
    ],
    ['value outside the plausible range', telemetry({ m: { soc: 140 } }), /^out_of_range:soc$/],
    ['no metrics', telemetry({ m: {} }), /^no_metrics$/],
    ['negative seq', telemetry({ seq: -1 }), /^schema:seq/],
    ['fractional seq', telemetry({ seq: 1.5 }), /^schema:seq/],
    ['extra top-level field', telemetry({ extra: true }), /^schema/],
    ['ts without a timezone', telemetry({ ts: '2026-10-14T11:32:10' }), /^schema:ts/],
    ['string value', telemetry({ m: { soc: '87' } }), /^schema:m\.soc/],
  ])('rejects %s', (_name, payload, reason) => {
    const r = parseTelemetry(payload, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });

  it('rejects readings more than 5 minutes in the future', () => {
    expect(parseTelemetry(telemetry({ ts: '2026-10-14T11:37:13.000Z' }), now)).toEqual({
      ok: false,
      reason: 'ts_in_future',
    });
    expect(parseTelemetry(telemetry({ ts: '2026-10-14T11:37:11.000Z' }), now).ok).toBe(true);
  });

  it('accepts old readings, because they are replays from the offline buffer', () => {
    expect(parseTelemetry(telemetry({ ts: '2026-10-01T00:00:00.000Z' }), now).ok).toBe(true);
  });

  it('rejects invalid UTF-8', () => {
    expect(parseTelemetry(new Uint8Array([0x7b, 0xff, 0x7d]), now)).toEqual({
      ok: false,
      reason: 'invalid_utf8',
    });
  });
});

describe('other payloads', () => {
  it('parses a status and the Last Will', () => {
    expect(
      parseStatus('{"online":true,"fw":"1.4.2","rssi":-61,"uptime_s":1569600,"boot_reason":"power_on"}').ok,
    ).toBe(true);
    expect(parseStatus('{"online":false}').ok).toBe(true);
    expect(parseStatus('{"online":"yes"}').ok).toBe(false);
  });

  it('parses commands by op', () => {
    expect(
      parseCommand('{"id":"c-2041","op":"relay.set","args":{"ch":1,"on":true},"exp":"2026-10-14T11:32:20Z"}')
        .ok,
    ).toBe(true);
    expect(
      parseCommand('{"id":"c-2041","op":"relay.set","args":{"ch":3,"on":true},"exp":"2026-10-14T11:32:20Z"}')
        .ok,
    ).toBe(false);
    expect(parseCommand('{"id":"c-1","op":"format.disk","args":{},"exp":"2026-10-14T11:32:20Z"}').ok).toBe(
      false,
    );
  });

  it('parses acks', () => {
    expect(parseAck('{"id":"c-2041","state":"done","relay":{"ch":1,"on":true}}').ok).toBe(true);
    expect(parseAck('{"id":"c-2041","state":"rejected","reason":"expired"}').ok).toBe(true);
    expect(parseAck('{"id":"c-2041","state":"pending"}').ok).toBe(false);
  });

  it('parses OTA offers and refuses plain HTTP', () => {
    const ota = {
      version: '1.5.0',
      url: 'https://fw.example.com/nabd-node-1.5.0.bin',
      sha256: 'a'.repeat(64),
      sig: 'MEUCIQDx',
    };
    expect(parseOta(JSON.stringify(ota)).ok).toBe(true);
    expect(parseOta(JSON.stringify({ ...ota, url: 'http://fw.example.com/x.bin' })).ok).toBe(false);
  });
});
