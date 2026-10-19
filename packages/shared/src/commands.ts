/**
 * Command lifecycle, shared by the API (which owns the rows) and the web app (which shows the steps).
 *
 *   pending ──published──► sent ──ack delivered──► delivered ──ack done──► done
 *      │                    │                        │
 *      └────────────────────┴────── ack rejected ────┴──► rejected
 *                           └────── no ack in 10 s ──────► timeout
 *
 * A late `done` after a timeout is still accepted, because the device really did switch: the UI then
 * shows the real relay state instead of the stale one.
 */
import type { AckState } from './schemas.js';

export const COMMAND_STATES = ['pending', 'sent', 'delivered', 'done', 'rejected', 'timeout'] as const;
export type CommandState = (typeof COMMAND_STATES)[number];

/** How long the API waits for `done` before marking a command timed out. */
export const COMMAND_TIMEOUT_MS = 10_000;
/** Commands carry an expiry; devices drop expired ones. A little longer than the timeout. */
export const COMMAND_EXPIRY_MS = 15_000;

export const TERMINAL_STATES: ReadonlySet<CommandState> = new Set(['done', 'rejected', 'timeout']);

const NEXT: Record<CommandState, readonly CommandState[]> = {
  pending: ['sent', 'rejected', 'timeout'],
  sent: ['delivered', 'done', 'rejected', 'timeout'],
  delivered: ['done', 'rejected', 'timeout'],
  done: [],
  rejected: [],
  timeout: ['done'],
};

export function canTransition(from: CommandState, to: CommandState): boolean {
  return NEXT[from].includes(to);
}

/** Applies a device ack. Returns the new state, or null if the ack is stale or out of order. */
export function applyAck(current: CommandState, ack: AckState): CommandState | null {
  return canTransition(current, ack) ? ack : null;
}

let counter = 0;
/** Command ids look like the design's `c-2041`: a time-based prefix keeps them unique across restarts. */
export function newCommandId(now = Date.now()): string {
  counter = (counter + 1) % 1000;
  return `c-${now.toString(36)}-${counter.toString().padStart(3, '0')}`;
}
