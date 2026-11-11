import { compareIds } from '../schema.js';
import type { Plan, Step, StepLanes } from '../schema.js';
import { resourcesOf } from '../timeline.js';
import type { Capacity, Resource } from '../timeline.js';

/**
 * Pass 4. Greedy interval colouring in order of (start, id): for each resource a step uses,
 * it takes the lane of the prerequisite that ended last (ties by id) when that lane is free,
 * otherwise the smallest free lane. `plan` must be canonical and valid; `starts` must satisfy
 * capacity, so a free lane always exists (none free is a bug and throws).
 */
export function assignLanes(
  plan: Plan,
  cap: Capacity,
  starts: ReadonlyMap<string, number>,
): Map<string, StepLanes> {
  const byId = new Map<string, Step>(plan.steps.map((s) => [s.id, s]));
  const startOf = (id: string): number => {
    const value = starts.get(id);
    if (value === undefined) throw new Error(`assignLanes: no start for ${id}`);
    return value;
  };
  const endOf = (step: Step): number => startOf(step.id) + step.minutes;
  const lanes = new Map<string, StepLanes>();
  const laneOf = (id: string, r: Resource): number | null => lanes.get(id)?.[r] ?? null;

  const order = [...plan.steps].sort(
    (a, b) => startOf(a.id) - startOf(b.id) || compareIds(a.id, b.id),
  );
  const assigned: Step[] = [];
  for (const step of order) {
    const chosen: Record<Resource, number | null> = { burner: null, oven: null, cook: null };
    for (const r of resourcesOf(step)) {
      const busy = new Set<number>();
      for (const u of assigned) {
        if (endOf(u) <= startOf(step.id) || !resourcesOf(u).includes(r)) continue;
        const lane = laneOf(u.id, r);
        if (lane !== null) busy.add(lane);
      }
      const candidates = step.after
        .map((p) => byId.get(p))
        .filter((p): p is Step => p !== undefined && resourcesOf(p).includes(r))
        .sort((a, b) => endOf(b) - endOf(a) || compareIds(a.id, b.id));
      let lane: number | null = null;
      for (const p of candidates) {
        const l = laneOf(p.id, r);
        if (l !== null && !busy.has(l)) {
          lane = l;
          break;
        }
      }
      for (let l = 1; lane === null && l <= cap[r]; l++) {
        if (!busy.has(l)) lane = l;
      }
      if (lane === null) throw new Error(`assignLanes: no free ${r} lane for ${step.id}`);
      chosen[r] = lane;
    }
    lanes.set(step.id, chosen);
    assigned.push(step);
  }
  return new Map([...lanes.entries()].sort(([a], [b]) => compareIds(a, b)));
}
