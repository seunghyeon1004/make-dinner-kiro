import {
  hasErrors,
  longestChainMinutes,
  parseKitchen,
  schedule,
  validatePlan,
} from '../../core/index.js';
import type {
  Kitchen,
  Plan,
  PlanCheck,
  Result,
  Schedule,
  ScheduleError,
  ServeTime,
} from '../../core/index.js';
import type { ParseFailure, SampleItem } from './api.js';
import type { CookAction, CookState } from './cook-slot.js';
import { reduceCook } from './cook-slot.js';
import { defaultServing, resolveServing, toServeTime } from './clock.js';
import type { Serving } from './clock.js';
import { COPY } from '../copy.js';
import { addDish, addStep, removeDish, removeStep, renameDish, updateStep } from './plan-edit.js';
import type { StepPatch } from './plan-edit.js';

export type { Serving } from './clock.js';

export type Route = 'menu' | 'steps' | 'plan' | 'cook';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type PlanSource =
  | { kind: 'sample'; sampleId: string }
  | { kind: 'recipes' }
  | { kind: 'dinnerfile' }
  | { kind: 'share' };

export interface Dinner {
  plan: Plan;
  source: PlanSource;
  kitchen: Kitchen;
  serving: Serving | null;
}

export interface DinnerLoad {
  plan: Plan;
  source: PlanSource;
  kitchen: Kitchen;
  /** A fixed time (share, Dinnerfile), resolved by `resolveServing`. */
  serve: ServeTime | null;
  /** A sample's `servingTime`, used by `defaultServing`. */
  suggested: ServeTime | null;
  route: 'steps' | 'plan';
  notice: string | null;
}

export type SamplesState =
  { status: 'idle' | 'loading' | 'failed' } | { status: 'loaded'; samples: SampleItem[] };
export type ParseState =
  | { status: 'idle' }
  | { status: 'busy'; requestId: number; startedAtMs: number }
  | { status: 'failed'; failure: ParseFailure };
export type ImportProblem =
  { kind: 'line'; line: number | null; message: string } | { kind: 'issue'; message: string };
export type ImportState =
  { status: 'idle' } | { status: 'failed'; heading: string; problems: ImportProblem[] };

export interface AppState {
  route: Route;
  theme: ThemeChoice;
  /** The plan always passes `PlanSchema` (R4.4). */
  dinner: Dinner | null;
  recipeText: string;
  dinnerfileText: string;
  samples: SamplesState;
  parse: ParseState;
  import: ImportState;
  pendingLoad: DinnerLoad | null;
  notice: string | null;
  /** Owned by cooking-mode; always null in plan-ui. */
  cook: CookState | null;
}

export const DEFAULT_KITCHEN: Kitchen = { burners: 4, ovens: 1, cooks: 1 };

export function initialState(): AppState {
  return {
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
  };
}

export type PlanUiAction =
  | { type: 'navigate'; route: Route; cookRegistered: boolean }
  | { type: 'theme/set'; theme: ThemeChoice }
  | { type: 'notice/set'; text: string }
  | { type: 'notice/clear' }
  | { type: 'start-over' }
  | { type: 'recipe-text/set'; text: string }
  | { type: 'dinnerfile-text/set'; text: string }
  | { type: 'parse/start'; requestId: number; nowMs: number }
  | { type: 'parse/done'; requestId: number; plan: Plan; nowMs: number }
  | { type: 'parse/failed'; requestId: number; failure: ParseFailure }
  | { type: 'parse/cancel' }
  | { type: 'import/failed'; heading: string; problems: ImportProblem[] }
  | { type: 'samples/loading' }
  | { type: 'samples/loaded'; samples: SampleItem[] }
  | { type: 'samples/failed' }
  | { type: 'dinner/load'; load: DinnerLoad; nowMs: number }
  | { type: 'dinner/replace'; nowMs: number }
  | { type: 'dinner/keep' }
  | { type: 'kitchen/set'; kitchen: Kitchen }
  | { type: 'serving/set-time'; time: ServeTime; nowMs: number }
  | { type: 'serving/set-instant'; atMs: number }
  | { type: 'plan/enter'; nowMs: number }
  | { type: 'dish/add'; name: string }
  | { type: 'dish/rename'; index: number; name: string }
  | { type: 'dish/remove'; index: number }
  | { type: 'step/add'; dishIndex: number }
  | { type: 'step/update'; index: number; patch: StepPatch }
  | { type: 'step/remove'; index: number };

export type Action = PlanUiAction | CookAction;

/**
 * The load of a chosen sample (R1.3). The dinner's title is the sample's own title from
 * `samples/index.json`, not the title inside the recorded plan (decided with the user).
 */
