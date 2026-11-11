import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REBUILD_LIMITS } from '../../../src/core/schema.js';
import { RebuiltScheduleSchema } from '../../../src/core/index.js';
import type { RebuiltSchedule, RebuiltStep } from '../../../src/core/index.js';
import {
  applyCook,
  beginSession,
  canBegin,
  effectiveNow,
  endsAtMs,
  overdueIds,
  progressOf,
} from '../../../src/web/state/cook-session.js';
import type { CookCore, CookState, LogEntry, StepFact } from '../../../src/web/state/cook-slot.js';
import { AXIS_MS, cmAt, CM_C_FACTS, H1_SCHEDULE, SUNDAY_ROAST } from '../../support/fixtures.js';

const original = process.env['TZ'];
beforeAll(() => {
  process.env['TZ'] = 'Europe/London';
  expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
});
afterAll(() => {
  if (original === undefined) delete process.env['TZ'];
  else process.env['TZ'] = original;
});

const H1: RebuiltSchedule = RebuiltScheduleSchema.parse(H1_SCHEDULE);

function coreWith(facts: Record<string, StepFact>): CookCore {
  return {
    axisMs: AXIS_MS,
    plannedServingMs: AXIS_MS,
    beganAtMs: cmAt(17, 30),
    schedule: H1,
    facts,
    log: [],
  };
}

describe('effectiveNow (design, "Time mapping")', () => {
  it('CM5.2 is the clock when nothing is later', () => {
    expect(effectiveNow(coreWith(CM_C_FACTS), cmAt(18, 0))).toBe(cmAt(18, 0));
  });
  it('CM5.2 a fact later than the clock wins (a clock set back)', () => {
    // The shred ended 17:55:00; a clock reading 17:52 is absorbed.
    expect(effectiveNow(coreWith(CM_C_FACTS), cmAt(17, 52))).toBe(cmAt(17, 55));
  });
  it('CM5.2 the start of the session wins over an earlier clock', () => {
    expect(effectiveNow(coreWith({}), cmAt(17, 0))).toBe(cmAt(17, 30));
  });
});

describe('progressOf (CM5.2, CM-c facts)', () => {
  it('maps prep, shred and the running roast to axis minutes', () => {
    expect(progressOf(coreWith(CM_C_FACTS))).toEqual({
      'chicken.prep': { state: 'done', startMin: -110, endMin: -100 },
      'greens.shred': { state: 'done', startMin: -100, endMin: -95 },
      'chicken.roast': { state: 'running', startMin: -100, extraMin: 0 },
    });
  });
  it('floors an instant inside a minute', () => {
    const core = coreWith({
      'chicken.prep': {
        state: 'done',
        startedAtMs: cmAt(17, 40, 59),
        endedAtMs: cmAt(17, 50, 1),
      },
    });
    expect(progressOf(core)).toEqual({
      'chicken.prep': { state: 'done', startMin: -110, endMin: -100 },
    });
  });
});

describe('endsAtMs (CM4.1)', () => {
  const roast = SUNDAY_ROAST.steps.find((s) => s.id === 'chicken.roast');
  it('CM4.1 adds minutes and extra minutes to the recorded start', () => {
    if (roast === undefined) throw new Error('no roast');
    expect(endsAtMs(roast, { state: 'running', startedAtMs: cmAt(17, 50), extraMin: 0 })).toBe(
      cmAt(19, 5),
    );
    expect(endsAtMs(roast, { state: 'running', startedAtMs: cmAt(17, 50), extraMin: 15 })).toBe(
      cmAt(19, 20),
    );
  });
});

describe('thresholds that mirror core', () => {
  it('CM5.2 EXTRA_MAX equals core REBUILD_LIMITS.extraMax', async () => {
    const { EXTRA_MAX } = await import('../../../src/web/state/cook-session.js');
    const { REBUILD_LIMITS } = await import('../../../src/core/schema.js');
    expect(EXTRA_MAX).toBe(REBUILD_LIMITS.extraMax);
  });
});

function begun(nowMs: number): CookState {
  const result = beginSession(H1, AXIS_MS, nowMs);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`could not begin: ${result.error.kind}`);
  return result.value;
}

