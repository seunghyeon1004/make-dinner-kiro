import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schedule } from '../../../src/core/index.js';
import type { Schedule } from '../../../src/core/index.js';
import { applyCook } from '../../../src/web/state/cook-session.js';
import {
  announcementFor,
  cookView,
  finishedBetween,
  focusAfter,
} from '../../../src/web/state/cook-view.js';
import type { CardStep } from '../../../src/web/state/cook-view.js';
import { beginAt, play } from '../../support/cook-replay.js';
import type { CookTap } from '../../support/cook-replay.js';
import {
  AXIS_MS,
  cmAt,
  H1_SCHEDULE,
  SUNDAY_ROAST,
  TWO_COOK_KITCHEN,
} from '../../support/fixtures.js';

const original = process.env['TZ'];
beforeAll(() => {
  process.env['TZ'] = 'Europe/London';
  expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
});
afterAll(() => {
  if (original === undefined) delete process.env['TZ'];
  else process.env['TZ'] = original;
});

const MIN = 60_000;

/** CM-c up to and including the shred, all on plan; the state of CM-f at 17:56. */
const ON_PLAN: CookTap[] = [
  { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) },
  { do: 'done', id: 'chicken.prep', at: cmAt(17, 50) },
  { do: 'start', id: 'chicken.roast', at: cmAt(17, 50) },
  { do: 'start', id: 'greens.shred', at: cmAt(17, 50) },
  { do: 'done', id: 'greens.shred', at: cmAt(17, 55) },
];

const cmF = () => play(beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30)), ...ON_PLAN);

const ROAST_RUNNING_AT_1756: CardStep = {
  stepId: 'chicken.roast',
  title: 'Roast the chicken',
  detail: null,
  dishName: 'Roast chicken',
  minutes: 75,
  handsOn: false,
  plannedStartMs: cmAt(17, 50),
  state: 'running',
  startedAtMs: cmAt(17, 50),
  endsAtMs: cmAt(19, 5),
  remainingMs: 69 * MIN,
  waitsFor: [],
  lateByMin: null,
};

describe('CM-a countdown, then Start now (CM1.2, CM1.3)', () => {
  const start = () => beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30));

  it('CM1.2 at 17:30 the phase is countdown, the start 17:40, serving 19:30, nothing due', () => {
    const view = cookView(start(), cmAt(17, 30));
    expect(view.phase).toBe('countdown');
    expect(view.startMs).toBe(cmAt(17, 40));
    expect(view.servingMs).toBe(cmAt(19, 30));
    expect(view.plannedServingMs).toBe(cmAt(19, 30));
    expect(view.lanes).toEqual([
      {
        cookLane: 1,
        current: null,
        also: [],
        next: { title: 'Season and truss the chicken', startMs: cmAt(17, 40) },
      },
    ]);
    expect(view.toStart).toEqual([]);
    expect(view.running).toEqual([]);
    expect(view.dock).toBeNull();
    expect(view.undo).toBeNull();
    expect(view.finished).toBeNull();
    expect(view.log).toEqual([]);
  });

  it('CM2.6 up next is the first three by (start, id) with minutes ceiled', () => {
    expect(cookView(start(), cmAt(17, 30, 30)).upNext).toEqual([
      {
        stepId: 'chicken.prep',
        title: 'Season and truss the chicken',
        dishName: 'Roast chicken',
        startMs: cmAt(17, 40),
        inMin: 10,
      },
      {
        stepId: 'chicken.roast',
        title: 'Roast the chicken',
        dishName: 'Roast chicken',
        startMs: cmAt(17, 50),
        inMin: 20,
      },
      {
        stepId: 'greens.shred',
        title: 'Shred the greens',
        dishName: 'Spring greens',
        startMs: cmAt(17, 50),
        inMin: 20,
      },
    ]);
  });

  it('CM2.7 the dish strip names the next start of each dish', () => {
    expect(cookView(start(), cmAt(17, 30)).dishes).toEqual([
      {
        dishId: 'chicken',
        name: 'Roast chicken',
        done: 0,
        total: 4,
        state: { kind: 'next', startMs: cmAt(17, 40) },
      },
      {
        dishId: 'gravy',
        name: 'Gravy',
        done: 0,
        total: 3,
        state: { kind: 'next', startMs: cmAt(19, 10) },
      },
      {
        dishId: 'greens',
        name: 'Spring greens',
        done: 0,
        total: 3,
        state: { kind: 'next', startMs: cmAt(17, 50) },
      },
    ]);
  });

  it('CM1.3 after Start now at 17:30 the phase is cooking, prep is due in lane 1 and in the dock', () => {
    const state = applyCook(start(), { type: 'cook/start-now', nowMs: cmAt(17, 30) });
    const view = cookView(state, cmAt(17, 30));
    expect(view.phase).toBe('cooking');
    expect(view.servingMs).toBe(cmAt(19, 20));
    expect(view.plannedServingMs).toBe(cmAt(19, 20));
    expect(view.lanes[0]?.current).toEqual({
      stepId: 'chicken.prep',
      title: 'Season and truss the chicken',
      detail: null,
      dishName: 'Roast chicken',
      minutes: 10,
      handsOn: true,
      plannedStartMs: cmAt(17, 30),
      state: 'due',
      startedAtMs: null,
      endsAtMs: null,
      remainingMs: null,
      waitsFor: [],
      lateByMin: null,
    });
    expect(view.dock).toEqual({ stepId: 'chicken.prep', action: 'start' });
    expect(view.undo).toEqual({ label: { kind: 'start-now' }, untilMs: cmAt(17, 30, 10) });
  });

  it('CM3.4 the undo is gone from the view at its end instant', () => {
    const state = applyCook(start(), { type: 'cook/start-now', nowMs: cmAt(17, 30) });
    expect(cookView(state, cmAt(17, 30, 9)).undo).not.toBeNull();
    expect(cookView(state, cmAt(17, 30, 10)).undo).toBeNull();
  });
});