export function sampleLoad(sample: SampleItem): DinnerLoad {
  return {
    plan: { ...sample.plan, title: sample.title },
    source: { kind: 'sample', sampleId: sample.id },
    kitchen: sample.kitchen,
    serve: null,
    suggested: sample.servingTime,
    route: 'plan',
    notice: null,
  };
}

/** Minutes the plan takes: the schedule's span, else its longest chain, else 0. */
function spanOf(plan: Plan, kitchen: Kitchen): number {
  const scheduled = schedule(plan, kitchen);
  if (scheduled.ok) return scheduled.value.spanMin;
  const chain = longestChainMinutes(plan);
  return chain.ok ? chain.value : 0;
}

/** Puts a load in place of the dinner: serving time, route, notice and pasted texts (R1.3 to R2.8). */
function applyLoad(state: AppState, load: DinnerLoad, nowMs: number): AppState {
  let serving: Serving | null = null;
  if (load.serve !== null) {
    serving = { time: load.serve, atMs: resolveServing(load.serve, nowMs) };
  } else if (load.route === 'plan') {
    serving = defaultServing(nowMs, spanOf(load.plan, load.kitchen), load.suggested);
  }
  return {
    ...state,
    route: load.route,
    dinner: { plan: load.plan, source: load.source, kitchen: load.kitchen, serving },
    recipeText: load.source.kind === 'recipes' ? '' : state.recipeText,
    dinnerfileText: load.source.kind === 'dinnerfile' ? '' : state.dinnerfileText,
    import: { status: 'idle' },
    pendingLoad: null,
    notice: load.notice,
  };
}

const GUARDED: ReadonlySet<string> = new Set([
  'dish/add',
  'dish/rename',
  'dish/remove',
  'step/add',
  'step/update',
  'step/remove',
  'kitchen/set',
  'serving/set-time',
  'serving/set-instant',
]);

/** Applies a plan edit; a refused edit or one that changes nothing leaves the state as it is. */
function applyEdit(
  state: AppState,
  edit: (plan: Plan) => Result<{ plan: Plan; notice: string | null }, unknown>,
): AppState {
  if (state.dinner === null) return state;
  const result = edit(state.dinner.plan);
  if (!result.ok || result.value.plan === state.dinner.plan) return state;
  return {
    ...state,
    dinner: { ...state.dinner, plan: result.value.plan },
    notice: result.value.notice,
  };
}

const ROUTE_ORDER: readonly Route[] = ['menu', 'steps', 'plan', 'cook'];

