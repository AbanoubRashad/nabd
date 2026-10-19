/**
 * Alert rule state machine. Pure functions: ingest feeds it readings and clock ticks, persists the returned
 * state, and carries out the returned effects (open/resolve an alert, send or log a notification).
 *
 *   ok ──breach──► pending ──held for_seconds──► firing ──clear──► (resolved) ok
 *                    │                            │  ▲
 *                    └──condition gone──► ok      ▼  │ mute expires
 *                                     acknowledged / muted ──clear──► (resolved) ok
 *
 * - Fires only after the condition has held for `for_seconds`.
 * - Clears only past `clear_threshold` (hysteresis), so a value hovering at the threshold doesn't flap.
 * - Never notifies twice within `cooldown_seconds`, across alerts on the same rule and device.
 * - Quiet hours hold back notifications, except for critical alerts.
 * - Optional escalation once an alert has been firing, unacknowledged, for `escalate_after_seconds`.
 */
import type { RuleOperator, Severity } from './seed.js';

export interface RuleConfig {
  operator: RuleOperator;
  threshold: number | null;
  thresholdHigh: number | null;
  /** For `offline` rules: how long a device may be silent. For value rules: how long the breach must hold. */
  forSeconds: number;
  clearThreshold: number | null;
  cooldownSeconds: number;
  severity: Severity;
  quietHours: { start: string; end: string } | null;
  /** IANA timezone used for quiet hours (the site's). */
  timezone: string;
  escalateAfterSeconds: number | null;
}

export type RuleStatus = 'ok' | 'pending' | 'firing' | 'acknowledged' | 'muted';

export interface RuleState {
  status: RuleStatus;
  /** When the current breach started (pending) or the alert opened (firing and later). */
  since: number | null;
  openedAt: number | null;
  /** Kept across alerts, so the cooldown also covers a flapping condition. */
  lastNotifiedAt: number | null;
  peak: number | null;
  mutedUntil: number | null;
  escalated: boolean;
}

export const INITIAL_RULE_STATE: RuleState = {
  status: 'ok',
  since: null,
  openedAt: null,
  lastNotifiedAt: null,
  peak: null,
  mutedUntil: null,
  escalated: false,
};

export type RuleInput =
  | { kind: 'reading'; at: number; value: number }
  /** Clock tick for silence detection, mute expiry and escalation. `lastSeenAt` is the device's last message. */
  | { kind: 'tick'; at: number; lastSeenAt: number | null }
  | { kind: 'ack'; at: number; by: string }
  | { kind: 'mute'; at: number; forSeconds: number };

export type NotifyReason = 'opened' | 'escalation' | 'resolved';

export type RuleEffect =
  | { type: 'open'; at: number; value: number | null }
  | { type: 'resolve'; at: number; peak: number | null }
  | { type: 'acknowledge'; at: number; by: string }
  | { type: 'mute'; at: number; until: number }
  | { type: 'notify'; at: number; reason: NotifyReason; value: number | null }
  /** A notification that was due but held back; it is still recorded on the alert's timeline. */
  | { type: 'suppressed'; at: number; reason: NotifyReason; why: 'quiet_hours' | 'cooldown' | 'muted' }
  | { type: 'pending'; at: number; value: number };

export interface RuleResult {
  state: RuleState;
  effects: RuleEffect[];
}

// ---- conditions -----------------------------------------------------------------------------------------

export function isBreach(rule: RuleConfig, value: number): boolean {
  const { operator, threshold, thresholdHigh } = rule;
  if (threshold === null) return false;
  switch (operator) {
    case 'gt':
      return value > threshold;
    case 'lt':
      return value < threshold;
    case 'outside':
      return value < threshold || (thresholdHigh !== null && value > thresholdHigh);
    case 'offline':
      return false;
  }
}

/** True once the value is back past the clear threshold (or simply out of breach if there is none). */
export function isCleared(rule: RuleConfig, value: number): boolean {
  const { operator, clearThreshold } = rule;
  if (clearThreshold === null || operator === 'outside') return !isBreach(rule, value);
  return operator === 'gt' ? value < clearThreshold : value > clearThreshold;
}

// ---- quiet hours ----------------------------------------------------------------------------------------

const clocks = new Map<string, Intl.DateTimeFormat>();

function minutesOfDay(at: number, timezone: string): number {
  let clock = clocks.get(timezone);
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    clocks.set(timezone, clock);
  }
  const parts = clock.formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

const parseHm = (hm: string) => {
  const [h = '0', m = '0'] = hm.split(':');
  return Number(h) * 60 + Number(m);
};

