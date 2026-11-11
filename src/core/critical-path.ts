import { compareIds } from './schema.js';
import type { Schedule, ScheduledStep } from './schema.js';

/** A schedule or a rebuilt schedule: only the plan, the steps and (if present) `servingMin` are read. */
export type CriticalPathInput = Pick<Schedule, 'plan' | 'steps' | 'kitchen'> & {
  servingMin?: number;
};

const RESOURCES = ['burner', 'oven', 'cook'] as const;

/**
 * Whether `b` holds a lane that `s` uses on a resource that is full at the minute `s` starts.
 * Only then does delaying `b` by a minute break capacity; with a free unit `b` is not binding.
 */
function bindsByLane(
  b: ScheduledStep,
  s: ScheduledStep,
  steps: readonly ScheduledStep[],
  kitchen: CriticalPathInput['kitchen'],
): boolean {
  const capacity = { burner: kitchen.burners, oven: kitchen.ovens, cook: kitchen.cooks };
  return RESOURCES.some((r) => {
    const lane = s.lanes[r];
    if (lane === null || b.lanes[r] !== lane) return false;
    const active = steps.filter(
      (x) => x.lanes[r] !== null && x.startMin <= s.startMin && s.startMin < x.endMin,
    ).length;
    return active >= capacity[r];
  });
}

/**
 * The critical path of a schedule: the chain of steps that fixes how early dinner must start,
 * in start order (plan-ui design, "The critical path").
 *
 * The walk starts at the step that ends at the serving minute (the longest `minutes`, then the
 * smallest id, when several do). The binder of a step `s` is a step that ends exactly when `s`
 * starts and is a prerequisite of `s` or holds a lane `s` uses on a resource that is full at
 * that minute (otherwise delaying it would break nothing); prerequisites first, then the
 * longer `minutes`, then the smaller id. The walk stops when `s` has no binder. Returns `[]`
 * when no step ends at the serving minute.
 */
export function criticalPath(schedule: CriticalPathInput): string[] {
  const servingMin = schedule.servingMin ?? 0;
  const minutes = (s: ScheduledStep): number => s.endMin - s.startMin;
  const byLongestThenId = (a: ScheduledStep, b: ScheduledStep): number =>
    minutes(b) - minutes(a) || compareIds(a.id, b.id);
  const after = new Map(schedule.plan.steps.map((step) => [step.id, new Set(step.after)]));

  const last = schedule.steps.filter((s) => s.endMin === servingMin).sort(byLongestThenId)[0];
  if (last === undefined) return [];

  const path: ScheduledStep[] = [last];
  let current = last;
  for (;;) {
    const here = current;
    const prerequisites = after.get(here.id) ?? new Set<string>();
    const candidates = schedule.steps.filter(
      (s) =>
        s.endMin === here.startMin &&
        s.id !== here.id &&
        (prerequisites.has(s.id) || bindsByLane(s, here, schedule.steps, schedule.kitchen)),
    );
    const binder = [...candidates].sort(
      (a, b) =>
        Number(prerequisites.has(b.id)) - Number(prerequisites.has(a.id)) || byLongestThenId(a, b),
    )[0];
    if (binder === undefined) break;
    path.push(binder);
    current = binder;
  }
  return path.reverse().map((s) => s.id);
}