describe('CM-a canBegin, beginSession and start-now (CM1.1 to CM1.3)', () => {
  it('CM1.1 begins at 17:30 against the schedule, with no fact and no log entry', () => {
    const state = begun(cmAt(17, 30));
    expect(state.version).toBe(1);
    expect(state.core.axisMs).toBe(AXIS_MS);
    expect(state.core.plannedServingMs).toBe(AXIS_MS);
    expect(state.core.beganAtMs).toBe(cmAt(17, 30));
    expect(state.core.facts).toEqual({});
    expect(state.core.log).toEqual([]);
    expect(state.core.schedule.servingMin).toBe(0);
    expect(state.core.schedule.steps.map((s) => s.startMin).sort((a, b) => a - b)[0]).toBe(-110);
    expect(state.lastActiveMs).toBe(cmAt(17, 30));
    expect(state.alertsWanted).toBe(false);
    expect(state.undo).toBeNull();
  });

  it('CM1.4 begins exactly at the first start (17:40) with no entry', () => {
    const state = begun(cmAt(17, 40));
    expect(state.core.log).toEqual([]);
    expect(state.core.schedule.servingMin).toBe(0);
  });

  it('CM1.4 one minute late (17:41) logs begin-late by 1', () => {
    const state = begun(cmAt(17, 41));
    expect(state.core.log).toHaveLength(1);
    expect(state.core.log[0]?.cause).toEqual({ kind: 'begin-late', byMin: 1 });
  });

  it('CM1.5 canBegin is ok at 17:52 and too_late on Fri 19:30 (n = 2880 > 1440)', () => {
    expect(canBegin(H1, AXIS_MS, cmAt(17, 52))).toEqual({ ok: true, value: null });
    expect(canBegin(H1, AXIS_MS, cmAt(19 + 48, 30))).toEqual({
      ok: false,
      error: { kind: 'too_late' },
    });
    const late = beginSession(H1, AXIS_MS, cmAt(19 + 48, 30));
    expect(late).toEqual({ ok: false, error: { kind: 'too_late' } });
  });

  it('CM1.5 a schedule that fails its schema is invalid_schedule', () => {
    const broken = { ...H1, steps: [] } as unknown as RebuiltSchedule;
    expect(beginSession(broken, AXIS_MS, cmAt(17, 30))).toEqual({
      ok: false,
      error: { kind: 'invalid_schedule' },
    });
  });

  it('CM1.3 start-now at 17:30:00 moves the axis and the planned serving 10 min earlier', () => {
    const before = begun(cmAt(17, 30));
    const after = applyCook(before, { type: 'cook/start-now', nowMs: cmAt(17, 30) });
    expect(after.core.axisMs).toBe(cmAt(19, 20));
    expect(after.core.plannedServingMs).toBe(cmAt(19, 20));
    expect(after.core.schedule).toBe(before.core.schedule);
    expect(after.core.log).toEqual([]);
    expect(after.lastActiveMs).toBe(cmAt(17, 30));
    expect(after.undo?.label).toEqual({ kind: 'start-now' });
    expect(after.undo?.untilMs).toBe(cmAt(17, 30, 10));
    expect(after.undo?.before).toEqual(before.core);
  });

  it('CM1.3 start-now at 17:30:20 moves by the 10 whole minutes that reach the start (decided: rounded up)', () => {
    const after = applyCook(begun(cmAt(17, 30)), {
      type: 'cook/start-now',
      nowMs: cmAt(17, 30, 20),
    });
    expect(after.core.axisMs).toBe(cmAt(19, 20));
  });

  it('CM1.3 start-now after the start has passed returns the state itself', () => {
    const state = begun(cmAt(17, 30));
    expect(applyCook(state, { type: 'cook/start-now', nowMs: cmAt(17, 40) })).toBe(state);
  });

  it('CM1.3 start-now after a fact returns the state itself', () => {
    const state = begun(cmAt(17, 30));
    const withFact: CookState = {
      ...state,
      core: { ...state.core, facts: { 'chicken.prep': CM_C_FACTS['chicken.prep'] as StepFact } },
    };
    expect(applyCook(withFact, { type: 'cook/start-now', nowMs: cmAt(17, 31) })).toBe(withFact);
  });

  it('CM1.3 start-now after a log entry returns the state itself', () => {
    const late = begun(cmAt(17, 41));
    expect(applyCook(late, { type: 'cook/start-now', nowMs: cmAt(17, 41) })).toBe(late);
  });
});