describe('CM2.2 to CM2.4 due steps in one lane', () => {
  it('lane 1 keeps the earliest due hands-on step and lists the next in also; the hands-free roast waits for prep', () => {
    const view = cookView(beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30)), cmAt(17, 50));
    expect(view.lanes[0]?.current?.stepId).toBe('chicken.prep');
    expect(view.lanes[0]?.also.map((c) => c.stepId)).toEqual(['greens.shred']);
    expect(view.toStart.map((c) => [c.stepId, c.waitsFor])).toEqual([
      ['chicken.roast', ['Season and truss the chicken']],
    ]);
    // Prep was planned for 17:40 with no slack: at 17:50 it is 10 minutes late.
    expect(view.lanes[0]?.current?.lateByMin).toBe(10);
  });
});

describe('CM-c after the +15 (CM2.5, CM3.4)', () => {
  const state = () =>
    play(cmF(), { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });

  it('shows the roast running to 19:20 with 50 minutes left, a free lane, no dock, an undo', () => {
    const view = cookView(state(), cmAt(18, 30));
    expect(view.phase).toBe('cooking');
    expect(view.servingMs).toBe(cmAt(19, 45));
    expect(view.plannedServingMs).toBe(cmAt(19, 30));
    expect(view.running).toEqual([
      { ...ROAST_RUNNING_AT_1756, endsAtMs: cmAt(19, 20), remainingMs: 50 * MIN },
    ]);
    expect(view.lanes).toEqual([
      {
        cookLane: 1,
        current: null,
        also: [],
        next: { title: 'Make a roux in the roasting tin', startMs: cmAt(19, 26) },
      },
    ]);
    expect(view.dock).toBeNull();
    expect(view.undo).toEqual({
      label: { kind: 'extra', stepId: 'chicken.roast', minutes: 15 },
      untilMs: cmAt(18, 30, 10),
    });
    expect(view.log).toHaveLength(1);
  });
});

