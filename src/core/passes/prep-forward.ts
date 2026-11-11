import { topologicalOrder } from '../graph.js';
import { compareIds } from '../schema.js';
import type { Plan, Step } from '../schema.js';
import { createTimeline, earliestFit, resourcesOf } from '../timeline.js';
import type { Capacity } from '../timeline.js';

/**
 * Pass 2. Moves every step whose result keeps (terminal or not), in topological order, to the
 * earliest start at or after both `T0` (the earliest start so far) and the latest end of its
 * prerequisites where its resources are free. Steps whose result does not keep stay put, and
 * no step moves later. `plan` must be canonical and valid.
 */
export function prepForwardPass(
  plan: Plan,
  cap: Capacity,
  starts: ReadonlyMap<string, number>,
): Map<string, number> {
  const order = topologicalOrder(plan);
  if (!order.ok) throw new Error('prepForwardPass: the plan has a cycle');
  const byId = new Map<string, Step>(plan.steps.map((s) => [s.id, s]));
  const next = new Map(starts);
  const startOf = (id: string): number => {
    const value = next.get(id);
    if (value === undefined) throw new Error(`prepForwardPass: no start for ${id}`);
    return value;
  };
  const t0 = Math.min(...next.values());
  const tl = createTimeline(cap);
  for (const step of plan.steps) {
    tl.add(resourcesOf(step), startOf(step.id), startOf(step.id) + step.minutes);
  }
  for (const id of order.value) {
    const step = byId.get(id);
    if (step === undefined || step.holdMin !== null) continue;
    const rs = resourcesOf(step);
    const current = startOf(id);
    tl.remove(rs, current, current + step.minutes);
    const lower = Math.max(t0, ...step.after.map((p) => startOf(p) + (byId.get(p)?.minutes ?? 0)));
    const moved = earliestFit(tl, rs, step.minutes, lower, current);
    next.set(id, moved);
    tl.add(rs, moved, moved + step.minutes);
  }
  return new Map([...next.entries()].sort(([a], [b]) => compareIds(a, b)));
}
