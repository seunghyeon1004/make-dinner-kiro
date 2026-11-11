import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Plan } from '../../../src/core/index.js';
import {
  createStore,
  initialState,
  reachable,
  reduce,
  sampleLoad,
  selectCheck,
  selectSchedule,
} from '../../../src/web/state/store.js';
import type { Action, AppState, Dinner, DinnerLoad } from '../../../src/web/state/store.js';
import type { SampleItem } from '../../../src/web/state/api.js';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../../support/fixtures.js';

/** SUNDAY_ROAST with `gravy.roux` waiting for a step that does not exist: an unknown_dependency error. */
const BROKEN_ROAST: Plan = {
  ...SUNDAY_ROAST,
  steps: SUNDAY_ROAST.steps.map((step) =>
    step.id === 'gravy.roux' ? { ...step, after: ['chicken.rost'] } : step,
  ),
};

function dinnerOf(plan: Plan): Dinner {
  return {
    plan,
    source: { kind: 'sample', sampleId: 'sunday-roast' },
    kitchen: HOME_KITCHEN,
    serving: null,
  };
}

function stateWith(plan: Plan | null, patch: Partial<AppState> = {}): AppState {
  return { ...initialState(), dinner: plan === null ? null : dinnerOf(plan), ...patch };
}

describe('initialState', () => {
  it('R9.2 starts on the Menu with nothing loaded', () => {
    expect(initialState()).toEqual({
      route: 'menu',
      theme: 'system',
      dinner: null,
      recipeText: '',
      dinnerfileText: '',
      samples: { status: 'idle' },
      parse: { status: 'idle' },
      import: { status: 'idle' },
      pendingLoad: null,
      notice: null,
      cook: null,
    });
  });
});

describe('reachable (R9.2 table)', () => {
  it('menu is always reachable; the others need a dinner', () => {
    expect(reachable(initialState(), false)).toEqual({
      menu: { ok: true },
      steps: { ok: false, reason: 'Pick a dinner first' },
      plan: { ok: false, reason: 'Pick a dinner first' },
      cook: { ok: false, reason: 'Cooking mode is not available yet' },
    });
  });
  it('a plan with an error reaches Steps but not Plan', () => {
    expect(reachable(stateWith(BROKEN_ROAST), false)).toEqual({
      menu: { ok: true },
      steps: { ok: true },
      plan: { ok: false, reason: 'Fix the errors in Steps first' },
      cook: { ok: false, reason: 'Cooking mode is not available yet' },
    });
  });
  it('a valid plan reaches Plan; Cook only when registered', () => {
    expect(reachable(stateWith(SUNDAY_ROAST), false).cook).toEqual({
      ok: false,
      reason: 'Cooking mode is not available yet',
    });
    expect(reachable(stateWith(SUNDAY_ROAST), true)).toEqual({
      menu: { ok: true },
      steps: { ok: true },
      plan: { ok: true },
      cook: { ok: true },
    });
  });
  it('Cook is unreachable without a schedulable plan even when registered', () => {
    expect(reachable(initialState(), true).cook).toEqual({
      ok: false,
      reason: 'Make the plan first',
    });
    expect(reachable(stateWith(BROKEN_ROAST), true).cook).toEqual({
      ok: false,
      reason: 'Make the plan first',
    });
  });
});

describe('selectors', () => {
  it('selectCheck is null without a dinner and reports the unknown dependency', () => {
    expect(selectCheck(initialState())).toBeNull();
    const check = selectCheck(stateWith(BROKEN_ROAST));
    expect(check?.issues.map((i) => i.code)).toEqual(['unknown_dependency']);
  });
  it('selectCheck returns the same object for the same plan', () => {
    const state = stateWith(SUNDAY_ROAST);
    expect(selectCheck(state)).toBe(selectCheck({ ...state, route: 'steps' }));
  });
  it('selectSchedule is null without a dinner; ok with a span of 110 for the roast', () => {
    expect(selectSchedule(initialState())).toBeNull();
    const result = selectSchedule(stateWith(SUNDAY_ROAST));
    expect(result?.ok).toBe(true);
    expect(result?.ok === true ? result.value.spanMin : null).toBe(110);
  });
});