describe('CM-b begin 12 minutes late (CM1.4, CM5.3)', () => {
  const lateState = (): CookState => begun(cmAt(17, 52));
  const rowsOf = (state: CookState): Record<string, RebuiltStep> =>
    Object.fromEntries(state.core.schedule.steps.map((s) => [s.id, s]));
  const intervalOf = (id: string): [number, number] => {
    const row = rowsOf(lateState())[id];
    return [row?.startMin ?? NaN, row?.endMin ?? NaN];
  };

  it('CM1.4 rebuilds with no facts: every interval of the hand-worked table', () => {
    expect(intervalOf('chicken.prep')).toEqual([-98, -88]);
    expect(intervalOf('chicken.roast')).toEqual([-88, -13]);
    expect(intervalOf('greens.shred')).toEqual([-88, -83]);
    expect(intervalOf('chicken.rest')).toEqual([-13, 7]);
    expect(intervalOf('gravy.roux')).toEqual([-7, -5]);
    expect(intervalOf('gravy.simmer')).toEqual([-5, 5]);
    expect(intervalOf('greens.boil')).toEqual([0, 4]);
    expect(intervalOf('greens.toss')).toEqual([4, 5]);
    expect(intervalOf('gravy.strain')).toEqual([5, 7]);
    expect(intervalOf('chicken.carve')).toEqual([7, 12]);
    expect(lateState().core.schedule.servingMin).toBe(12);
    expect(rowsOf(lateState())['greens.shred']?.slackMin).toBe(76);
  });

  it('CM1.4 keeps the planned serving time of before the rebuild', () => {
    expect(lateState().core.plannedServingMs).toBe(AXIS_MS);
  });

  it('CM5.3 logs one begin-late entry, moves in (toStartMin, id) order, serving 0 -> 12', () => {
    const state = lateState();
    expect(state.core.log).toHaveLength(1);
    const entry = state.core.log[0];
    expect(entry?.atMs).toBe(cmAt(17, 52));
    expect(entry?.cause).toEqual({ kind: 'begin-late', byMin: 12 });
    expect(entry?.result.ok).toBe(true);
    if (entry === undefined || !entry.result.ok) throw new Error('rebuild did not succeed');
    expect(entry.result.moved).toEqual([
      { stepId: 'chicken.prep', fromStartMin: -110, toStartMin: -98 },
      { stepId: 'chicken.roast', fromStartMin: -100, toStartMin: -88 },
      { stepId: 'greens.shred', fromStartMin: -100, toStartMin: -88 },
      { stepId: 'chicken.rest', fromStartMin: -25, toStartMin: -13 },
      { stepId: 'gravy.roux', fromStartMin: -20, toStartMin: -7 },
      { stepId: 'gravy.simmer', fromStartMin: -18, toStartMin: -5 },
      { stepId: 'greens.boil', fromStartMin: -10, toStartMin: 0 },
      { stepId: 'greens.toss', fromStartMin: -6, toStartMin: 4 },
      { stepId: 'gravy.strain', fromStartMin: -8, toStartMin: 5 },
      { stepId: 'chicken.carve', fromStartMin: -5, toStartMin: 7 },
    ]);
    expect(entry.result.unchanged).toEqual([]);
    expect(entry.result.servingFromMin).toBe(0);
    expect(entry.result.servingToMin).toBe(12);
  });

  it('CM5.5 the only new warning is greens.toss, ready 7 min early with a hold of 5', () => {
    const entry = lateState().core.log[0];
    expect(entry?.result.ok).toBe(true);
    if (entry === undefined || !entry.result.ok) throw new Error('rebuild did not succeed');
    expect(entry.result.newWarnings.map((w) => [w.stepId, w.waitMin, w.holdMin])).toEqual([
      ['greens.toss', 7, 5],
    ]);
  });
});

type Step = { at: number } & (
  | { do: 'start' | 'done'; id: string }
  | { do: 'extra'; id: string; minutes: 5 | 10 | 15 }
  | { do: 'behind' }
);

/** Applies the steps in order with `applyCook`. */
function run(state: CookState, ...steps: Step[]): CookState {
  let current = state;
  for (const step of steps) {
    if (step.do === 'behind') {
      current = applyCook(current, { type: 'cook/behind', nowMs: step.at });
    } else if (step.do === 'extra') {
      current = applyCook(current, {
        type: 'cook/extra',
        stepId: step.id,
        minutes: step.minutes,
        nowMs: step.at,
      });
    } else {
      current = applyCook(current, {
        type: step.do === 'start' ? 'cook/start' : 'cook/done',
        stepId: step.id,
        nowMs: step.at,
      });
    }
  }
  return current;
}

