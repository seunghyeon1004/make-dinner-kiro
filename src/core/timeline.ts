import type { Kitchen, Plan, Step } from './schema.js';

export type Resource = 'burner' | 'oven' | 'cook';
export const RESOURCES: readonly Resource[] = ['burner', 'oven', 'cook'];
export type Capacity = Readonly<Record<Resource, number>>;

export function capacityOf(kitchen: Kitchen): Capacity {
  return { burner: kitchen.burners, oven: kitchen.ovens, cook: kitchen.cooks };
}

/** In RESOURCES order: the appliance (unless 'none'), then 'cook' iff handsOn. */
export function resourcesOf(step: Pick<Step, 'appliance' | 'handsOn'>): Resource[] {
  const out: Resource[] = [];
  if (step.appliance !== 'none') out.push(step.appliance);
  if (step.handsOn) out.push('cook');
  return out;
}

export interface Timeline {
  usage(r: Resource, minute: number): number;
  add(rs: readonly Resource[], startMin: number, endMin: number): void;
  remove(rs: readonly Resource[], startMin: number, endMin: number): void;
  /** Largest t in [startMin, endMin) with usage(r, t) + 1 > cap(r) for some r in rs; else null. */
  lastFull(rs: readonly Resource[], startMin: number, endMin: number): number | null;
  /** Smallest such t; else null. */
  firstFull(rs: readonly Resource[], startMin: number, endMin: number): number | null;
}

/**
 * Local mutable state inside one `schedule` call: one map per resource, minute to count,
 * a missing minute meaning 0. Nothing outside holds a reference to it.
 */
export function createTimeline(capacity: Capacity): Timeline {
  const counts: Record<Resource, Map<number, number>> = {
    burner: new Map(),
    oven: new Map(),
    cook: new Map(),
  };
  const usage = (r: Resource, minute: number): number => counts[r].get(minute) ?? 0;
  const isFull = (rs: readonly Resource[], minute: number): boolean =>
    rs.some((r) => usage(r, minute) + 1 > capacity[r]);
  const change = (rs: readonly Resource[], startMin: number, endMin: number, by: 1 | -1): void => {
    for (const r of rs) {
      for (let minute = startMin; minute < endMin; minute++) {
        counts[r].set(minute, usage(r, minute) + by);
      }
    }
  };
  return {
    usage,
    add: (rs, startMin, endMin) => change(rs, startMin, endMin, 1),
    remove: (rs, startMin, endMin) => change(rs, startMin, endMin, -1),
    lastFull(rs, startMin, endMin) {
      for (let minute = endMin - 1; minute >= startMin; minute--) {
        if (isFull(rs, minute)) return minute;
      }
      return null;
    },
    firstFull(rs, startMin, endMin) {
      for (let minute = startMin; minute < endMin; minute++) {
        if (isFull(rs, minute)) return minute;
      }
      return null;
    },
  };
}

/**
 * Latest end e <= upper such that [e - minutes, e) fits; throws when the start would fall
 * below floorMin (a bug: the caller's floor is below every busy minute).
 *
 * Jump: if minute t is full in the window ending at e, the windows ending at t + 1 .. e all
 * contain t when t is the last full minute of the window ending at e (they start no later than
 * the current one and end after t), so none fits; the next candidate is e = t. This gives the
 * same answer as trying every end one by one.
 */
export function latestFit(
  tl: Timeline,
  rs: readonly Resource[],
  minutes: number,
  upper: number,
  floorMin: number,
): number {
  let end = upper;
  for (;;) {
    if (end - minutes < floorMin) {
      throw new Error(`latestFit: no room at or above minute ${floorMin}`);
    }
    const full = tl.lastFull(rs, end - minutes, end);
    if (full === null) return end;
    end = full;
  }
}

/**
 * Earliest start s >= lower such that [s, s + minutes) fits; throws when the start would pass
 * ceilMin (a bug). Mirror of `latestFit`: a full minute t in the window starting at s rules out
 * every start from s to t, so the next candidate is s = t + 1.
 */
export function earliestFit(
  tl: Timeline,
  rs: readonly Resource[],
  minutes: number,
  lower: number,
  ceilMin: number,
): number {
  let start = lower;
  for (;;) {
    if (start > ceilMin) {
      throw new Error(`earliestFit: no room at or below minute ${ceilMin}`);
    }
    const full = tl.firstFull(rs, start, start + minutes);
    if (full === null) return start;
    start = full + 1;
  }
}

/** A step's interval on the axis: it is active in the minutes `startMin <= t < endMin`. */
export interface Interval {
  startMin: number;
  endMin: number;
}

/**
 * A timeline holding every step's resources over `[max(startMin, fromMin), endMin)`.
 * `plan` must be canonical; a step with no interval in `intervals` holds nothing.
 */
export function timelineFrom(
  plan: Plan,
  cap: Capacity,
  intervals: ReadonlyMap<string, Interval>,
  fromMin: number,
): Timeline {
  const tl = createTimeline(cap);
  for (const step of plan.steps) {
    const interval = intervals.get(step.id);
    if (interval === undefined) continue;
    tl.add(resourcesOf(step), Math.max(interval.startMin, fromMin), interval.endMin);
  }
  return tl;
}
