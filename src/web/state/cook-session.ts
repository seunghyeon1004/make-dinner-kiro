import { compareIds, err, ok, rebuild, RebuiltScheduleSchema } from '../../core/index.js';
import type {
  Progress,
  ProgressEntry,
  Rebuilt,
  RebuiltSchedule,
  Result,
  Schedule,
  Step,
} from '../../core/index.js';
import { clockAt, MINUTE_MS, minuteAt } from './clock.js';
import type {
  CookAction,
  CookCore,
  CookState,
  LogCause,
  LogEntry,
  StepFact,
  UndoLabel,
} from './cook-slot.js';

/** A start or end more than this many minutes from the schedule's rebuilds; within it the fact is only recorded. */
export const SLIP_MIN = 2;
/** A step this many minutes past its planned time is shown late (never rebuilt by itself). */
export const OVERDUE_MIN = 5;
/** "Undo" is offered for this long after an action. */
export const UNDO_MS = 10_000;
/** A session whose last action is older asks to resume or discard. */
export const STALE_MS = 8 * 60 * MINUTE_MS;
/** Items in "Up next". */
export const UP_NEXT_COUNT = 3;
/** Build log entries kept, oldest dropped. */
export const LOG_MAX = 20;
/** `cook/tick` interval, for display. */
export const TICK_MS = 15_000;
export const EXTRA_CHOICES = [5, 10, 15] as const;
/** Equals core's `REBUILD_LIMITS.extraMax`, which `src/core/index.ts` does not export (checked in a test). */
export const EXTRA_MAX = 1440;

/**
 * The instant every action records its facts at: the clock, but never before the session began
 * or before any recorded fact, so a clock set backwards cannot make a fact end before it started.
 */
export function effectiveNow(core: CookCore, nowMs: number): number {
  let t = Math.max(nowMs, core.beganAtMs);
  for (const fact of Object.values(core.facts)) {
    t = Math.max(t, fact.startedAtMs);
    if (fact.state === 'done') t = Math.max(t, fact.endedAtMs);
  }
  return t;
}

/** The facts as core `Progress` on the session's axis. */
export function progressOf(core: CookCore): Progress {
  const progress: Progress = {};
  for (const [id, fact] of Object.entries(core.facts)) {
    const startMin = minuteAt(core.axisMs, fact.startedAtMs);
    const entry: ProgressEntry =
      fact.state === 'done'
        ? { state: 'done', startMin, endMin: minuteAt(core.axisMs, fact.endedAtMs) }
        : { state: 'running', startMin, extraMin: fact.extraMin };
    progress[id] = entry;
  }
  return progress;
}

/** When a running step is ready: its recorded start plus its minutes plus the extra minutes. */
export function endsAtMs(step: Step, fact: Extract<StepFact, { state: 'running' }>): number {
  return clockAt(fact.startedAtMs, step.minutes + fact.extraMin);
}