/** True inside the rule's quiet window, which may wrap past midnight (e.g. 23:00–06:00). */
export function inQuietHours(rule: Pick<RuleConfig, 'quietHours' | 'timezone'>, at: number): boolean {
  if (!rule.quietHours) return false;
  const now = minutesOfDay(at, rule.timezone);
  const start = parseHm(rule.quietHours.start);
  const end = parseHm(rule.quietHours.end);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

// ---- the machine ----------------------------------------------------------------------------------------

/** Sends a notification, or records why it was held back. Returns the updated `lastNotifiedAt`. */
function notify(
  rule: RuleConfig,
  state: RuleState,
  at: number,
  reason: NotifyReason,
  value: number | null,
  effects: RuleEffect[],
): number | null {
  if (
    reason !== 'resolved' &&
    state.lastNotifiedAt !== null &&
    at - state.lastNotifiedAt < rule.cooldownSeconds * 1000
  ) {
    effects.push({ type: 'suppressed', at, reason, why: 'cooldown' });
    return state.lastNotifiedAt;
  }
  if (rule.severity !== 'critical' && inQuietHours(rule, at)) {
    effects.push({ type: 'suppressed', at, reason, why: 'quiet_hours' });
    return state.lastNotifiedAt;
  }
  effects.push({ type: 'notify', at, reason, value });
  return reason === 'resolved' ? state.lastNotifiedAt : at;
}

function open(
  rule: RuleConfig,
  state: RuleState,
  at: number,
  value: number | null,
  effects: RuleEffect[],
): RuleState {
  effects.push({ type: 'open', at, value });
  const opened: RuleState = {
    ...state,
    status: 'firing',
    openedAt: at,
    peak: value,
    escalated: false,
    mutedUntil: null,
  };
  return { ...opened, lastNotifiedAt: notify(rule, opened, at, 'opened', value, effects) };
}

function resolve(
  rule: RuleConfig,
  state: RuleState,
  at: number,
  value: number | null,
  effects: RuleEffect[],
): RuleState {
  effects.push({ type: 'resolve', at, peak: state.peak });
  // A muted alert stays quiet when it clears; otherwise tell people it is over.
  if (state.status !== 'muted') notify(rule, state, at, 'resolved', value, effects);
  return { ...INITIAL_RULE_STATE, lastNotifiedAt: state.lastNotifiedAt };
}

const isOpen = (s: RuleStatus) => s === 'firing' || s === 'acknowledged' || s === 'muted';

const peakOf = (rule: RuleConfig, peak: number | null, value: number) => {
  if (peak === null) return value;
  return rule.operator === 'lt' ? Math.min(peak, value) : Math.max(peak, value);
};

export function evaluate(rule: RuleConfig, state: RuleState, input: RuleInput): RuleResult {
  const effects: RuleEffect[] = [];
  const at = input.at;

  if (input.kind === 'ack') {
    if (state.status === 'firing' || state.status === 'muted') {
      effects.push({ type: 'acknowledge', at, by: input.by });
      return { state: { ...state, status: 'acknowledged', mutedUntil: null }, effects };
    }
    return { state, effects };
  }

  if (input.kind === 'mute') {
    if (isOpen(state.status)) {
      const until = at + input.forSeconds * 1000;
      effects.push({ type: 'mute', at, until });
      return { state: { ...state, status: 'muted', mutedUntil: until }, effects };
    }
    return { state, effects };
  }

  if (input.kind === 'tick') {
    let next = state;
    // Offline rules are driven by silence, not by values.
    if (rule.operator === 'offline' && input.lastSeenAt !== null) {
      const silent = at - input.lastSeenAt >= rule.forSeconds * 1000;
      if (silent && next.status === 'ok')
        next = open(rule, { ...next, since: input.lastSeenAt }, at, null, effects);
      else if (!silent && isOpen(next.status))
        return { state: resolve(rule, next, at, null, effects), effects };
    }
    if (next.status === 'muted' && next.mutedUntil !== null && at >= next.mutedUntil) {
      next = { ...next, status: 'firing', mutedUntil: null };
    }
    if (
      next.status === 'firing' &&
      !next.escalated &&
      rule.escalateAfterSeconds !== null &&
      next.openedAt !== null &&
      at - next.openedAt >= rule.escalateAfterSeconds * 1000
    ) {
      effects.push({ type: 'notify', at, reason: 'escalation', value: next.peak });
      next = { ...next, escalated: true, lastNotifiedAt: at };
    }
    return { state: next, effects };
  }

  // A reading.
  if (rule.operator === 'offline') {
    // Any message proves the device is alive.
    if (isOpen(state.status)) return { state: resolve(rule, state, at, input.value, effects), effects };
    return { state, effects };
  }

  const { value } = input;
  const breach = isBreach(rule, value);

  switch (state.status) {
    case 'ok':
      if (!breach) return { state, effects };
      if (rule.forSeconds === 0)
        return { state: open(rule, { ...state, since: at }, at, value, effects), effects };
      effects.push({ type: 'pending', at, value });
      return { state: { ...state, status: 'pending', since: at, peak: value }, effects };

    case 'pending': {
      if (!breach) return { state: { ...state, status: 'ok', since: null, peak: null }, effects };
      const peak = peakOf(rule, state.peak, value);
      if (state.since !== null && at - state.since >= rule.forSeconds * 1000) {
        const opened = open(rule, { ...state, peak }, at, value, effects);
        return { state: { ...opened, peak }, effects };
      }
      return { state: { ...state, peak }, effects };
    }

    case 'firing':
    case 'acknowledged':
    case 'muted':
      if (isCleared(rule, value)) return { state: resolve(rule, state, at, value, effects), effects };
      return { state: { ...state, peak: peakOf(rule, state.peak, value) }, effects };
  }
}
