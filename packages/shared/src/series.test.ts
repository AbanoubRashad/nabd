import { describe, expect, it } from 'vitest';
import { applyAck, canTransition, newCommandId } from './commands.js';
import { parseCommand } from './schemas.js';
import { MAX_POINTS, RANGES, pickSource } from './series.js';

describe('pickSource', () => {
  it.each([
    ['15m', 'raw'], // 450 points
    ['1h', 'raw'], // 1,800 points
    ['24h', '1m'], // 1,440 points
    ['7d', '1h'], // 168 points
  ] as const)('uses %s → %s', (range, source) => {
    expect(pickSource(0, RANGES[range])).toBe(source);
  });

  it('switches to the next level as soon as the finer one would pass the point limit', () => {
    expect(pickSource(0, MAX_POINTS * 2000)).toBe('raw');
    expect(pickSource(0, MAX_POINTS * 2000 + 1)).toBe('1m');
    expect(pickSource(0, 60 * 86_400_000)).toBe('1h'); // 1,440 hourly points
    expect(pickSource(0, 365 * 86_400_000)).toBe('1d'); // 8,760 hourly points would be too many
  });
});

describe('command transitions', () => {
  it.each([
    ['sent', 'delivered', 'delivered'],
    ['delivered', 'done', 'done'],
    ['sent', 'done', 'done'], // the delivered ack may be lost; done still counts
    ['sent', 'rejected', 'rejected'],
    ['timeout', 'done', 'done'], // late but real
    ['done', 'delivered', null], // stale ack
    ['rejected', 'done', null],
    ['timeout', 'delivered', null],
  ] as const)('%s + ack %s → %s', (from, ack, expected) => {
    expect(applyAck(from, ack)).toBe(expected);
  });

  it('never leaves a terminal state except a late done after a timeout', () => {
    expect(canTransition('done', 'timeout')).toBe(false);
    expect(canTransition('pending', 'sent')).toBe(true);
  });

  it('makes unique ids that pass the command schema', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newCommandId(1_760_000_000_000)));
    expect(ids.size).toBe(50);
    const [id] = ids;
    expect(parseCommand(JSON.stringify({ id, op: 'reboot', args: {}, exp: '2026-10-14T11:32:20Z' })).ok).toBe(
      true,
    );
  });
});