describe('reduce: navigate (R9.3)', () => {
  const go = (state: AppState, route: AppState['route'], cookRegistered = false): AppState =>
    reduce(state, { type: 'navigate', route, cookRegistered });

  it('with no dinner every route but menu lands on menu', () => {
    for (const route of ['steps', 'plan', 'cook'] as const) {
      expect(go(initialState(), route).route).toBe('menu');
    }
  });
  it('with a valid dinner steps and plan are reached; cook falls back to plan when unregistered', () => {
    const state = stateWith(SUNDAY_ROAST);
    expect(go(state, 'steps').route).toBe('steps');
    expect(go(state, 'plan').route).toBe('plan');
    expect(go(state, 'cook', false).route).toBe('plan');
    expect(go(state, 'cook', true).route).toBe('cook');
  });
  it('with an error in the plan, plan and cook fall back to steps', () => {
    const state = stateWith(BROKEN_ROAST);
    expect(go(state, 'plan').route).toBe('steps');
    expect(go(state, 'cook', true).route).toBe('steps');
  });
  it('clears the notice', () => {
    const state = stateWith(SUNDAY_ROAST, { notice: 'Removed a step.' });
    expect(go(state, 'steps').notice).toBeNull();
  });
});

describe('reduce: small actions', () => {
  it('theme/set stores the choice', () => {
    expect(reduce(initialState(), { type: 'theme/set', theme: 'dark' }).theme).toBe('dark');
  });
  it('notice/set and notice/clear', () => {
    const set = reduce(initialState(), { type: 'notice/set', text: 'Opened a shared dinner.' });
    expect(set.notice).toBe('Opened a shared dinner.');
    expect(reduce(set, { type: 'notice/clear' }).notice).toBeNull();
  });
  it('R9.7 start-over keeps theme and samples and clears the rest', () => {
    const samples = { status: 'failed' } as const;
    const state = stateWith(SUNDAY_ROAST, {
      route: 'plan',
      theme: 'dark',
      samples,
      recipeText: 'Some recipes',
      dinnerfileText: 'dinner:',
      notice: 'x',
    });
    const next = reduce(state, { type: 'start-over' });
    expect(next).toEqual({ ...initialState(), theme: 'dark', samples });
  });
  it('a no-op returns the same object', () => {
    const state = stateWith(SUNDAY_ROAST, { theme: 'dark', route: 'plan' });
    expect(reduce(state, { type: 'theme/set', theme: 'dark' })).toBe(state);
    expect(reduce(state, { type: 'notice/clear' })).toBe(state);
    expect(reduce(state, { type: 'navigate', route: 'plan', cookRegistered: false })).toBe(state);
  });
  it('R9.9 an action outside PlanUiAction reaches reduceCook and changes nothing', () => {
    const state = stateWith(SUNDAY_ROAST);
    const foreign = { type: 'cook/begin' } as unknown as Action;
    expect(reduce(state, foreign)).toBe(state);
  });
});

describe('createStore', () => {
  it('notifies once per change and never for a no-op', () => {
    const store = createStore(initialState());
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.dispatch({ type: 'theme/set', theme: 'dark' });
    expect(calls).toBe(1);
    expect(store.getState().theme).toBe('dark');
    store.dispatch({ type: 'theme/set', theme: 'dark' });
    expect(calls).toBe(1);
    unsubscribe();
    store.dispatch({ type: 'theme/set', theme: 'light' });
    expect(calls).toBe(1);
    expect(store.getState().theme).toBe('light');
  });
});

