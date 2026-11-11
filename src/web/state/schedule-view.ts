import type { HoldExceededIssue, Schedule, ScheduledStep, Step } from '../../core/index.js';

/** A schedule or a rebuilt schedule: the latter adds `servingMin` (rebuild design, "The axis"). */
export type AxisSchedule = Schedule & { servingMin?: number };

export interface ScheduleView {
  plan: Schedule['plan'];
  steps: readonly ScheduledStep[];
  warnings: readonly HoldExceededIssue[];
  /** 0 for a schedule output. */
  servingMin: number;
  /** The earliest start. */
  startMin: number;
  /** `servingMin - startMin`. */
  spanMin: number;
  stepById: ReadonlyMap<string, Step>;
  dishName: ReadonlyMap<string, string>;
}

export function scheduleView(s: AxisSchedule): ScheduleView {
  const servingMin = s.servingMin ?? 0;
  const startMin = s.steps.reduce((least, step) => Math.min(least, step.startMin), servingMin);
  return {
    plan: s.plan,
    steps: s.steps,
    warnings: s.warnings,
    servingMin,
    startMin,
    spanMin: servingMin - startMin,
    stepById: new Map(s.plan.steps.map((step) => [step.id, step])),
    dishName: new Map(s.plan.dishes.map((dish) => [dish.id, dish.name])),
  };
}

export type StepMark = 'critical' | 'back-to-back' | null;

/** Critical with a hold is "critical"; critical that keeps is "back-to-back" (shown "No slack"). */
export function stepMark(s: ScheduledStep, step: Step): StepMark {
  if (!s.critical) return null;
  return step.holdMin !== null ? 'critical' : 'back-to-back';
}