/** A whole number of milliseconds, 0 or more: what `CookStateSchema` accepts as an instant. */
function isInstant(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export type BeginError = { kind: 'too_late' } | { kind: 'invalid_schedule' };

/** The log entry of one rebuild, against the schedule it replaced. */
function entryFor(atMs: number, cause: LogCause, old: RebuiltSchedule, built: Rebuilt): LogEntry {
  const oldWaits = new Map(old.warnings.map((w) => [w.stepId, w.waitMin]));
  return {
    atMs,
    cause,
    result: {
      ok: true,
      moved: built.diff.moved.toSorted(
        (a, b) => a.toStartMin - b.toStartMin || compareIds(a.stepId, b.stepId),
      ),
      unchanged: built.diff.unchanged,
      servingFromMin: old.servingMin,
      servingToMin: built.schedule.servingMin,
      newWarnings: built.schedule.warnings.filter((w) => {
        const before = oldWaits.get(w.stepId);
        return before === undefined || before < w.waitMin;
      }),
    },
  };
}

/**
 * Rebuilds `core` against its facts at axis minute `n` and appends the log entry. A failed
 * rebuild keeps the schedule and the facts and logs the error kind (CM5.7).
 */
function rebuildCore(core: CookCore, cause: LogCause, t: number): CookCore {
  const n = minuteAt(core.axisMs, t);
  const result = rebuild(core.schedule, progressOf(core), n);
  const entry: LogEntry = result.ok
    ? entryFor(t, cause, core.schedule, result.value)
    : { atMs: t, cause, result: { ok: false, error: result.error.kind } };
  return {
    ...core,
    schedule: result.ok ? result.value.schedule : core.schedule,
    log: [...core.log, entry].slice(-LOG_MAX),
  };
}

function earliestStartMin(schedule: RebuiltSchedule): number {
  return Math.min(...schedule.steps.map((s) => s.startMin));
}

/** The session a cook would begin now, or why not. `too_late`: the rebuild is out of range. */
export function beginSession(
  schedule: Schedule | RebuiltSchedule,
  axisMs: number,
  nowMs: number,
): Result<CookState, BeginError> {
  const parsed = RebuiltScheduleSchema.safeParse(schedule);
  if (!parsed.success || !isInstant(axisMs) || !isInstant(nowMs)) {
    return err({ kind: 'invalid_schedule' });
  }
  const planned = parsed.data;
  let core: CookCore = {
    axisMs,
    plannedServingMs: clockAt(axisMs, planned.servingMin),
    beganAtMs: nowMs,
    schedule: planned,
    facts: {},
    log: [],
  };
  const n = minuteAt(axisMs, nowMs);
  const startMin = earliestStartMin(planned);
  if (n > startMin) {
    const result = rebuild(planned, {}, n);
    if (!result.ok) {
      const kind = result.error.kind;
      return err({
        kind:
          kind === 'invalid_now' || kind === 'serving_out_of_range'
            ? 'too_late'
            : 'invalid_schedule',
      });
    }
    core = {
      ...core,
      schedule: result.value.schedule,
      log: [entryFor(nowMs, { kind: 'begin-late', byMin: n - startMin }, planned, result.value)],
    };
  }
  return ok({ version: 1, core, lastActiveMs: nowMs, alertsWanted: false, undo: null });
}

export function canBegin(
  schedule: Schedule | RebuiltSchedule,
  axisMs: number,
  nowMs: number,
): Result<null, BeginError> {
  const result = beginSession(schedule, axisMs, nowMs);
  return result.ok ? ok(null) : result;
}

type Undoable = { label: UndoLabel; core: CookCore; t: number };

/** The state after an undoable action: the new core, the undo slot holding the old one. */
function undoable(state: CookState, change: Undoable): CookState {
  return {
    ...state,
    core: change.core,
    lastActiveMs: change.t,
    undo: { label: change.label, untilMs: change.t + UNDO_MS, before: state.core },
  };
}

/** "Start now": the minutes until the first start, rounded up so the start is reached. */
export function startNowShiftMin(core: CookCore, nowMs: number): number {
  const startMs = clockAt(core.axisMs, earliestStartMin(core.schedule));
  return Math.max(1, Math.ceil((startMs - nowMs) / MINUTE_MS));
}

export type Phase = 'countdown' | 'cooking' | 'finished' | 'stale';

/** Ids of steps no other step lists in `after`. */
export function terminalIdsOf(schedule: RebuiltSchedule): string[] {
  const used = new Set(schedule.plan.steps.flatMap((step) => step.after));
  return schedule.plan.steps.filter((step) => !used.has(step.id)).map((step) => step.id);
}

/** Derived, never stored, so the countdown ends by itself at the start. */
export function phaseOf(state: CookState, nowMs: number): Phase {
  const { core } = state;
  if (terminalIdsOf(core.schedule).every((id) => core.facts[id]?.state === 'done')) {
    return 'finished';
  }
  if (nowMs - state.lastActiveMs > STALE_MS) return 'stale';
  const startMs = clockAt(core.axisMs, earliestStartMin(core.schedule));
  if (Object.keys(core.facts).length === 0 && nowMs < startMs) return 'countdown';
  return 'cooking';
}

const EXTRA_SET: readonly number[] = EXTRA_CHOICES;

/** One action on a session. An action that cannot apply returns `state` itself (CM3.7). */
export function applyCook(
  state: CookState,
  action: Exclude<CookAction, { type: 'cook/begin' | 'cook/stop' }>,
): CookState {
  const { core } = state;
  // Actions come from the UI, but a stored or wild value must not corrupt the session.
  if ('nowMs' in action && !isInstant(action.nowMs)) return state;
  const t = effectiveNow(core, 'nowMs' in action ? action.nowMs : state.lastActiveMs);
  const n = minuteAt(core.axisMs, t);
  switch (action.type) {
    case 'cook/start-now': {
      const startMs = clockAt(core.axisMs, earliestStartMin(core.schedule));
      if (Object.keys(core.facts).length > 0 || core.log.length > 0 || t >= startMs) return state;
      const shiftMs = startNowShiftMin(core, t) * MINUTE_MS;
      return undoable(state, {
        label: { kind: 'start-now' },
        t,
        core: {
          ...core,
          axisMs: core.axisMs - shiftMs,
          plannedServingMs: core.plannedServingMs - shiftMs,
        },
      });
    }
    case 'cook/start': {
      const row = core.schedule.steps.find((r) => r.id === action.stepId);
      if (row === undefined || core.facts[action.stepId] !== undefined) return state;
      const next: CookCore = {
        ...core,
        facts: {
          ...core.facts,
          [action.stepId]: { state: 'running', startedAtMs: t, extraMin: 0 },
        },
      };
      const byMin = n - row.startMin;
      return undoable(state, {
        label: { kind: 'start', stepId: action.stepId },
        t,
        core:
          Math.abs(byMin) > SLIP_MIN
            ? rebuildCore(next, { kind: 'start', stepId: action.stepId, byMin }, t)
            : next,
      });
    }
    case 'cook/done': {
      const row = core.schedule.steps.find((r) => r.id === action.stepId);
      const fact = core.facts[action.stepId];
      if (row === undefined || fact?.state !== 'running') return state;
      const next: CookCore = {
        ...core,
        facts: {
          ...core.facts,
          [action.stepId]: { state: 'done', startedAtMs: fact.startedAtMs, endedAtMs: t },
        },
      };
      const byMin = n - row.endMin;
      return undoable(state, {
        label: { kind: 'done', stepId: action.stepId },
        t,
        core:
          Math.abs(byMin) > SLIP_MIN
            ? rebuildCore(next, { kind: 'done', stepId: action.stepId, byMin }, t)
            : next,
      });
    }
    case 'cook/extra': {
      const fact = core.facts[action.stepId];
      if (fact?.state !== 'running' || !EXTRA_SET.includes(action.minutes)) return state;
      const extraMin = Math.min(EXTRA_MAX, fact.extraMin + action.minutes);
      if (extraMin === fact.extraMin) return state;
      const next: CookCore = {
        ...core,
        facts: { ...core.facts, [action.stepId]: { ...fact, extraMin } },
      };
      return undoable(state, {
        label: { kind: 'extra', stepId: action.stepId, minutes: action.minutes },
        t,
        core: rebuildCore(
          next,
          { kind: 'extra', stepId: action.stepId, minutes: action.minutes },
          t,
        ),
      });
    }
    case 'cook/behind': {
      if (phaseOf(state, t) !== 'cooking') return state;
      return undoable(state, {
        label: { kind: 'behind' },
        t,
        core: rebuildCore(core, { kind: 'behind' }, t),
      });
    }
    case 'cook/undo': {
      if (state.undo === null || t >= state.undo.untilMs) return state;
      return { ...state, core: state.undo.before, lastActiveMs: t, undo: null };
    }
    case 'cook/tick':
      // Display only: late steps are derived from the clock, so a tick records nothing.
      return state;
    case 'cook/resume':
      return state.lastActiveMs === t ? state : { ...state, lastActiveMs: t };
    case 'cook/alerts':
      if (typeof action.wanted !== 'boolean' || state.alertsWanted === action.wanted) return state;
      return { ...state, alertsWanted: action.wanted };
    default:
      return state; // an action type this version does not know
  }
}

/**
 * Steps that are late by the design's rule, sorted by id: a running step `OVERDUE_MIN` past its
 * planned end, a pending step `OVERDUE_MIN` (or its slack, if larger) past its planned start.
 * Display only: nothing rebuilds by itself (design review Q4).
 */
export function overdueIds(core: CookCore, nowMs: number): string[] {
  const n = minuteAt(core.axisMs, nowMs);
  const late: string[] = [];
  for (const row of core.schedule.steps) {
    const fact = core.facts[row.id];
    if (fact?.state === 'done') continue;
    const limit =
      fact === undefined
        ? row.startMin + Math.max(OVERDUE_MIN, row.slackMin)
        : row.endMin + OVERDUE_MIN;
    if (n >= limit) late.push(row.id);
  }
  return late.toSorted(compareIds);
}
