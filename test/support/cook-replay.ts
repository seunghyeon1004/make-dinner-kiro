import type { Schedule } from '../../src/core/schema.js';
import { applyCook, beginSession } from '../../src/web/state/cook-session.js';
import { reduceCook } from '../../src/web/state/cook-slot.js';
import type { CookAction, CookState } from '../../src/web/state/cook-slot.js';
import { cookActionFor } from './arbitraries.js';
import type { CookBegin, CookIntent } from './arbitraries.js';

export interface CookTraceEntry {
  action: CookAction;
  before: CookState;
  after: CookState;
  nowMs: number;
}

export interface CookReplay {
  /** The session `cook/begin` made, or null when the begin time was out of range. */
  begun: CookState | null;
  trace: CookTraceEntry[];
}

/** Begins a session and plays the intents with `reduceCook`; time only moves forward. */
export function replayCook(begin: CookBegin, intents: readonly CookIntent[]): CookReplay {
  let state: { cook: CookState | null } = { cook: null };
  state = reduceCook(state, {
    type: 'cook/begin',
    schedule: begin.schedule,
    axisMs: begin.axisMs,
    nowMs: begin.beginMs,
  });
  const begun = state.cook;
  if (begun === null) return { begun: null, trace: [] };
  const trace: CookTraceEntry[] = [];
  let nowMs = begin.beginMs;
  for (const intent of intents) {
    const before = state.cook;
    if (before === null) break;
    nowMs += intent.advanceSec * 1000;
    const action = cookActionFor(before, nowMs, intent);
    state = reduceCook(state, action);
    if (state.cook === null) break;
    trace.push({ action, before, after: state.cook, nowMs });
  }
  return { begun, trace };
}

/** A session begun at `nowMs`; fails the calling test when it cannot begin. */
export function beginAt(schedule: Schedule, axisMs: number, nowMs: number): CookState {
  const result = beginSession(schedule, axisMs, nowMs);
  if (!result.ok) throw new Error(`could not begin: ${result.error.kind}`);
  return result.value;
}

/** One tap of the cook, for tests that play a session by hand. */
export type CookTap = { at: number } & (
  | { do: 'start' | 'done'; id: string }
  | { do: 'extra'; id: string; minutes: 5 | 10 | 15 }
  | { do: 'behind' }
);

/** Applies the taps in order with `applyCook`. */
export function play(state: CookState, ...taps: CookTap[]): CookState {
  let current = state;
  for (const tap of taps) {
    if (tap.do === 'behind') {
      current = applyCook(current, { type: 'cook/behind', nowMs: tap.at });
    } else if (tap.do === 'extra') {
      current = applyCook(current, {
        type: 'cook/extra',
        stepId: tap.id,
        minutes: tap.minutes,
        nowMs: tap.at,
      });
    } else {
      current = applyCook(current, {
        type: tap.do === 'start' ? 'cook/start' : 'cook/done',
        stepId: tap.id,
        nowMs: tap.at,
      });
    }
  }
  return current;
}