describe('samples and dinner loading (T2.2)', () => {
  const originalZone = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'Europe/London';
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
  });
  afterAll(() => {
    if (originalZone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalZone;
  });

  const at = (iso: string): number => Date.parse(iso);

  /** SUNDAY_ROAST x HOME_KITCHEN has span 110 (scheduler table H1). */
  const sampleLoad: DinnerLoad = {
    plan: SUNDAY_ROAST,
    source: { kind: 'sample', sampleId: 'sunday-roast' },
    kitchen: HOME_KITCHEN,
    serve: null,
    suggested: '13:30',
    route: 'plan',
    notice: null,
  };

  it('R1.1 samples/loading, loaded and failed set the samples state', () => {
    const loading = reduce(initialState(), { type: 'samples/loading' });
    expect(loading.samples).toEqual({ status: 'loading' });
    const item = { id: 'sunday-roast' } as unknown as SampleItem;
    const loaded = reduce(loading, { type: 'samples/loaded', samples: [item] });
    expect(loaded.samples).toEqual({ status: 'loaded', samples: [item] });
    expect(reduce(loaded, { type: 'samples/failed' }).samples).toEqual({ status: 'failed' });
  });

  it('R1.3 R1.4 a sample load at Wed 10:00 serves at its suggested 13:30 and opens Plan', () => {
    const next = reduce(initialState(), {
      type: 'dinner/load',
      load: sampleLoad,
      nowMs: at('2026-11-11T10:00:00Z'),
    });
    expect(next.route).toBe('plan');
    expect(next.dinner).toEqual({
      plan: SUNDAY_ROAST,
      source: { kind: 'sample', sampleId: 'sunday-roast' },
      kitchen: HOME_KITCHEN,
      serving: { time: '13:30', atMs: at('2026-11-11T13:30:00Z') },
    });
    expect(next.pendingLoad).toBeNull();
  });

  it('R1.4 at Wed 12:00 13:30 is too soon for span 110 + 15, so it serves at 14:30', () => {
    const next = reduce(initialState(), {
      type: 'dinner/load',
      load: sampleLoad,
      nowMs: at('2026-11-11T12:00:00Z'),
    });
    expect(next.dinner?.serving).toEqual({ time: '14:30', atMs: at('2026-11-11T14:30:00Z') });
  });

  it('R4.11 a load that opens Steps chooses no serving time', () => {
    const next = reduce(initialState(), {
      type: 'dinner/load',
      load: { ...sampleLoad, suggested: null, route: 'steps', notice: 'Opened.' },
      nowMs: at('2026-11-11T10:00:00Z'),
    });
    expect(next.route).toBe('steps');
    expect(next.dinner?.serving).toBeNull();
    expect(next.notice).toBe('Opened.');
  });

  it('R8.5 a fixed serve time is resolved by resolveServing', () => {
    const next = reduce(initialState(), {
      type: 'dinner/load',
      load: { ...sampleLoad, serve: '19:30', suggested: null },
      nowMs: at('2026-11-11T18:00:00Z'),
    });
    expect(next.dinner?.serving).toEqual({ time: '19:30', atMs: at('2026-11-11T19:30:00Z') });
    const tomorrow = reduce(initialState(), {
      type: 'dinner/load',
      load: { ...sampleLoad, serve: '13:59', suggested: null },
      nowMs: at('2026-11-11T18:00:00Z'),
    });
    expect(tomorrow.dinner?.serving).toEqual({ time: '13:59', atMs: at('2026-11-12T13:59:00Z') });
  });

  it('R2.8 a load clears the pasted text of its own source only', () => {
    const base = { ...initialState(), recipeText: 'recipes', dinnerfileText: 'dinnerfile' };
    const fromRecipes = reduce(base, {
      type: 'dinner/load',
      load: { ...sampleLoad, source: { kind: 'recipes' }, route: 'steps' },
      nowMs: 0,
    });
    expect([fromRecipes.recipeText, fromRecipes.dinnerfileText]).toEqual(['', 'dinnerfile']);
    const fromFile = reduce(base, {
      type: 'dinner/load',
      load: { ...sampleLoad, source: { kind: 'dinnerfile' }, route: 'steps' },
      nowMs: 0,
    });
    expect([fromFile.recipeText, fromFile.dinnerfileText]).toEqual(['recipes', '']);
  });

  const withDinner = (): AppState =>
    reduce(initialState(), {
      type: 'dinner/load',
      load: sampleLoad,
      nowMs: at('2026-11-11T10:00:00Z'),
    });
  const otherLoad: DinnerLoad = {
    ...sampleLoad,
    plan: { ...SUNDAY_ROAST, title: 'Another dinner' },
    source: { kind: 'sample', sampleId: 'another' },
    suggested: '19:30',
  };

  it('R1.5 a load while a dinner exists only sets pendingLoad', () => {
    const state = withDinner();
    const next = reduce(state, { type: 'dinner/load', load: otherLoad, nowMs: 0 });
    expect(next).toEqual({ ...state, pendingLoad: otherLoad });
  });

  it('R1.5 replace applies the pending load, clears pendingLoad and the cook slice', () => {
    const cooking = {
      ...reduce(withDinner(), { type: 'dinner/load', load: otherLoad, nowMs: 0 }),
      cook: 'session' as unknown as AppState['cook'],
    };
    const next = reduce(cooking, { type: 'dinner/replace', nowMs: at('2026-11-11T10:00:00Z') });
    expect(next.dinner?.plan.title).toBe('Another dinner');
    expect(next.dinner?.serving).toEqual({ time: '19:30', atMs: at('2026-11-11T19:30:00Z') });
    expect(next.pendingLoad).toBeNull();
    expect(next.cook).toBeNull();
    expect(next.route).toBe('plan');
  });

  it('R1.5 keep drops the pending load and changes nothing else', () => {
    const pending = reduce(withDinner(), { type: 'dinner/load', load: otherLoad, nowMs: 0 });
    const next = reduce(pending, { type: 'dinner/keep' });
    expect(next).toEqual(withDinner());
  });

  it('replace and keep without a pending load are no-ops', () => {
    const state = withDinner();
    expect(reduce(state, { type: 'dinner/replace', nowMs: 0 })).toBe(state);
    expect(reduce(state, { type: 'dinner/keep' })).toBe(state);
  });
});

