import { longestChainMinutes } from './graph.js';
import { forwardRepair } from './passes/forward-repair.js';
import { assignRebuildLanes } from './passes/lanes.js';
import { reAlign } from './passes/re-align.js';
import { rebuildReadout } from './passes/readout.js';
import { err, ok } from './result.js';
import type { Result } from './result.js';
import { checkKitchen, hasErrors, sortIssues, validatePlan } from './sanity.js';
import {
  AXIS_MIN,
  canonicalPlan,
  compareIds,
  ProgressSchema,
  REBUILD_LIMITS,
  RebuiltScheduleSchema,
} from './schema.js';
import type {
  Issue,
  Progress,
  Rebuilt,
  RebuiltSchedule,
  RebuiltStep,
  Schedule,
  StepMove,
} from './schema.js';
import { capacityOf } from './timeline.js';
import type { Interval } from './timeline.js';

export type RebuildError =
  // issues: validatePlan errors ('plan') or checkKitchen errors ('kitchen'), else []
  | { kind: 'invalid_schedule'; reason: 'shape' | 'plan' | 'kitchen' | 'step_ids'; issues: Issue[] }
  | { kind: 'invalid_now' }
  | { kind: 'invalid_progress' }
  | {
      kind:
        'unknown_step' | 'done_ends_before_start' | 'done_after_now' | 'running_starts_after_now';
      stepId: string;
    }
  | { kind: 'serving_out_of_range'; servingMin: number };

const invalidSchedule = (
  reason: 'shape' | 'plan' | 'kitchen' | 'step_ids',
  issues: Issue[] = [],
): RebuildError => ({ kind: 'invalid_schedule', reason, issues });

/**
 * The incremental build. Done and running steps are pinned at what really happened (the cook is
 * always right about the past); pending steps are moved only as far as they must. Checks its
 * inputs in a fixed order and returns the first failure alone. Never throws on any value; the
 * arguments are not changed. The output is a valid input to the next rebuild.
 */
export function rebuild(
  schedule: Schedule | RebuiltSchedule,
  progress: Progress,
  now: number,
): Result<Rebuilt, RebuildError> {
  // 1. Checks, in the order of the design.
  const parsed = RebuiltScheduleSchema.safeParse(schedule);
  if (!parsed.success) return err(invalidSchedule('shape'));
  const input = parsed.data;
  const checked = validatePlan(input.plan);
  const planIssues = sortIssues(checked.issues.filter((i) => i.severity === 'error'));
  if (checked.plan === null || hasErrors(planIssues)) {
    return err(invalidSchedule('plan', planIssues));
  }
  const kitchenIssues = checkKitchen(checked.plan, input.kitchen);
  if (hasErrors(kitchenIssues)) return err(invalidSchedule('kitchen', kitchenIssues));
  const plan = canonicalPlan(checked.plan);
  const planIds = plan.steps.map((s) => s.id);
  const rowIds = input.steps.map((s) => s.id).toSorted(compareIds);
  if (rowIds.length !== planIds.length || rowIds.some((id, i) => id !== planIds[i])) {
    return err(invalidSchedule('step_ids'));
  }
  if (!Number.isInteger(now) || now < AXIS_MIN || now > REBUILD_LIMITS.servingMax) {
    return err({ kind: 'invalid_now' });
  }
  const parsedProgress = ProgressSchema.safeParse(progress);
  if (!parsedProgress.success) return err({ kind: 'invalid_progress' });
  const facts = parsedProgress.data;
  const pinnedIds = Object.keys(facts).toSorted(compareIds);
  const unknown = pinnedIds.find((id) => !planIds.includes(id));
  if (unknown !== undefined) return err({ kind: 'unknown_step', stepId: unknown });
  for (const id of pinnedIds) {
    const fact = facts[id];
    if (fact === undefined) continue;
    if (fact.state === 'done') {
      if (fact.endMin < fact.startMin) return err({ kind: 'done_ends_before_start', stepId: id });
      if (fact.endMin > now) return err({ kind: 'done_after_now', stepId: id });
    } else if (fact.startMin > now) {
      return err({ kind: 'running_starts_after_now', stepId: id });
    }
  }

  // 2. Pinned intervals.
  const cap = capacityOf(input.kitchen);
  const servingPrev = input.servingMin;
  const prevStarts = new Map(input.steps.map((s) => [s.id, s.startMin]));
  const prevLanes = new Map(input.steps.map((s) => [s.id, s.lanes]));
  const pinned = new Map<string, Interval>();
  for (const step of plan.steps) {
    const fact = facts[step.id];
    if (fact === undefined) continue;
    pinned.set(
      step.id,
      fact.state === 'done'
        ? { startMin: fact.startMin, endMin: fact.endMin }
        : {
            startMin: fact.startMin,
            endMin: Math.max(fact.startMin + step.minutes + fact.extraMin, now),
          },
    );
  }

  // 3. Forward repair, the serving minute, re-align.
  const repaired = forwardRepair(plan, cap, prevStarts, pinned, now);
  let servingMin = servingPrev;
  for (const i of repaired.values()) servingMin = Math.max(servingMin, i.endMin);
  if (servingMin > REBUILD_LIMITS.servingMax)
    return err({ kind: 'serving_out_of_range', servingMin });
  const pinnedSet: ReadonlySet<string> = new Set(pinned.keys());
  const intervals =
    repaired;

  // 4. Lanes, readout, assembly, diff.
  const lanes = assignRebuildLanes(plan, cap, intervals, prevLanes);
  const read = rebuildReadout(plan, cap, intervals, pinnedSet, now, servingMin);
  const chain = longestChainMinutes(plan);
  if (!chain.ok) throw new Error('rebuild: the plan has a cycle after validation');

  const steps = plan.steps.map((step): RebuiltStep => {
    const interval = intervals.get(step.id);
    const stepLanes = lanes.get(step.id);
    const slackMin = read.slackMin.get(step.id);
    const waitMin = read.waitMin.get(step.id);
    if (
      interval === undefined ||
      stepLanes === undefined ||
      slackMin === undefined ||
      waitMin === undefined
    ) {
      throw new Error(`rebuild: a pass left out ${step.id}`);
    }
    return {
      id: step.id,
      startMin: interval.startMin,
      endMin: interval.endMin,
      lanes: stepLanes,
      slackMin,
      critical: !pinnedSet.has(step.id) && slackMin === 0,
      waitMin,
    };
  });
  const moved: StepMove[] = [];
  const unchanged: string[] = [];
  for (const s of steps) {
    const from = prevStarts.get(s.id);
    if (from === undefined) throw new Error(`rebuild: no previous start for ${s.id}`);
    if (from === s.startMin) unchanged.push(s.id);
    else moved.push({ stepId: s.id, fromStartMin: from, toStartMin: s.startMin });
  }
  return ok({
    schedule: {
      plan,
      kitchen: input.kitchen,
      steps,
      spanMin: servingMin - Math.min(...steps.map((s) => s.startMin)),
      chainMin: chain.value,
      warnings: read.warnings,
      servingMin,
    },
    diff: { moved, unchanged, servingShiftMin: servingMin - servingPrev },
  });
}
