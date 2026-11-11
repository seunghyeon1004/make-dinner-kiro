import { compareIds } from '../schema.js';
import type { Plan, Step } from '../schema.js';
import { earliestFit, resourcesOf, timelineFrom } from '../timeline.js';
import type { Capacity, Interval } from '../timeline.js';

/**
 * Rebuild pass 1. Keeps every pinned interval and places each pending step, one at a time, at
 * the earliest start at or after `max(prev start, now, end of each prerequisite)` where its
 * resources are free, counting the pinned steps from `nowMin` on and the pending steps already
 * placed. A pending step is ready when every pending prerequisite is placed; among the ready
 * steps the smallest `(prev start, id)` goes first. No pending step starts before its previous
 * start or before `nowMin`. `plan` must be canonical and valid; `prevStarts` has every step.
 */
export function forwardRepair(
  plan: Plan,
  cap: Capacity,
  prevStarts: ReadonlyMap<string, number>,
  pinned: ReadonlyMap<string, Interval>,
  nowMin: number,
): Map<string, Interval> {
  const intervals = new Map<string, Interval>(pinned);
  const prevOf = (step: Step): number => {
    const value = prevStarts.get(step.id);
    if (value === undefined) throw new Error(`forwardRepair: no previous start for ${step.id}`);
    return value;
  };
  const tl = timelineFrom(plan, cap, pinned, nowMin);
  const unplaced = plan.steps.filter((s) => !pinned.has(s.id));
  const total = plan.steps.reduce((sum, s) => sum + s.minutes, 0);
  let horizon = nowMin;
  for (const i of pinned.values()) horizon = Math.max(horizon, i.endMin);
  for (const s of unplaced) horizon = Math.max(horizon, prevOf(s));
  const ceilMin = horizon + total;

  while (unplaced.length > 0) {
    let pick: Step | undefined;
    for (const s of unplaced) {
      if (!s.after.every((p) => intervals.has(p))) continue;
      if (
        pick === undefined ||
        prevOf(s) < prevOf(pick) ||
        (prevOf(s) === prevOf(pick) && compareIds(s.id, pick.id) < 0)
      ) {
        pick = s;
      }
    }
    if (pick === undefined) throw new Error('forwardRepair: no ready step (a cycle?)');
    let lower = Math.max(prevOf(pick), nowMin);
    for (const p of pick.after) lower = Math.max(lower, intervals.get(p)?.endMin ?? lower);
    const rs = resourcesOf(pick);
    const startMin = earliestFit(tl, rs, pick.minutes, lower, ceilMin);
    intervals.set(pick.id, { startMin, endMin: startMin + pick.minutes });
    tl.add(rs, startMin, startMin + pick.minutes);
    unplaced.splice(unplaced.indexOf(pick), 1);
  }
  return new Map([...intervals.entries()].sort(([a], [b]) => compareIds(a, b)));
}