/** Plan-ui reducers; every other action goes to `reduceCook` (R9.9). */
export function reduce(state: AppState, action: Action): AppState {
  // Once cooking has started the plan, kitchen and serving time are read-only (R4.12).
  if (state.cook !== null && GUARDED.has(action.type)) return state;
  switch (action.type) {
    case 'navigate': {
      const reach = reachable(state, action.cookRegistered);
      let index = ROUTE_ORDER.indexOf(action.route);
      while (index > 0 && !reach[ROUTE_ORDER[index] ?? 'menu'].ok) index -= 1;
      const route = ROUTE_ORDER[index] ?? 'menu';
      if (route === state.route && state.notice === null) return state;
      return { ...state, route, notice: null };
    }
    case 'theme/set':
      return action.theme === state.theme ? state : { ...state, theme: action.theme };
    case 'notice/set':
      return action.text === state.notice ? state : { ...state, notice: action.text };
    case 'notice/clear':
      return state.notice === null ? state : { ...state, notice: null };
    case 'start-over':
      return { ...initialState(), theme: state.theme, samples: state.samples };
    case 'recipe-text/set':
      return { ...state, recipeText: action.text, parse: { status: 'idle' } };
    case 'dinnerfile-text/set':
      return { ...state, dinnerfileText: action.text, import: { status: 'idle' } };
    case 'parse/start':
      return {
        ...state,
        parse: { status: 'busy', requestId: action.requestId, startedAtMs: action.nowMs },
      };
    case 'parse/done': {
      if (state.parse.status !== 'busy' || state.parse.requestId !== action.requestId) return state;
      const load: DinnerLoad = {
        plan: action.plan,
        source: { kind: 'recipes' },
        kitchen: DEFAULT_KITCHEN,
        serve: null,
        suggested: null,
        route: 'steps',
        notice: null,
      };
      return reduce(
        { ...state, parse: { status: 'idle' } },
        {
          type: 'dinner/load',
          load,
          nowMs: action.nowMs,
        },
      );
    }
    case 'parse/failed':
      if (state.parse.status !== 'busy' || state.parse.requestId !== action.requestId) return state;
      return { ...state, parse: { status: 'failed', failure: action.failure } };
    case 'parse/cancel':
      return state.parse.status === 'idle' ? state : { ...state, parse: { status: 'idle' } };
    case 'import/failed':
      return {
        ...state,
        import: { status: 'failed', heading: action.heading, problems: action.problems },
      };
    case 'samples/loading':
      return { ...state, samples: { status: 'loading' } };
    case 'samples/loaded':
      return { ...state, samples: { status: 'loaded', samples: action.samples } };
    case 'samples/failed':
      return { ...state, samples: { status: 'failed' } };
    case 'dinner/load':
      return state.dinner === null
        ? applyLoad(state, action.load, action.nowMs)
        : { ...state, pendingLoad: action.load };
    case 'dinner/replace':
      return state.pendingLoad === null
        ? state
        : { ...applyLoad(state, state.pendingLoad, action.nowMs), cook: null };
    case 'dinner/keep':
      return state.pendingLoad === null ? state : { ...state, pendingLoad: null };
    case 'kitchen/set': {
      if (state.dinner === null || !parseKitchen(action.kitchen).ok) return state;
      return { ...state, dinner: { ...state.dinner, kitchen: action.kitchen } };
    }
    case 'serving/set-time': {
      if (state.dinner === null) return state;
      const serving = { time: action.time, atMs: resolveServing(action.time, action.nowMs) };
      return { ...state, dinner: { ...state.dinner, serving } };
    }
    case 'serving/set-instant': {
      if (state.dinner === null) return state;
      const serving = { time: toServeTime(action.atMs), atMs: action.atMs };
      return { ...state, dinner: { ...state.dinner, serving } };
    }
    case 'plan/enter': {
      if (state.dinner === null) return state;
      const { plan, kitchen } = state.dinner;
      const serving =
        state.dinner.serving ?? defaultServing(action.nowMs, spanOf(plan, kitchen), null);
      return reduce(
        { ...state, dinner: { ...state.dinner, serving } },
        { type: 'navigate', route: 'plan', cookRegistered: false },
      );
    }
    case 'dish/add':
      return applyEdit(state, (plan) => addDish(plan, action.name));
    case 'dish/rename':
      return applyEdit(state, (plan) => renameDish(plan, action.index, action.name));
    case 'dish/remove':
      return applyEdit(state, (plan) => removeDish(plan, action.index));
    case 'step/add':
      return applyEdit(state, (plan) => addStep(plan, action.dishIndex));
    case 'step/update':
      return applyEdit(state, (plan) => updateStep(plan, action.index, action.patch));
    case 'step/remove':
      return applyEdit(state, (plan) => removeStep(plan, action.index));
    default:
      return reduceCook(state, action);
  }
}

export interface Store {
  getState(): AppState;
  dispatch(action: Action): void;
  subscribe(listener: () => void): () => void;
}

/** Calls `reduce`; notifies subscribers only when the state object changed. */
export function createStore(initial: AppState): Store {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(action) {
      const next = reduce(state, action);
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// One-entry memos keyed by object identity: dinner.plan and dinner.kitchen are replaced,
// never mutated.
let checkMemo: { plan: Plan; value: PlanCheck } | null = null;
let scheduleMemo: {
  plan: Plan;
  kitchen: Kitchen;
  value: Result<Schedule, ScheduleError>;
} | null = null;

/** `validatePlan` of the current plan, or null with no dinner. */
export function selectCheck(state: AppState): PlanCheck | null {
  if (state.dinner === null) return null;
  const { plan } = state.dinner;
  if (checkMemo?.plan !== plan) checkMemo = { plan, value: validatePlan(plan) };
  return checkMemo.value;
}

/** `schedule(plan, kitchen)` of the current dinner, or null with no dinner. */
export function selectSchedule(state: AppState): Result<Schedule, ScheduleError> | null {
  if (state.dinner === null) return null;
  const { plan, kitchen } = state.dinner;
  if (scheduleMemo?.plan !== plan || scheduleMemo.kitchen !== kitchen) {
    scheduleMemo = { plan, kitchen, value: schedule(plan, kitchen) };
  }
  return scheduleMemo.value;
}

export type Reachability = Record<Route, { ok: true } | { ok: false; reason: string }>;

export function reachable(state: AppState, cookRegistered: boolean): Reachability {
  const ok = { ok: true } as const;
  const no = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
  const check = selectCheck(state);
  const planReady = check !== null && !hasErrors(check.issues);
  const scheduled = selectSchedule(state);
  let cook: Reachability['cook'] = ok;
  if (!cookRegistered) cook = no(COPY.reasonCookMissing);
  else if (scheduled === null || !scheduled.ok) cook = no(COPY.reasonMakePlan);
  return {
    menu: ok,
    steps: state.dinner === null ? no(COPY.reasonPickDinner) : ok,
    plan:
      state.dinner === null ? no(COPY.reasonPickDinner) : planReady ? ok : no(COPY.reasonFixErrors),
    cook,
  };
}
