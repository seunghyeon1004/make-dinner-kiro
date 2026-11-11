import { successors } from '../graph.js';
import { compareIds } from '../schema.js';
import type { Plan, Step } from '../schema.js';
import { latestFit, resourcesOf, timelineFrom } from '../timeline.js';
import type { Capacity, Interval } from '../timeline.js';

/**
 * Rebuild pass 2, run only when the serving minute moved later. Moves every pending hot step,
 * latest end first (ties by id, order fixed before the first move), to the latest end at or
 * before `min(servingMin, start of each pending successor)` where its resources are free from
 * `nowMin` on. Pinned steps and steps whose result keeps do not move, and nothing moves
 * earlier. `plan` must be canonical and valid.
 */
export function reAlign(
  plan: Plan,
  cap: Capacity,
  intervals: ReadonlyMap<string, Interval>,
  pinned: ReadonlySet<string>,
  nowMin: number,
  servingMin: number,
): Map<string, Interval> {
  const succ = successors(plan);
  const next = new Map<string, Interval>(intervals);
  const intervalOf = (id: string): Interval => {
    const value = next.get(id);
    if (value === undefined) throw new Error(`reAlign: no interval for ${id}`);
    return value;
  };
  const tl = timelineFrom(plan, cap, intervals, nowMin);
  const order: Step[] = plan.steps
    .filter((s) => s.holdMin !== null && !pinned.has(s.id))
    .sort((a, b) => intervalOf(b.id).endMin - intervalOf(a.id).endMin || compareIds(a.id, b.id));
  for (const step of order) {
    const rs = resourcesOf(step);
    const here = intervalOf(step.id);
    tl.remove(rs, Math.max(here.startMin, nowMin), here.endMin);
    let deadline = servingMin;
    for (const u of succ.get(step.id) ?? []) {
      if (!pinned.has(u)) deadline = Math.min(deadline, intervalOf(u).startMin);
    }
    const endMin = latestFit(tl, rs, step.minutes, deadline, here.startMin);
    const moved = { startMin: endMin - step.minutes, endMin };
    next.set(step.id, moved);
    tl.add(rs, Math.max(moved.startMin, nowMin), moved.endMin);
  }
  return new Map([...next.entries()].sort(([a], [b]) => compareIds(a, b)));
}
