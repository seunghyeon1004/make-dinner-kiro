import { successors, terminalSteps } from '../graph.js';
import { compareIds } from '../schema.js';
import type { Plan, Step } from '../schema.js';
import { createTimeline, latestFit, resourcesOf } from '../timeline.js';
import type { Capacity } from '../timeline.js';

/** Sorts below every real hold (the schema caps holdMin at 480), so a keeps step comes last. */
const KEEPS_RANK = 481;

/**
 * Pass 1. Places steps one at a time from serving time backwards: a step is eligible once
 * every successor is placed, and goes at the latest end at or before its deadline where its
 * resources are free. `plan` must be canonical and valid.
 */
export function backwardPass(plan: Plan, cap: Capacity): Map<string, number> {
  const succ = successors(plan);
  const byId = new Map<string, Step>(plan.steps.map((s) => [s.id, s]));
  const total = plan.steps.reduce((sum, s) => sum + s.minutes, 0);
  const tl = createTimeline(cap);
  const placed = new Map<string, number>();

  const succOf = (id: string): readonly string[] => succ.get(id) ?? [];
  const deadline = (id: string): number => {
    const users = succOf(id);
    if (users.length === 0) return 0;
    return Math.min(...users.map((u) => placed.get(u) ?? 0));
  };
  const holdRank = (id: string): number =>
    succOf(id).length === 0 ? (byId.get(id)?.holdMin ?? KEEPS_RANK) : 0;

  const eligible = new Set<string>(terminalSteps(plan));
  for (let placedCount = 0; placedCount < plan.steps.length; placedCount++) {
    const next = [...eligible].sort(
      (a, b) => deadline(b) - deadline(a) || holdRank(a) - holdRank(b) || compareIds(a, b),
    )[0];
    const step = next === undefined ? undefined : byId.get(next);
    if (next === undefined || step === undefined) {
      throw new Error('backwardPass: no eligible step (the plan has a cycle)');
    }
    const rs = resourcesOf(step);
    const end = latestFit(tl, rs, step.minutes, deadline(next), -total);
    placed.set(next, end - step.minutes);
    tl.add(rs, end - step.minutes, end);
    eligible.delete(next);
    for (const p of step.after) {
      if (!placed.has(p) && succOf(p).every((u) => placed.has(u))) eligible.add(p);
    }
  }
  return new Map([...placed.entries()].sort(([a], [b]) => compareIds(a, b)));
}