/** CM-c up to and including the shred, all on plan: the five taps of the design. */
const ON_PLAN: Step[] = [
  { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) },
  { do: 'done', id: 'chicken.prep', at: cmAt(17, 50) },
  { do: 'start', id: 'chicken.roast', at: cmAt(17, 50) },
  { do: 'start', id: 'greens.shred', at: cmAt(17, 50) },
  { do: 'done', id: 'greens.shred', at: cmAt(17, 55) },
];

function lastEntry(state: CookState): LogEntry {
  const entry = state.core.log.at(-1);
  expect(entry).not.toBeUndefined();
  if (entry === undefined) throw new Error('no log entry');
  return entry;
}

describe('CM-c step by step (CM3.1, CM5.1, CM5.3, CM5.5)', () => {
  it('CM5.1 the five on-plan taps record facts and log nothing; the schedule is untouched', () => {
    const start = begun(cmAt(17, 30));
    const after = run(start, ...ON_PLAN);
    expect(after.core.log).toEqual([]);
    expect(after.core.schedule).toBe(start.core.schedule);
    expect(after.core.facts).toEqual(CM_C_FACTS);
    expect(after.lastActiveMs).toBe(cmAt(17, 55));
  });

  it('CM5.1 +15 on the roast at 18:30 logs RB-a: order, unchanged, serving and the one warning', () => {
    const before = run(begun(cmAt(17, 30)), ...ON_PLAN);
    const after = run(before, { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });
    expect(after.core.facts['chicken.roast']).toEqual({
      state: 'running',
      startedAtMs: cmAt(17, 50),
      extraMin: 15,
    });
    const entry = lastEntry(after);
    expect(entry.atMs).toBe(cmAt(18, 30));
    expect(entry.cause).toEqual({ kind: 'extra', stepId: 'chicken.roast', minutes: 15 });
    expect(entry.result.ok).toBe(true);
    if (!entry.result.ok) return;
    expect(entry.result.moved).toEqual([
      { stepId: 'chicken.rest', fromStartMin: -25, toStartMin: -10 },
      { stepId: 'gravy.roux', fromStartMin: -20, toStartMin: -4 },
      { stepId: 'gravy.simmer', fromStartMin: -18, toStartMin: -2 },
      { stepId: 'greens.boil', fromStartMin: -10, toStartMin: 3 },
      { stepId: 'greens.toss', fromStartMin: -6, toStartMin: 7 },
      { stepId: 'gravy.strain', fromStartMin: -8, toStartMin: 8 },
      { stepId: 'chicken.carve', fromStartMin: -5, toStartMin: 10 },
    ]);
    expect(entry.result.unchanged).toEqual(['chicken.prep', 'chicken.roast', 'greens.shred']);
    expect([entry.result.servingFromMin, entry.result.servingToMin]).toEqual([0, 15]);
    expect(entry.result.newWarnings.map((w) => [w.stepId, w.waitMin, w.holdMin])).toEqual([
      ['greens.toss', 7, 5],
    ]);
    expect(after.core.schedule.servingMin).toBe(15);
    expect(after.undo?.label).toEqual({ kind: 'extra', stepId: 'chicken.roast', minutes: 15 });
    expect(after.undo?.untilMs).toBe(cmAt(18, 30, 10));
    expect(after.undo?.before).toEqual(before.core);
  });
});

describe("CM-d I'm behind (CM3.2)", () => {
  const FACTS: Step[] = [
    { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) },
    { do: 'done', id: 'chicken.prep', at: cmAt(17, 50) },
    { do: 'start', id: 'chicken.roast', at: cmAt(17, 50) },
  ];
  it('CM3.2 at 17:53 only the shred moves, to -97; nine steps stay; no serving change', () => {
    const before = run(begun(cmAt(17, 30)), ...FACTS);
    expect(before.core.log).toEqual([]);
    const after = run(before, { do: 'behind', at: cmAt(17, 53) });
    const entry = lastEntry(after);
    expect(entry.cause).toEqual({ kind: 'behind' });
    expect(entry.result.ok).toBe(true);
    if (!entry.result.ok) return;
    expect(entry.result.moved).toEqual([
      { stepId: 'greens.shred', fromStartMin: -100, toStartMin: -97 },
    ]);
    expect(entry.result.unchanged).toHaveLength(9);
    expect([entry.result.servingFromMin, entry.result.servingToMin]).toEqual([0, 0]);
    expect(entry.result.newWarnings).toEqual([]);
    expect(after.undo?.label).toEqual({ kind: 'behind' });
  });
  it('CM3.2 before any fact, while the countdown runs, behind returns the state itself', () => {
    const state = begun(cmAt(17, 30));
    expect(applyCook(state, { type: 'cook/behind', nowMs: cmAt(17, 35) })).toBe(state);
  });
});

