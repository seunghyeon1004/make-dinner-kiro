import { successors } from '../graph.js';
import { compareIds } from '../schema.js';
import type { Plan, Step } from '../schema.js';
import { createTimeline, latestFit, resourcesOf } from '../timeline.js';
import type { Capacity } from '../timeline.js';

/**
 * Pass 3. Moves every step whose result does not keep, latest end first (ties by id), to the
 * latest end at or before its deadline (the earliest current successor start, or 0) where its
 * resources are free. Steps whose result keeps stay put, and no step moves earlier.
 * `plan` must be canonical and valid.
 */
export function rightJustifyPass(
  plan: Plan,
  cap: Capacity,
  starts: ReadonlyMap<string, number>,
): Map<string, number> {
  const succ = successors(plan);
  const next = new Map(starts);
  const startOf = (id: string): number => {
    const value = next.get(id);
    if (value === undefined) throw new Error(`rightJustifyPass: no start for ${id}`);
    return value;
  };
  const endOf = (step: Step): number => startOf(step.id) + step.minutes;
  const tl = createTimeline(cap);
  for (const step of plan.steps) tl.add(resourcesOf(step), startOf(step.id), endOf(step));

  const order = plan.steps
    .filter((s) => s.holdMin !== null)
    .map((s) => ({ step: s, end: endOf(s) }))
    .sort((a, b) => b.end - a.end || compareIds(a.step.id, b.step.id));
  for (const { step } of order) {
    const rs = resourcesOf(step);
    const currentEnd = endOf(step);
    tl.remove(rs, startOf(step.id), currentEnd);
    const users = succ.get(step.id) ?? [];
    const deadline = users.length === 0 ? 0 : Math.min(...users.map(startOf));
    const end = latestFit(tl, rs, step.minutes, deadline, currentEnd - step.minutes);
    next.set(step.id, end - step.minutes);
    tl.add(rs, end - step.minutes, end);
  }
  return new Map([...next.entries()].sort(([a], [b]) => compareIds(a, b)));
}