describe('CM-f nothing due (CM2.1 to CM2.7)', () => {
  it('17:56: field by field', () => {
    const view = cookView(cmF(), cmAt(17, 56));
    expect(view.phase).toBe('cooking');
    expect(view.lanes).toEqual([
      {
        cookLane: 1,
        current: null,
        also: [],
        next: { title: 'Make a roux in the roasting tin', startMs: cmAt(19, 10) },
      },
    ]);
    expect(view.toStart).toEqual([]);
    expect(view.running).toEqual([ROAST_RUNNING_AT_1756]);
    expect(view.upNext).toEqual([
      {
        stepId: 'chicken.rest',
        title: 'Rest the chicken under foil',
        dishName: 'Roast chicken',
        startMs: cmAt(19, 5),
        inMin: 69,
      },
      {
        stepId: 'gravy.roux',
        title: 'Make a roux in the roasting tin',
        dishName: 'Gravy',
        startMs: cmAt(19, 10),
        inMin: 74,
      },
      {
        stepId: 'gravy.simmer',
        title: 'Add stock and let the gravy thicken',
        dishName: 'Gravy',
        startMs: cmAt(19, 12),
        inMin: 76,
      },
    ]);
    expect(view.dishes).toEqual([
      { dishId: 'chicken', name: 'Roast chicken', done: 1, total: 4, state: { kind: 'cooking' } },
      {
        dishId: 'gravy',
        name: 'Gravy',
        done: 0,
        total: 3,
        state: { kind: 'next', startMs: cmAt(19, 10) },
      },
      {
        dishId: 'greens',
        name: 'Spring greens',
        done: 1,
        total: 3,
        state: { kind: 'next', startMs: cmAt(19, 20) },
      },
    ]);
    expect(view.dock).toBeNull();
    expect(view.emphasiseBehind).toBe(false);
    expect(view.undo).toBeNull();
  });

  it('CM2.8 a done step is in no section', () => {
    const view = cookView(cmF(), cmAt(17, 56));
    const shown = [
      ...view.lanes.flatMap((l) => [l.current, ...l.also]),
      ...view.toStart,
      ...view.running,
    ].flatMap((c) => (c === null ? [] : [c.stepId]));
    expect(shown).not.toContain('chicken.prep');
    expect(shown).not.toContain('greens.shred');
    expect(view.upNext.map((u) => u.stepId)).not.toContain('greens.shred');
  });
});

describe('time up, late steps and blocked starts (CM2.3, CM2.5, review Q4)', () => {
  it('CM2.5 the roast at 19:06 has -60000 ms left and the dock says Done', () => {
    const view = cookView(cmF(), cmAt(19, 6));
    expect(view.running[0]?.remainingMs).toBe(-MIN);
    expect(view.dock).toEqual({ stepId: 'chicken.roast', action: 'done' });
  });

  it('CM2.3 a due roux with the roast running waits for "Roast the chicken"; the rest does too', () => {
    const view = cookView(cmF(), cmAt(19, 10));
    expect(view.lanes[0]?.current?.stepId).toBe('gravy.roux');
    expect(view.lanes[0]?.current?.detail).toBe(
      'Use the juices left in the tin once the chicken is out.',
    );
    expect(view.lanes[0]?.current?.waitsFor).toEqual(['Roast the chicken']);
    expect(view.toStart.map((c) => [c.stepId, c.waitsFor])).toEqual([
      ['chicken.rest', ['Roast the chicken']],
    ]);
    expect(view.dock).toEqual({ stepId: 'gravy.roux', action: 'start' });
  });

  it('review Q4 at 19:10 the roast and the rest show late by 5 min and "I\'m behind" is emphasised; nothing moved', () => {
    const state = cmF();
    const view = cookView(state, cmAt(19, 10));
    expect(view.running[0]?.lateByMin).toBe(5);
    expect(view.toStart[0]?.lateByMin).toBe(5);
    expect(view.emphasiseBehind).toBe(true);
    expect(view.servingMs).toBe(cmAt(19, 30));
    expect(view.log).toEqual([]);
    expect(cookView(state, cmAt(19, 9, 45)).emphasiseBehind).toBe(false);
  });
});

