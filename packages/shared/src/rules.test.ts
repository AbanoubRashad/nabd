import { describe, expect, it } from 'vitest';
import {
  INITIAL_RULE_STATE,
  evaluate,
  inQuietHours,
  isBreach,
  isCleared,
  type RuleConfig,
  type RuleEffect,
  type RuleInput,
  type RuleState,
} from './rules.js';

const fridge: RuleConfig = {
  operator: 'gt',
  threshold: 8,
  thresholdHigh: null,
  forSeconds: 300,
  clearThreshold: 7.5,
  cooldownSeconds: 1800,
  severity: 'warning',
  quietHours: null,
  timezone: 'Africa/Cairo',
  escalateAfterSeconds: null,
};

const MIN = 60_000;
const T0 = Date.parse('2026-10-14T11:31:00Z'); // 14:31 in Cairo (UTC+3)

/** Runs inputs through the machine and returns the final state and every effect type in order. */
function run(rule: RuleConfig, inputs: RuleInput[], state: RuleState = INITIAL_RULE_STATE) {
  const effects: RuleEffect[] = [];
  for (const input of inputs) {
    const r = evaluate(rule, state, input);
    state = r.state;
    effects.push(...r.effects);
  }
  return {
    state,
    effects,
    types: effects.map((e) =>
      e.type === 'notify' || e.type === 'suppressed' ? `${e.type}:${e.reason}` : e.type,
    ),
  };
}

/** A reading every 2 s from `from` for `minutes`, all at `value` (or computed per step). */
const readings = (from: number, minutes: number, value: number | ((i: number) => number)): RuleInput[] =>
  Array.from({ length: (minutes * MIN) / 2000 }, (_, i) => ({
    kind: 'reading' as const,
    at: from + i * 2000,
    value: typeof value === 'number' ? value : value(i),
  }));

describe('conditions', () => {
  it.each([
    ['gt', 8.1, true],
    ['gt', 8, false],
    ['lt', 24.9, true],
    ['lt', 25, false],
  ] as const)('%s breach at %d is %s', (operator, value, expected) => {
    expect(isBreach({ ...fridge, operator, threshold: operator === 'gt' ? 8 : 25 }, value)).toBe(expected);
  });

  it('handles outside-range rules', () => {
    const range = { ...fridge, operator: 'outside' as const, threshold: 2, thresholdHigh: 8 };
    expect([1.9, 2, 5, 8, 8.1].map((v) => isBreach(range, v))).toEqual([true, false, false, false, true]);
  });

  it('clears only past the clear threshold (hysteresis)', () => {
    expect(isCleared(fridge, 7.9)).toBe(false);
    expect(isCleared(fridge, 7.5)).toBe(false);
    expect(isCleared(fridge, 7.4)).toBe(true);
    expect(isCleared({ ...fridge, operator: 'lt', threshold: 25, clearThreshold: 30 }, 29)).toBe(false);
  });
});

describe('the medicine fridge scenario (Phase 4 acceptance)', () => {
  it('opens after 5 minutes, sends one message, accepts an ack and resolves below 7.5 °C', () => {
    const inputs: RuleInput[] = [
      ...readings(T0, 5.5, 8.3), // 14:31 crosses 8 °C, stays warm
      { kind: 'ack', at: T0 + 7 * MIN, by: 'whatsapp:clinic-manager' },
      ...readings(T0 + 7 * MIN, 2, 7.8), // cooling, still above the clear threshold
      ...readings(T0 + 9 * MIN, 1, 7.3), // clears
    ];
    const { state, effects, types } = run(fridge, inputs);

    expect(types.filter((t) => t !== 'resolve')).toEqual([
      'pending',
      'open',
      'notify:opened',
      'acknowledge',
      'notify:resolved',
    ]);
    const opened = effects.find((e) => e.type === 'open');
    expect(opened?.at).toBe(T0 + 5 * MIN); // 14:36, as in the design
    expect(effects.filter((e) => e.type === 'resolve')).toHaveLength(1);
    expect(state.status).toBe('ok');
  });

  it('does not fire if the door is shut before 5 minutes', () => {
    const { types } = run(fridge, [...readings(T0, 4, 8.4), ...readings(T0 + 4 * MIN, 2, 6)]);
    expect(types).toEqual(['pending']);
  });

  it('does not flap while the value hovers between 7.5 and 8 °C', () => {
    const hover = readings(T0 + 6 * MIN, 10, (i) => (i % 2 ? 7.6 : 8.2));
    const { types } = run(fridge, [...readings(T0, 6, 8.3), ...hover]);
    expect(types).toEqual(['pending', 'open', 'notify:opened']);
  });

  it('never notifies twice within the cooldown, even across two alerts', () => {
    const first = [...readings(T0, 6, 8.5), ...readings(T0 + 6 * MIN, 1, 7)];
    const second = [...readings(T0 + 10 * MIN, 6, 8.5), ...readings(T0 + 16 * MIN, 1, 7)];
    const third = [...readings(T0 + 40 * MIN, 6, 8.5)]; // 40 min after the first message: past the 30-min cooldown
    const { types } = run(fridge, [...first, ...second, ...third]);
    expect(types.filter((t) => t.startsWith('notify:opened') || t.startsWith('suppressed'))).toEqual([
      'notify:opened',
      'suppressed:opened',
      'notify:opened',
    ]);
  });

  it('tracks the peak value of the alert', () => {
    const { effects } = run(fridge, [
      ...readings(T0, 6, (i) => 8.1 + i * 0.002),
      ...readings(T0 + 6 * MIN, 1, 7),
    ]);
    const resolved = effects.find((e) => e.type === 'resolve');
    expect(resolved && resolved.type === 'resolve' && resolved.peak).toBeCloseTo(8.1 + 179 * 0.002, 5);
  });
});

