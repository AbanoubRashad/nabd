import { describe, expect, it } from 'vitest';
import { parseTopic, topic } from './topics.js';

describe('topics', () => {
  it('builds and parses the telemetry topic', () => {
    const t = topic('wadi-natrun', 'nabd-01', 'telemetry');
    expect(t).toBe('nabd/v1/wadi-natrun/nabd-01/telemetry');
    expect(parseTopic(t)).toEqual({ siteSlug: 'wadi-natrun', deviceId: 'nabd-01', leaf: 'telemetry' });
  });

  it('parses the two-level cmd/ack leaf', () => {
    expect(parseTopic('nabd/v1/fayoum/nabd-05/cmd/ack')?.leaf).toBe('cmd/ack');
  });

  it('rejects wildcards and foreign roots', () => {
    expect(() => topic('+', 'nabd-01', 'cmd')).toThrow();
    expect(() => topic('fayoum', '#', 'cmd')).toThrow();
    expect(parseTopic('other/v1/fayoum/nabd-05/telemetry')).toBeNull();
    expect(parseTopic('nabd/v1/fayoum/nabd-05/unknown')).toBeNull();
  });
});