describe('CM-e thresholds (SLIP_MIN 2)', () => {
  const PREP: Step[] = [
    { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) },
    { do: 'done', id: 'chicken.prep', at: cmAt(17, 50) },
  ];
  it('CM5.1 a start 2 min late (17:52) records the fact and logs nothing', () => {
    const before = run(begun(cmAt(17, 30)), ...PREP);
    const after = run(before, { do: 'start', id: 'chicken.roast', at: cmAt(17, 52) });
    expect(after.core.log).toEqual([]);
    expect(after.core.schedule).toBe(before.core.schedule);
    expect(after.core.facts['chicken.roast']).toEqual({
      state: 'running',
      startedAtMs: cmAt(17, 52),
      extraMin: 0,
    });
  });
  it('CM5.1 a start 3 min late (17:53) logs "chicken.roast started 3 min late" and pins the roast at -97', () => {
    const before = run(begun(cmAt(17, 30)), ...PREP);
    const after = run(before, { do: 'start', id: 'chicken.roast', at: cmAt(17, 53) });
    expect(after.core.log).toHaveLength(1);
    const entry = lastEntry(after);
    expect(entry.cause).toEqual({ kind: 'start', stepId: 'chicken.roast', byMin: 3 });
    expect(entry.result.ok).toBe(true);
    if (!entry.result.ok) return;
    expect(entry.result.moved).toContainEqual({
      stepId: 'chicken.roast',
      fromStartMin: -100,
      toStartMin: -97,
    });
    const roast = after.core.schedule.steps.find((s) => s.id === 'chicken.roast');
    // Pinned at -97 for 75 min: it ends at -22, so rest runs [-22,-2), carve [-2,3), serving 3.
    expect([roast?.startMin, roast?.endMin]).toEqual([-97, -22]);
    expect(after.core.schedule.servingMin).toBe(3);
  });
  it('CM5.1 a done 3 min early (prep at 17:47) logs byMin -3 and moves no start', () => {
    const before = run(begun(cmAt(17, 30)), {
      do: 'start',
      id: 'chicken.prep',
      at: cmAt(17, 40),
    });
    const after = run(before, { do: 'done', id: 'chicken.prep', at: cmAt(17, 47) });
    const entry = lastEntry(after);
    expect(entry.cause).toEqual({ kind: 'done', stepId: 'chicken.prep', byMin: -3 });
    expect(entry.result.ok).toBe(true);
    if (!entry.result.ok) return;
    expect(entry.result.moved).toEqual([]);
    expect(entry.result.servingToMin).toBe(0);
    expect(after.core.schedule.servingMin).toBe(0);
  });
  it('CM5.3 an early start (prep at 17:35) shows the pinned step in moved', () => {
    const after = run(begun(cmAt(17, 30)), { do: 'start', id: 'chicken.prep', at: cmAt(17, 35) });
    const entry = lastEntry(after);
    expect(entry.cause).toEqual({ kind: 'start', stepId: 'chicken.prep', byMin: -5 });
    expect(entry.result.ok).toBe(true);
    if (!entry.result.ok) return;
    expect(entry.result.moved).toEqual([
      { stepId: 'chicken.prep', fromStartMin: -110, toStartMin: -115 },
    ]);
  });
});