describe('CM-i several cooks (CM2.2)', () => {
  const scheduled = (): Schedule => {
    const result = schedule(SUNDAY_ROAST, TWO_COOK_KITCHEN);
    if (!result.ok) throw new Error('no schedule');
    return result.value;
  };

  it('one card per cook lane: prep for Cook 1, shred for Cook 2; up next roast, rest, roux', () => {
    const state = beginAt(scheduled(), AXIS_MS, cmAt(17, 40));
    const view = cookView(state, cmAt(17, 40));
    expect(view.lanes.map((l) => [l.cookLane, l.current?.stepId])).toEqual([
      [1, 'chicken.prep'],
      [2, 'greens.shred'],
    ]);
    expect(view.upNext.map((u) => [u.stepId, u.startMs])).toEqual([
      ['chicken.roast', cmAt(17, 50)],
      ['chicken.rest', cmAt(19, 5)],
      ['gravy.roux', cmAt(19, 15)],
    ]);
  });

  it('when the shred is done at 17:45 lane 2 is free and its next step is the strain at 19:27', () => {
    const state = play(
      beginAt(scheduled(), AXIS_MS, cmAt(17, 40)),
      { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) },
      { do: 'start', id: 'greens.shred', at: cmAt(17, 40) },
      { do: 'done', id: 'greens.shred', at: cmAt(17, 45) },
    );
    const view = cookView(state, cmAt(17, 45));
    expect(view.lanes[0]?.current?.stepId).toBe('chicken.prep');
    expect(view.lanes[0]?.current?.state).toBe('running');
    expect(view.lanes[1]).toEqual({
      cookLane: 2,
      current: null,
      also: [],
      next: { title: 'Strain the gravy into a jug', startMs: cmAt(19, 27) },
    });
  });
});

/** H1 followed exactly: each step started and done at its planned times. */
function h1Taps(carveDoneAt: number | null): CookTap[] {
  const events: { at: number; order: number; tap: CookTap }[] = [];
  for (const row of H1_SCHEDULE.steps) {
    const endAt =
      row.id === 'chicken.carve' && carveDoneAt !== null
        ? carveDoneAt
        : cmAt(19, 30) + row.endMin * MIN;
    events.push({
      at: cmAt(19, 30) + row.startMin * MIN,
      order: 1,
      tap: { do: 'start', id: row.id, at: cmAt(19, 30) + row.startMin * MIN },
    });
    events.push({ at: endAt, order: 0, tap: { do: 'done', id: row.id, at: endAt } });
  }
  return events.sort((a, b) => a.at - b.at || a.order - b.order).map((e) => e.tap);
}

describe('CM-j finished (CM8.1)', () => {
  it('H1 followed exactly: finished, served 19:30, planned 19:30', () => {
    const state = play(beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30)), ...h1Taps(null));
    const view = cookView(state, cmAt(19, 30));
    expect(view.phase).toBe('finished');
    expect(view.finished).toEqual({ servedMs: cmAt(19, 30), plannedMs: cmAt(19, 30) });
    expect(view.lanes.flatMap((l) => (l.current === null ? [] : [l.current]))).toEqual([]);
    expect(view.upNext).toEqual([]);
  });
  it('carve done at 19:33: served 19:33, planned 19:30', () => {
    const state = play(beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30)), ...h1Taps(cmAt(19, 33)));
    expect(cookView(state, cmAt(19, 33)).finished).toEqual({
      servedMs: cmAt(19, 33),
      plannedMs: cmAt(19, 30),
    });
  });
});

describe('CM-k stale (CM7.3)', () => {
  const stale = () => ({ ...cmF(), lastActiveMs: cmAt(17, 56) });
  it('8 h 4 min after the last action the phase is stale', () => {
    expect(cookView(stale(), cmAt(24 + 2, 0)).phase).toBe('stale');
  });
  it('7 h 59 min after the last action the phase is cooking', () => {
    expect(cookView(stale(), cmAt(24 + 1, 55)).phase).toBe('cooking');
  });
});

const viewsAround = (
  state: ReturnType<typeof cmF>,
  action: Parameters<typeof applyCook>[1],
  beforeMs: number,
) => {
  const after = applyCook(state, action);
  return { before: cookView(state, beforeMs), after: cookView(after, beforeMs), state: after };
};

