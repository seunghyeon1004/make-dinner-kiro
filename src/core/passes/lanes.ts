import { compareIds } from '../schema.js';
import type { Plan, Step, StepLanes } from '../schema.js';
import { resourcesOf } from '../timeline.js';
import type { Capacity, Interval, Resource } from '../timeline.js';

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

/**
 * Rebuild lanes. Steps go in order of (start, id). For each resource a step uses, the lane is
 * the first of these that no overlapping, already assigned step holds: its lane in the previous
 * schedule (when within the kitchen), the lane of a prerequisite that uses the resource (latest
 * end first, ties by id), the smallest lane. When every lane is held, which only a pinned step
 * can meet, it keeps its previous lane if within the kitchen, else lane 1; this is not an error.
 * `plan` must be canonical and valid and `intervals` must hold every step.
 */
export function assignRebuildLanes(
  plan: Plan,
  cap: Capacity,
  intervals: ReadonlyMap<string, Interval>,
  prevLanes: ReadonlyMap<string, StepLanes>,
): Map<string, StepLanes> {
  const byId = new Map<string, Step>(plan.steps.map((s) => [s.id, s]));
  const intervalOf = (id: string): Interval => {
    const value = intervals.get(id);
    if (value === undefined) throw new Error(`assignRebuildLanes: no interval for ${id}`);
    return value;
  };
  const lanes = new Map<string, StepLanes>();
  const laneOf = (id: string, r: Resource): number | null => lanes.get(id)?.[r] ?? null;
  const prevLaneOf = (id: string, r: Resource): number | null => {
    const lane = prevLanes.get(id)?.[r] ?? null;
    return lane !== null && lane >= 1 && lane <= cap[r] ? lane : null;
  };

  const order = [...plan.steps].sort(
    (a, b) => intervalOf(a.id).startMin - intervalOf(b.id).startMin || compareIds(a.id, b.id),
  );
  const assigned: Step[] = [];
  for (const step of order) {
    const here = intervalOf(step.id);
    const chosen: Record<Resource, number | null> = { burner: null, oven: null, cook: null };
    for (const r of resourcesOf(step)) {
      const busy = new Set<number>();
      for (const u of assigned) {
        if (!resourcesOf(u).includes(r)) continue;
        const other = intervalOf(u.id);
        if (other.startMin >= here.endMin || here.startMin >= other.endMin) continue;
        const lane = laneOf(u.id, r);
        if (lane !== null) busy.add(lane);
      }
      const candidates: number[] = [];
      const prev = prevLaneOf(step.id, r);
      if (prev !== null) candidates.push(prev);
      const prereqs = step.after
        .map((p) => byId.get(p))
        .filter((p): p is Step => p !== undefined && resourcesOf(p).includes(r))
        .sort(
          (a, b) => intervalOf(b.id).endMin - intervalOf(a.id).endMin || compareIds(a.id, b.id),
        );
      for (const p of prereqs) {
        const lane = laneOf(p.id, r);
        if (lane !== null) candidates.push(lane);
      }
      let lane = candidates.find((l) => !busy.has(l)) ?? null;
      for (let l = 1; lane === null && l <= cap[r]; l++) {
        if (!busy.has(l)) lane = l;
      }
      chosen[r] = lane ?? prev ?? 1;
    }
    lanes.set(step.id, chosen);
    assigned.push(step);
  }
  return new Map([...lanes.entries()].sort(([a], [b]) => compareIds(a, b)));
}