describe('sampleLoad (answer to the T2 open question)', () => {
  it('R1.3 the dinner is titled with the sample title, not the title inside the recorded plan', () => {
    const item = {
      id: 'sunday-roast',
      title: 'Sunday roast',
      blurb: 'A chicken, gravy and greens.',
      dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
      kitchen: HOME_KITCHEN,
      servingTime: '13:30',
      text: '',
      plan: { ...SUNDAY_ROAST, title: 'Roast chicken with gravy and greens' },
      issues: [],
    } as unknown as SampleItem;
    const load = sampleLoad(item);
    expect(load.plan.title).toBe('Sunday roast');
    expect(load.plan.steps).toEqual(SUNDAY_ROAST.steps);
    expect(load.plan.dishes).toEqual(SUNDAY_ROAST.dishes);
    expect(item.plan.title).toBe('Roast chicken with gravy and greens');
    expect(load).toMatchObject({
      source: { kind: 'sample', sampleId: 'sunday-roast' },
      kitchen: HOME_KITCHEN,
      serve: null,
      suggested: '13:30',
      route: 'plan',
      notice: null,
    });
  });
});

describe('kitchen, serving and plan/enter (T3.3)', () => {
  const originalZone = process.env['TZ'];
  beforeAll(() => {
    process.env['TZ'] = 'Europe/London';
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
  });
  afterAll(() => {
    if (originalZone === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalZone;
  });
  const at = (iso: string): number => Date.parse(iso);
  const served = (): AppState => ({
    ...stateWith(SUNDAY_ROAST, { route: 'plan' }),
    dinner: {
      ...dinnerOf(SUNDAY_ROAST),
      serving: { time: '19:30', atMs: at('2026-11-11T19:30:00Z') },
    },
  });

  it('R5.1 kitchen/set replaces the kitchen', () => {
    const next = reduce(served(), {
      type: 'kitchen/set',
      kitchen: { burners: 1, ovens: 1, cooks: 1 },
    });
    expect(next.dinner?.kitchen).toEqual({ burners: 1, ovens: 1, cooks: 1 });
    expect(next.dinner?.plan).toBe(SUNDAY_ROAST);
  });
  it('R5.1 kitchen/set ignores a value that fails parseKitchen and returns the same state', () => {
    const state = served();
    for (const kitchen of [
      { burners: 9, ovens: 1, cooks: 1 },
      { burners: 4, ovens: 1, cooks: 0 },
      { burners: 4, ovens: -1, cooks: 1 },
      { burners: 4.5, ovens: 1, cooks: 1 },
    ]) {
      expect(reduce(state, { type: 'kitchen/set', kitchen })).toBe(state);
    }
  });
  it('R5.1 kitchen/set with no dinner is a no-op', () => {
    const state = initialState();
    expect(
      reduce(state, { type: 'kitchen/set', kitchen: { burners: 1, ovens: 1, cooks: 1 } }),
    ).toBe(state);
  });
  it('R5.3 serving/set-time resolves the time: later today stays today, 00:30 is tomorrow', () => {
    const now = at('2026-11-11T18:00:00Z');
    expect(
      reduce(served(), { type: 'serving/set-time', time: '20:00', nowMs: now }).dinner?.serving,
    ).toEqual({ time: '20:00', atMs: at('2026-11-11T20:00:00Z') });
    expect(
      reduce(served(), { type: 'serving/set-time', time: '00:30', nowMs: now }).dinner?.serving,
    ).toEqual({ time: '00:30', atMs: at('2026-11-12T00:30:00Z') });
  });
  it('R5.3 serving/set-instant stores the instant and its local clock time', () => {
    const next = reduce(served(), {
      type: 'serving/set-instant',
      atMs: at('2026-11-11T19:35:00Z'),
    });
    expect(next.dinner?.serving).toEqual({ time: '19:35', atMs: at('2026-11-11T19:35:00Z') });
  });
  it('serving actions with no dinner are no-ops', () => {
    const state = initialState();
    expect(reduce(state, { type: 'serving/set-time', time: '19:30', nowMs: 0 })).toBe(state);
    expect(reduce(state, { type: 'serving/set-instant', atMs: 0 })).toBe(state);
  });
  it('R4.11 plan/enter fills a null serving time (Wed 18:00:20, span 110 -> 20:30) and opens Plan', () => {
    const state = stateWith(SUNDAY_ROAST, { route: 'steps' });
    const next = reduce(state, { type: 'plan/enter', nowMs: at('2026-11-11T18:00:20Z') });
    expect(next.route).toBe('plan');
    expect(next.dinner?.serving).toEqual({ time: '20:30', atMs: at('2026-11-11T20:30:00Z') });
  });
  it('R4.11 plan/enter keeps a serving time that is set', () => {
    const state = { ...served(), route: 'steps' as const };
    const next = reduce(state, { type: 'plan/enter', nowMs: at('2026-11-11T18:00:20Z') });
    expect(next.route).toBe('plan');
    expect(next.dinner?.serving).toEqual({ time: '19:30', atMs: at('2026-11-11T19:30:00Z') });
  });
  it('R4.11 plan/enter on a plan with an error stays on Steps', () => {
    const state = stateWith(BROKEN_ROAST, { route: 'steps' });
    expect(reduce(state, { type: 'plan/enter', nowMs: 0 }).route).toBe('steps');
  });

  it('R5.2 selectSchedule gives the same result for the same plan and kitchen', () => {
    const state = served();
    expect(selectSchedule(state)).toBe(selectSchedule({ ...state, route: 'steps' }));
  });
  it('R5.2 a kitchen change gives a new result; the new kitchen shows in it', () => {
    const state = served();
    const before = selectSchedule(state);
    const next = reduce(state, {
      type: 'kitchen/set',
      kitchen: { burners: 1, ovens: 1, cooks: 1 },
    });
    const after = selectSchedule(next);
    expect(after).not.toBe(before);
    expect(after?.ok === true ? after.value.kitchen.burners : null).toBe(1);
  });
  it('R5.2 serving changes do not recompute the schedule', () => {
    const state = served();
    const before = selectSchedule(state);
    const a = reduce(state, {
      type: 'serving/set-time',
      time: '21:00',
      nowMs: at('2026-11-11T18:00:00Z'),
    });
    const b = reduce(a, { type: 'serving/set-instant', atMs: at('2026-11-11T21:05:00Z') });
    expect(selectSchedule(a)).toBe(before);
    expect(selectSchedule(b)).toBe(before);
  });
});
