import { describe, expect, it } from 'vitest';
import { RebuiltScheduleSchema } from '../../../src/core/index.js';
import { beginSession } from '../../../src/web/state/cook-session.js';
import { CookStateSchema, reduceCook } from '../../../src/web/state/cook-slot.js';
import type { CookState } from '../../../src/web/state/cook-slot.js';
import { AXIS_MS, cmAt, CM_C_FACTS, H1_SCHEDULE } from '../../support/fixtures.js';

/** A hand-built session in the shape of the design's `CookCore`. */
function handCore(): Record<string, unknown> {
  return {
    axisMs: AXIS_MS,
    plannedServingMs: AXIS_MS,
    beganAtMs: cmAt(17, 30),
    schedule: RebuiltScheduleSchema.parse(H1_SCHEDULE),
    facts: { ...CM_C_FACTS },
    log: [],
  };
}

function handState(): Record<string, unknown> {
  return {
    version: 1,
    core: handCore(),
    lastActiveMs: cmAt(17, 55),
    alertsWanted: false,
    undo: null,
  };
}

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('CookStateSchema (CM7.1)', () => {
  it('CM7.1 accepts the JSON of a hand-built state', () => {
    expect(CookStateSchema.safeParse(roundTrip(handState())).success).toBe(true);
  });
  it('CM7.1 rejects a fact for a step that is not in the schedule', () => {
    const state = handState();
    const core = handCore();
    core['facts'] = { 'ghost.step': { state: 'running', startedAtMs: cmAt(17, 50), extraMin: 0 } };
    state['core'] = core;
    expect(CookStateSchema.safeParse(roundTrip(state)).success).toBe(false);
  });
  it('CM7.1 rejects an undo slot that holds a whole state instead of a core', () => {
    const state = handState();
    state['undo'] = {
      label: { kind: 'behind' },
      untilMs: cmAt(17, 56),
      before: handState(),
    };
    expect(CookStateSchema.safeParse(roundTrip(state)).success).toBe(false);
  });
  it('CM7.1 accepts an undo slot that holds a core', () => {
    const state = handState();
    state['undo'] = {
      label: { kind: 'behind' },
      untilMs: cmAt(17, 56),
      before: handCore(),
    };
    expect(CookStateSchema.safeParse(roundTrip(state)).success).toBe(true);
  });
  it('CM7.1 rejects a negative timestamp and an unknown key', () => {
    expect(CookStateSchema.safeParse({ ...handState(), lastActiveMs: -1 }).success).toBe(false);
    expect(CookStateSchema.safeParse({ ...handState(), extra: 1 }).success).toBe(false);
  });
});

describe('reduceCook (R9.9)', () => {
  const wrap = (cook: CookState | null): { cook: CookState | null; other: number } => ({
    cook,
    other: 7,
  });
  const begin = {
    type: 'cook/begin',
    schedule: H1_SCHEDULE,
    axisMs: AXIS_MS,
    nowMs: cmAt(17, 30),
  } as const;

  it('CM1.1 begin with no session sets one and leaves the rest of the state alone', () => {
    const next = reduceCook(wrap(null), begin);
    const expected = beginSession(H1_SCHEDULE, AXIS_MS, cmAt(17, 30));
    expect(expected.ok).toBe(true);
    expect(next.other).toBe(7);
    expect(next.cook?.core.axisMs).toBe(AXIS_MS);
    expect(next.cook?.core.beganAtMs).toBe(cmAt(17, 30));
    expect(next.cook?.version).toBe(1);
  });
  it('CM1.5 begin too late leaves cook null and returns the state itself', () => {
    const state = wrap(null);
    expect(reduceCook(state, { ...begin, nowMs: cmAt(19 + 48, 30) })).toBe(state);
  });
  it('CM1.1 begin with a session already there returns the state itself', () => {
    const first = reduceCook(wrap(null), begin);
    expect(reduceCook(first, { ...begin, nowMs: cmAt(17, 31) })).toBe(first);
  });
  it('CM8.3 stop clears the session; stop with none returns the state itself', () => {
    const first = reduceCook(wrap(null), begin);
    expect(reduceCook(first, { type: 'cook/stop' }).cook).toBeNull();
    const none = wrap(null);
    expect(reduceCook(none, { type: 'cook/stop' })).toBe(none);
  });
  it('CM3.7 an action with no session returns the state itself', () => {
    const none = wrap(null);
    expect(reduceCook(none, { type: 'cook/behind', nowMs: cmAt(17, 40) })).toBe(none);
  });
  it('CM3.7 an invalid action returns the state itself', () => {
    const first = reduceCook(wrap(null), begin);
    expect(
      reduceCook(first, { type: 'cook/done', stepId: 'chicken.prep', nowMs: cmAt(17, 40) }),
    ).toBe(first);
  });
  it('CM3.4 a valid action replaces cook with the applied state', () => {
    const first = reduceCook(wrap(null), begin);
    const next = reduceCook(first, {
      type: 'cook/start',
      stepId: 'chicken.prep',
      nowMs: cmAt(17, 40),
    });
    expect(next.cook?.core.facts['chicken.prep']).toEqual({
      state: 'running',
      startedAtMs: cmAt(17, 40),
      extraMin: 0,
    });
    expect(next.other).toBe(7);
  });
});