describe('CM3.7 invalid actions return the same object', () => {
  const running = run(begun(cmAt(17, 30)), ...ON_PLAN);
  it('start on a running step, start on a done step, start on an unknown id', () => {
    expect(
      applyCook(running, { type: 'cook/start', stepId: 'chicken.roast', nowMs: cmAt(18, 0) }),
    ).toBe(running);
    expect(
      applyCook(running, { type: 'cook/start', stepId: 'chicken.prep', nowMs: cmAt(18, 0) }),
    ).toBe(running);
    expect(
      applyCook(running, { type: 'cook/start', stepId: 'ghost.step', nowMs: cmAt(18, 0) }),
    ).toBe(running);
  });
  it('done on a pending step, on a done step, on an unknown id', () => {
    expect(
      applyCook(running, { type: 'cook/done', stepId: 'chicken.carve', nowMs: cmAt(18, 0) }),
    ).toBe(running);
    expect(
      applyCook(running, { type: 'cook/done', stepId: 'chicken.prep', nowMs: cmAt(18, 0) }),
    ).toBe(running);
    expect(
      applyCook(running, { type: 'cook/done', stepId: 'ghost.step', nowMs: cmAt(18, 0) }),
    ).toBe(running);
  });
  it('extra on a pending step, and extra of 7 minutes', () => {
    expect(
      applyCook(running, {
        type: 'cook/extra',
        stepId: 'chicken.carve',
        minutes: 5,
        nowMs: cmAt(18, 0),
      }),
    ).toBe(running);
    const seven = { type: 'cook/extra', stepId: 'chicken.roast', minutes: 7, nowMs: cmAt(18, 0) };
    expect(applyCook(running, seven as unknown as Parameters<typeof applyCook>[1])).toBe(running);
  });
});

describe('extra minutes and the log limit', () => {
  it('CM5.1 extraMin is capped at core REBUILD_LIMITS.extraMax', () => {
    const base = run(begun(cmAt(17, 30)), ...ON_PLAN);
    const near: CookState = {
      ...base,
      core: {
        ...base.core,
        facts: {
          ...base.core.facts,
          'chicken.roast': {
            state: 'running',
            startedAtMs: cmAt(17, 50),
            extraMin: REBUILD_LIMITS.extraMax - 5,
          },
        },
      },
    };
    const after = run(near, { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });
    expect(after.core.facts['chicken.roast']).toEqual({
      state: 'running',
      startedAtMs: cmAt(17, 50),
      extraMin: REBUILD_LIMITS.extraMax,
    });
  });
  it('CM5.3 the 21st log entry drops the oldest', () => {
    let state = run(begun(cmAt(17, 30)), {
      do: 'start',
      id: 'chicken.prep',
      at: cmAt(17, 40),
    });
    for (let k = 1; k <= 21; k += 1) {
      state = run(state, { do: 'behind', at: cmAt(17, 40 + k) });
    }
    expect(state.core.log).toHaveLength(20);
    expect(state.core.log[0]?.atMs).toBe(cmAt(17, 42));
    expect(state.core.log.at(-1)?.atMs).toBe(cmAt(18, 1));
  });
});

describe('CM-h undo (CM3.4, CM5.8)', () => {
  const before = run(begun(cmAt(17, 30)), ...ON_PLAN);
  const extra = (): CookState =>
    run(before, { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });

  it('CM3.4 at 18:30:05 the core is the one before the +15: H1, roast extra 0, empty log', () => {
    const after = applyCook(extra(), { type: 'cook/undo', nowMs: cmAt(18, 30, 5) });
    expect(after.core.log).toEqual([]);
    expect(after.core.schedule.servingMin).toBe(0);
    expect(after.core.facts['chicken.roast']).toEqual({
      state: 'running',
      startedAtMs: cmAt(17, 50),
      extraMin: 0,
    });
    expect(after.core).toEqual(before.core);
    expect(after.undo).toBeNull();
    expect(after.alertsWanted).toBe(false);
  });

  it('CM3.7 at 18:30:10 the window is over and undo returns the state itself', () => {
    const state = extra();
    expect(applyCook(state, { type: 'cook/undo', nowMs: cmAt(18, 30, 10) })).toBe(state);
  });

  it('CM3.7 undo with no slot returns the state itself', () => {
    const state = begun(cmAt(17, 30));
    expect(applyCook(state, { type: 'cook/undo', nowMs: cmAt(17, 30, 1) })).toBe(state);
  });

  it('CM3.4 undoing "Start now" restores the old axis', () => {
    const start = begun(cmAt(17, 30));
    const moved = applyCook(start, { type: 'cook/start-now', nowMs: cmAt(17, 30) });
    const back = applyCook(moved, { type: 'cook/undo', nowMs: cmAt(17, 30, 3) });
    expect(back.core.axisMs).toBe(AXIS_MS);
    expect(back.core.plannedServingMs).toBe(AXIS_MS);
  });
});