describe('focusAfter (CM9.3), one case per row of the focus rule', () => {
  const begun = () => beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30));

  it('start s: the Done button of s', () => {
    const action = { type: 'cook/start', stepId: 'chicken.prep', nowMs: cmAt(17, 40) } as const;
    const v = viewsAround(begun(), action, cmAt(17, 40));
    expect(focusAfter(action, v.before, v.after)).toEqual({
      kind: 'action',
      stepId: 'chicken.prep',
      action: 'done',
    });
  });
  it('done s: the heading of the card now holding the lane', () => {
    const state = play(begun(), { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) });
    const action = { type: 'cook/done', stepId: 'chicken.prep', nowMs: cmAt(17, 50) } as const;
    const v = viewsAround(state, action, cmAt(17, 50));
    expect(focusAfter(action, v.before, v.after)).toEqual({
      kind: 'heading',
      id: 'card-greens.shred',
    });
  });
  it('done s: with the lane free, the next running card', () => {
    const state = play(begun(), ...ON_PLAN.slice(0, 4));
    const action = { type: 'cook/done', stepId: 'greens.shred', nowMs: cmAt(17, 55) } as const;
    const v = viewsAround(state, action, cmAt(17, 55));
    expect(focusAfter(action, v.before, v.after)).toEqual({
      kind: 'heading',
      id: 'card-chicken.roast',
    });
  });
  it('done s: with nothing to show, the Do now heading', () => {
    const two = schedule(SUNDAY_ROAST, TWO_COOK_KITCHEN);
    if (!two.ok) throw new Error('no schedule');
    const state = play(
      beginAt(two.value, AXIS_MS, cmAt(17, 40)),
      { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) },
      { do: 'start', id: 'greens.shred', at: cmAt(17, 40) },
    );
    const action = { type: 'cook/done', stepId: 'greens.shred', nowMs: cmAt(17, 45) } as const;
    const v = viewsAround(state, action, cmAt(17, 45));
    expect(focusAfter(action, v.before, v.after)).toEqual({ kind: 'heading', id: 'do-now' });
  });
  it('extra and behind: focus stays where it is', () => {
    const extra = {
      type: 'cook/extra',
      stepId: 'chicken.roast',
      minutes: 5,
      nowMs: cmAt(18, 0),
    } as const;
    const a = viewsAround(cmF(), extra, cmAt(18, 0));
    expect(focusAfter(extra, a.before, a.after)).toBeNull();
    const behind = { type: 'cook/behind', nowMs: cmAt(18, 0) } as const;
    const b = viewsAround(cmF(), behind, cmAt(18, 0));
    expect(focusAfter(behind, b.before, b.after)).toBeNull();
  });
  it('undo of an extra: the Done button of the restored running step', () => {
    const extra = play(cmF(), { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });
    const action = { type: 'cook/undo', nowMs: cmAt(18, 30, 3) } as const;
    const v = viewsAround(extra, action, cmAt(18, 30, 3));
    expect(focusAfter(action, v.before, v.after)).toEqual({
      kind: 'action',
      stepId: 'chicken.roast',
      action: 'done',
    });
  });
  it('undo of a start: the Start button of the restored pending step', () => {
    const started = play(begun(), { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) });
    const action = { type: 'cook/undo', nowMs: cmAt(17, 40, 3) } as const;
    const v = viewsAround(started, action, cmAt(17, 40, 3));
    expect(focusAfter(action, v.before, v.after)).toEqual({
      kind: 'action',
      stepId: 'chicken.prep',
      action: 'start',
    });
  });
  it("undo of I'm behind: the Do now heading", () => {
    const behind = play(cmF(), { do: 'behind', at: cmAt(18, 0) });
    const action = { type: 'cook/undo', nowMs: cmAt(18, 0, 3) } as const;
    const v = viewsAround(behind, action, cmAt(18, 0, 3));
    expect(focusAfter(action, v.before, v.after)).toEqual({ kind: 'heading', id: 'do-now' });
  });
  it('start-now: the heading of the first lane card', () => {
    const action = { type: 'cook/start-now', nowMs: cmAt(17, 30) } as const;
    const v = viewsAround(begun(), action, cmAt(17, 30));
    expect(focusAfter(action, v.before, v.after)).toEqual({
      kind: 'heading',
      id: 'card-chicken.prep',
    });
  });
  it('tick, alerts and resume: no move', () => {
    const state = cmF();
    const view = cookView(state, cmAt(18, 0));
    for (const action of [
      { type: 'cook/tick', nowMs: cmAt(18, 0) },
      { type: 'cook/alerts', wanted: true },
      { type: 'cook/resume', nowMs: cmAt(18, 0) },
    ] as const) {
      expect(focusAfter(action, view, view)).toBeNull();
    }
  });
});

