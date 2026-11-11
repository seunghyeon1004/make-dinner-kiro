import { hasErrors, longestChainMinutes, schedule, validatePlan } from '../../core/index.js';
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
import { defaultServing, resolveServing } from './clock.js';
import type { Serving } from './clock.js';
import { COPY } from '../copy.js';

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
  | { type: 'samples/loading' }
  | { type: 'samples/loaded'; samples: SampleItem[] }
  | { type: 'samples/failed' }
  | { type: 'dinner/load'; load: DinnerLoad; nowMs: number }
  | { type: 'dinner/replace'; nowMs: number }
  | { type: 'dinner/keep' };

export type Action = PlanUiAction | CookAction;

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

const ROUTE_ORDER: readonly Route[] = ['menu', 'steps', 'plan', 'cook'];

/** Plan-ui reducers; every other action goes to `reduceCook` (R9.9). */
export function reduce(state: AppState, action: Action): AppState {
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