describe('CM-g overdue is shown, never rebuilt (design review Q4)', () => {
  const cmF = (): CookState => run(begun(cmAt(17, 30)), ...ON_PLAN);

  it('CM5.1 overdueIds at 19:10:00 (n = -20) are the rest and the roast, sorted', () => {
    expect(overdueIds(cmF().core, cmAt(19, 10))).toEqual(['chicken.rest', 'chicken.roast']);
  });
  it('CM5.1 overdueIds at 19:09:45 (n = -21) are empty', () => {
    expect(overdueIds(cmF().core, cmAt(19, 9, 45))).toEqual([]);
  });
  it('CM5.1 a keeps step within its slack is not overdue; at the end of its slack it is', () => {
    const state = run(
      begun(cmAt(17, 30)),
      { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) },
      { do: 'done', id: 'chicken.prep', at: cmAt(17, 50) },
      { do: 'start', id: 'chicken.roast', at: cmAt(17, 50) },
    );
    // The shred planned -100 has slack 75: overdue only from -25 (19:05).
    expect(overdueIds(state.core, cmAt(19, 4, 59))).toEqual([]);
    expect(overdueIds(state.core, cmAt(19, 5))).toEqual(['greens.shred']);
  });
  it('CM5.1 a tick changes nothing, even with steps overdue', () => {
    const state = cmF();
    expect(applyCook(state, { type: 'cook/tick', nowMs: cmAt(19, 10) })).toBe(state);
  });
  it('CM5.1 "I\'m behind" at 19:10:00 gives the E3 rebuild; a second tap logs "everything is on time"', () => {
    const first = run(cmF(), { do: 'behind', at: cmAt(19, 10) });
    const entry = lastEntry(first);
    expect(entry.cause).toEqual({ kind: 'behind' });
    expect(entry.result.ok).toBe(true);
    if (!entry.result.ok) return;
    expect(entry.result.moved).toEqual([
      { stepId: 'chicken.rest', fromStartMin: -25, toStartMin: -20 },
      { stepId: 'gravy.roux', fromStartMin: -20, toStartMin: -15 },
      { stepId: 'gravy.simmer', fromStartMin: -18, toStartMin: -13 },
      { stepId: 'greens.boil', fromStartMin: -10, toStartMin: -5 },
      { stepId: 'gravy.strain', fromStartMin: -8, toStartMin: -3 },
      { stepId: 'greens.toss', fromStartMin: -6, toStartMin: -1 },
      { stepId: 'chicken.carve', fromStartMin: -5, toStartMin: 0 },
    ]);
    expect(entry.result.unchanged).toEqual(['chicken.prep', 'chicken.roast', 'greens.shred']);
    expect([entry.result.servingFromMin, entry.result.servingToMin]).toEqual([0, 5]);
    expect(entry.result.newWarnings).toEqual([]);
    const second = run(first, { do: 'behind', at: cmAt(19, 10) });
    const again = lastEntry(second);
    expect(second.core.log).toHaveLength(2);
    expect(again.result.ok && again.result.moved).toEqual([]);
    expect(again.result.ok && again.result.servingToMin).toBe(5);
  });
});

describe('tick, resume and alerts (CM7.3)', () => {
  it('a tick keeps the undo slot', () => {
    const state = run(begun(cmAt(17, 30)), {
      do: 'start',
      id: 'chicken.prep',
      at: cmAt(17, 40),
    });
    const ticked = applyCook(state, { type: 'cook/tick', nowMs: cmAt(17, 40, 5) });
    expect(ticked.undo).toEqual(state.undo);
    expect(ticked.undo).not.toBeNull();
  });
  it('CM7.3 resume sets only lastActiveMs', () => {
    const state = run(begun(cmAt(17, 30)), ...ON_PLAN);
    const resumed = applyCook(state, { type: 'cook/resume', nowMs: cmAt(24 + 2, 0) });
    expect(resumed.lastActiveMs).toBe(cmAt(24 + 2, 0));
    expect(resumed.core).toBe(state.core);
    expect(resumed.undo).toBe(state.undo);
    expect(resumed.alertsWanted).toBe(state.alertsWanted);
  });
  it('CM4.4 alerts sets only alertsWanted, and the same value returns the state itself', () => {
    const state = begun(cmAt(17, 30));
    const on = applyCook(state, { type: 'cook/alerts', wanted: true });
    expect(on).toEqual({ ...state, alertsWanted: true });
    expect(applyCook(on, { type: 'cook/alerts', wanted: true })).toBe(on);
  });
});