describe('finishedBetween (CM4.2)', () => {
  it('the roast, ready at 19:05, is in (19:04:59, 19:05:00] and not in (19:05:00, 19:06]', () => {
    expect(finishedBetween(cmF(), cmAt(19, 4, 59), cmAt(19, 5))).toEqual(['chicken.roast']);
    expect(finishedBetween(cmF(), cmAt(19, 5), cmAt(19, 6))).toEqual([]);
  });
  it('with 15 extra minutes it is ready at 19:20', () => {
    const extra = play(cmF(), { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });
    expect(finishedBetween(extra, cmAt(19, 4), cmAt(19, 6))).toEqual([]);
    expect(finishedBetween(extra, cmAt(19, 19, 59), cmAt(19, 20))).toEqual(['chicken.roast']);
  });
  it('a hands-on step under way is not announced', () => {
    const prep = play(beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30)), {
      do: 'start',
      id: 'chicken.prep',
      at: cmAt(17, 40),
    });
    expect(finishedBetween(prep, cmAt(17, 49, 59), cmAt(17, 50))).toEqual([]);
  });
});

describe('announcementFor (CM5.6, CM9.4)', () => {
  const GB = 'en-GB';
  it('CM-b a session that begins 12 minutes late: 10 steps moved, serving 19:42, 1 new warning', () => {
    const after = beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 52));
    expect(announcementFor(null, after, undefined, GB)).toBe(
      'Plan rebuilt: 10 steps moved. Serving is now 19:42. 1 new warning.',
    );
  });
  it('CM-c +15 on the roast: 7 steps moved, serving 19:45, 1 new warning', () => {
    const before = cmF();
    const after = play(before, { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });
    expect(announcementFor(before, after, undefined, GB)).toBe(
      'Plan rebuilt: 7 steps moved. Serving is now 19:45. 1 new warning.',
    );
  });
  it("CM-d I'm behind at 17:53: 1 step moved, serving stays at 19:30", () => {
    const before = play(beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30)), ...ON_PLAN.slice(0, 3));
    const after = play(before, { do: 'behind', at: cmAt(17, 53) });
    expect(announcementFor(before, after, undefined, GB)).toBe(
      'Plan rebuilt: 1 step moved. Serving stays at 19:30.',
    );
  });
  it('a rebuild that moves nothing says everything is on time', () => {
    const before = cmF();
    const after = play(before, { do: 'behind', at: cmAt(18, 0) });
    expect(announcementFor(before, after, undefined, GB)).toBe(
      'Plan rebuilt: everything is on time.',
    );
  });
  it('a failed rebuild is said once', () => {
    const before = cmF();
    const after = {
      ...before,
      core: {
        ...before.core,
        log: [
          ...before.core.log,
          {
            atMs: cmAt(18, 0),
            cause: { kind: 'behind' } as const,
            result: { ok: false, error: 'serving_out_of_range' } as const,
          },
        ],
      },
    };
    expect(announcementFor(before, after, undefined, GB)).toBe('The plan could not be rebuilt.');
  });
  it('an undo names what was undone', () => {
    const before = play(cmF(), { do: 'extra', id: 'chicken.roast', minutes: 15, at: cmAt(18, 30) });
    const after = applyCook(before, { type: 'cook/undo', nowMs: cmAt(18, 30, 3) });
    expect(
      announcementFor(before, after, { kind: 'extra', stepId: 'chicken.roast', minutes: 15 }, GB),
    ).toBe('Undone: +15 min on Roast the chicken.');
    expect(announcementFor(before, after, { kind: 'behind' }, GB)).toBe("Undone: I'm behind.");
  });
  it('the last terminal step done: dinner is served', () => {
    const taps = h1Taps(null);
    const start = beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30));
    const before = play(start, ...taps.slice(0, -1));
    const after = play(before, ...taps.slice(-1));
    expect(announcementFor(before, after, undefined, GB)).toBe(
      'Everything is done. Dinner is served.',
    );
  });
  it('an on-plan start announces nothing, and nor does no change', () => {
    const before = beginAt(H1_SCHEDULE, AXIS_MS, cmAt(17, 30));
    const after = play(before, { do: 'start', id: 'chicken.prep', at: cmAt(17, 40) });
    expect(announcementFor(before, after, undefined, GB)).toBeNull();
    expect(announcementFor(after, after, undefined, GB)).toBeNull();
    expect(announcementFor(null, null, undefined, GB)).toBeNull();
  });
});