describe('quiet hours', () => {
  const greenhouse: RuleConfig = {
    ...fridge,
    threshold: 35,
    clearThreshold: 33,
    forSeconds: 600,
    quietHours: { start: '23:00', end: '06:00' },
  };

  it('wraps past midnight in the site timezone', () => {
    const cairo = (hhmm: string) => Date.parse(`2026-10-14T${hhmm}:00+03:00`);
    expect(inQuietHours(greenhouse, cairo('22:59'))).toBe(false);
    expect(inQuietHours(greenhouse, cairo('23:00'))).toBe(true);
    expect(inQuietHours(greenhouse, cairo('03:00'))).toBe(true);
    expect(inQuietHours(greenhouse, cairo('06:00'))).toBe(false);
  });

  it('holds back warnings at night but still opens the alert', () => {
    const night = Date.parse('2026-10-14T01:00:00+03:00');
    const { types } = run(greenhouse, readings(night, 11, 36));
    expect(types).toEqual(['pending', 'open', 'suppressed:opened']);
  });

  it('lets critical alerts through at night', () => {
    const night = Date.parse('2026-10-14T01:00:00+03:00');
    const { types } = run({ ...greenhouse, severity: 'critical' }, readings(night, 11, 36));
    expect(types).toEqual(['pending', 'open', 'notify:opened']);
  });
});

describe('offline rule', () => {
  const offline: RuleConfig = {
    ...fridge,
    operator: 'offline',
    threshold: null,
    clearThreshold: null,
    forSeconds: 300,
    cooldownSeconds: 3600,
    severity: 'critical',
  };

  it('fires after 5 minutes of silence and resolves on the next message', () => {
    const lastSeen = T0;
    const { types, state } = run(offline, [
      { kind: 'tick', at: T0 + 4 * MIN, lastSeenAt: lastSeen },
      { kind: 'tick', at: T0 + 5 * MIN, lastSeenAt: lastSeen },
      { kind: 'tick', at: T0 + 6 * MIN, lastSeenAt: lastSeen },
      { kind: 'reading', at: T0 + 15 * MIN, value: 0 },
    ]);
    expect(types).toEqual(['open', 'notify:opened', 'resolve', 'notify:resolved']);
    expect(state.status).toBe('ok');
  });
});

describe('acknowledge, mute and escalation', () => {
  it('escalates once if nobody acknowledges within 15 minutes', () => {
    const rule = { ...fridge, escalateAfterSeconds: 900 };
    const opened = run(rule, readings(T0, 5.1, 9));
    const { types } = run(
      rule,
      [
        { kind: 'tick', at: T0 + 19 * MIN, lastSeenAt: null },
        { kind: 'tick', at: T0 + 20 * MIN, lastSeenAt: null },
        { kind: 'tick', at: T0 + 25 * MIN, lastSeenAt: null },
      ],
      opened.state,
    );
    expect(types).toEqual(['notify:escalation']);
  });

  it('does not escalate an acknowledged alert', () => {
    const rule = { ...fridge, escalateAfterSeconds: 900 };
    const { types } = run(rule, [
      ...readings(T0, 5.1, 9),
      { kind: 'ack', at: T0 + 6 * MIN, by: 'u' },
      { kind: 'tick', at: T0 + 30 * MIN, lastSeenAt: null },
    ]);
    expect(types).not.toContain('notify:escalation');
  });

  it('mutes for an hour (WhatsApp reply 2), stays quiet when it clears, then returns to firing if still warm', () => {
    const opened = run(fridge, readings(T0, 5.1, 9));
    const muted = run(fridge, [{ kind: 'mute', at: T0 + 6 * MIN, forSeconds: 3600 }], opened.state);
    expect(muted.state.status).toBe('muted');
    const later = run(fridge, [{ kind: 'tick', at: T0 + 67 * MIN, lastSeenAt: null }], muted.state);
    expect(later.state.status).toBe('firing');
    const clearedWhileMuted = run(fridge, readings(T0 + 10 * MIN, 0.1, 7), muted.state);
    expect(clearedWhileMuted.types).toEqual(['resolve']);
  });
});
