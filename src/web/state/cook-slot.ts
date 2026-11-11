import { z } from 'zod';
import {
  IssueSchema,
  RebuiltScheduleSchema,
  StepIdSchema,
  StepMoveSchema,
} from '../../core/index.js';
import type {
  HoldExceededIssue,
  RebuildError,
  RebuiltSchedule,
  Schedule,
  StepMove,
} from '../../core/index.js';
import { applyCook, beginSession, EXTRA_MAX, LOG_MAX } from './cook-session.js';

/** A recorded real start or end of a step (a timestamp in ms). */
export type StepFact =
  | { state: 'running'; startedAtMs: number; extraMin: number }
  | { state: 'done'; startedAtMs: number; endedAtMs: number };

/**
 * What caused a rebuild. There is no automatic rebuild for an overdue step (design review Q4):
 * a late step is only shown late, and the cook's "I'm behind" is the `behind` cause.
 */
export type LogCause =
  | { kind: 'begin-late'; byMin: number }
  | { kind: 'start' | 'done'; stepId: string; byMin: number } // + late, - early
  | { kind: 'extra'; stepId: string; minutes: 5 | 10 | 15 }
  | { kind: 'behind' };

export type LogResult =
  | {
      ok: true;
      moved: StepMove[]; // sorted by (toStartMin, stepId)
      unchanged: string[];
      servingFromMin: number;
      servingToMin: number;
      newWarnings: HoldExceededIssue[];
    }
  | { ok: false; error: RebuildError['kind'] };

export interface LogEntry {
  atMs: number;
  cause: LogCause;
  result: LogResult;
}

export interface CookCore {
  /** Minute 0 of the session; never rebased after the first fact. */
  axisMs: number;
  /** `clockAt(axisMs, 0)` of the serving minute when cooking began (after "Start now"). */
  plannedServingMs: number;
  beganAtMs: number;
  schedule: RebuiltSchedule;
  facts: Record<string, StepFact>;
  /** Oldest first, at most `LOG_MAX`. */
  log: LogEntry[];
}

export type UndoLabel =
  | { kind: 'start' | 'done'; stepId: string }
  | { kind: 'extra'; stepId: string; minutes: number }
  | { kind: 'behind' }
  | { kind: 'start-now' };

export interface CookState {
  version: 1;
  core: CookCore;
  lastActiveMs: number;
  alertsWanted: boolean;
  undo: { label: UndoLabel; untilMs: number; before: CookCore } | null;
}

export type CookAction =
  | { type: 'cook/begin'; schedule: Schedule | RebuiltSchedule; axisMs: number; nowMs: number }
  | {
      type: 'cook/start-now' | 'cook/behind' | 'cook/undo' | 'cook/tick' | 'cook/resume';
      nowMs: number;
    }
  | { type: 'cook/start' | 'cook/done'; stepId: string; nowMs: number }
  | { type: 'cook/extra'; stepId: string; minutes: 5 | 10 | 15; nowMs: number }
  | { type: 'cook/alerts'; wanted: boolean }
  | { type: 'cook/stop' };

const ms = z.int().min(0);
const stepId = StepIdSchema;

const HoldExceededSchema = IssueSchema.refine(
  (issue): issue is HoldExceededIssue => issue.code === 'hold_exceeded',
);

const StepFactSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('running'),
    startedAtMs: ms,
    extraMin: z.int().min(0).max(EXTRA_MAX),
  }),
  z.strictObject({ state: z.literal('done'), startedAtMs: ms, endedAtMs: ms }),
]);

const LogCauseSchema = z.union([
  z.strictObject({ kind: z.literal('begin-late'), byMin: z.int() }),
  z.strictObject({ kind: z.enum(['start', 'done']), stepId, byMin: z.int() }),
  z.strictObject({
    kind: z.literal('extra'),
    stepId,
    minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
  }),
  z.strictObject({ kind: z.literal('behind') }),
]);

const LogResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    moved: z.array(StepMoveSchema),
    unchanged: z.array(stepId),
    servingFromMin: z.int(),
    servingToMin: z.int(),
    newWarnings: z.array(HoldExceededSchema),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.enum([
      'invalid_schedule',
      'invalid_now',
      'invalid_progress',
      'unknown_step',
      'done_ends_before_start',
      'done_after_now',
      'running_starts_after_now',
      'serving_out_of_range',
    ]),
  }),
]);

const LogEntrySchema = z.strictObject({ atMs: ms, cause: LogCauseSchema, result: LogResultSchema });

/** Every fact and log id must be a step of the core's own schedule. */
const CookCoreSchema = z
  .strictObject({
    axisMs: z.int(),
    plannedServingMs: z.int(),
    beganAtMs: ms,
    schedule: RebuiltScheduleSchema,
    facts: z.record(z.string(), StepFactSchema),
    log: z.array(LogEntrySchema).max(LOG_MAX),
  })
  .refine((core) => {
    const ids = new Set(core.schedule.steps.map((s) => s.id));
    const known = (id: string): boolean => ids.has(id);
    return (
      Object.keys(core.facts).every(known) &&
      core.log.every((entry) => {
        const { cause, result } = entry;
        const causeOk = 'stepId' in cause ? known(cause.stepId) : true;
        const resultOk = result.ok
          ? result.moved.every((m) => known(m.stepId)) && result.unchanged.every(known)
          : true;
        return causeOk && resultOk;
      })
    );
  });

const UndoLabelSchema = z.union([
  z.strictObject({ kind: z.enum(['start', 'done']), stepId }),
  z.strictObject({ kind: z.literal('extra'), stepId, minutes: z.int() }),
  z.strictObject({ kind: z.literal('behind') }),
  z.strictObject({ kind: z.literal('start-now') }),
]);

/** The undo slot holds a `CookCore`, never a `CookState`, so slots never nest. */
export const CookStateSchema: z.ZodType<CookState> = z.strictObject({
  version: z.literal(1),
  core: CookCoreSchema,
  lastActiveMs: ms,
  alertsWanted: z.boolean(),
  undo: z.strictObject({ label: UndoLabelSchema, untilMs: ms, before: CookCoreSchema }).nullable(),
});

/**
 * Cooking-mode reducer for plan-ui's `reduce` (R9.9). An action that changes nothing returns
 * `state` itself; `cook/begin` with a session already there, or one that cannot begin, too.
 */
export function reduceCook<S extends { cook: CookState | null }>(state: S, action: CookAction): S {
  if (action.type === 'cook/stop') {
    return state.cook === null ? state : { ...state, cook: null };
  }
  if (action.type === 'cook/begin') {
    if (state.cook !== null) return state;
    const begun = beginSession(action.schedule, action.axisMs, action.nowMs);
    return begun.ok ? { ...state, cook: begun.value } : state;
  }
  if (state.cook === null) return state;
  const next = applyCook(state.cook, action);
  return next === state.cook ? state : { ...state, cook: next };
}
