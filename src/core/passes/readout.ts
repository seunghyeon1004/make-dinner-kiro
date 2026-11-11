import { successors } from '../graph.js';
import { sortIssues } from '../sanity.js';
import type { HoldExceededIssue, Plan } from '../schema.js';
import { createTimeline, resourcesOf, timelineFrom } from '../timeline.js';
import type { Capacity, Interval } from '../timeline.js';

export interface Readout {
  slackMin: Map<string, number>;
  waitMin: Map<string, number | null>;
  warnings: HoldExceededIssue[];
}

const minutesText = (n: number): string => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

export function holdExceededMessage(
  stepId: string,
  terminal: boolean,
  waitMin: number,
  holdMin: number,
): string {
  const before = terminal ? 'serving' : 'the step that uses it';
  return `Step ${stepId} will be ready ${minutesText(waitMin)} before ${before} and can wait only ${minutesText(holdMin)}. More ovens, burners or cooks may help.`;
}

/**
 * Pass 5. Slack by the G8 definition (delay one step alone, lanes and holds ignored), waits
 * measured to the first successor to start, and one `hold_exceeded` per step that waits too long.
 * `plan` must be canonical and valid and `starts` must satisfy G1 to G3.
 */
export function readout(plan: Plan, cap: Capacity, starts: ReadonlyMap<string, number>): Readout {
  const succ = successors(plan);
  const startOf = (id: string): number => {
    const value = starts.get(id);
    if (value === undefined) throw new Error(`readout: no start for ${id}`);
    return value;
  };
  const tl = createTimeline(cap);
  for (const s of plan.steps) tl.add(resourcesOf(s), startOf(s.id), startOf(s.id) + s.minutes);

  const slackMin = new Map<string, number>();
  const waitMin = new Map<string, number | null>();
  const warnings: HoldExceededIssue[] = [];
  for (const step of plan.steps) {
    const users = (succ.get(step.id) ?? []).map(startOf);
    const end = startOf(step.id) + step.minutes;
    const rs = resourcesOf(step);

    const limit = (users.length === 0 ? 0 : Math.min(...users)) - end;
    tl.remove(rs, startOf(step.id), end);
    let slack = limit;
    for (let d = 1; d <= limit; d++) {
      if (tl.firstFull(rs, end + d - 1, end + d) !== null) {
        slack = d - 1;
        break;
      }
    }
    tl.add(rs, startOf(step.id), end);
    slackMin.set(step.id, slack);

    const wait = step.holdMin === null ? null : (users.length === 0 ? 0 : Math.min(...users)) - end;
    waitMin.set(step.id, wait);
    if (wait !== null && step.holdMin !== null && wait > step.holdMin) {
      warnings.push({
        severity: 'warning',
        code: 'hold_exceeded',
        message: holdExceededMessage(step.id, users.length === 0, wait, step.holdMin),
        stepId: step.id,
        waitMin: wait,
        holdMin: step.holdMin,
      });
    }
  }
  return {
    slackMin,
    waitMin,
    warnings: sortIssues(warnings).filter(
      (i): i is HoldExceededIssue => i.code === 'hold_exceeded',
    ),
  };
}

/**
 * Rebuild readout against the serving minute `servingMin`. A pending step's slack is the
 * largest `k` such that delaying it alone by every `d` in `1..k` keeps its resources free from
 * `nowMin` on, ends it by `servingMin` and keeps it before every pending successor's start;
 * a pinned step has slack 0. Waits come from the final intervals: a result that keeps has
 * none, a terminal step waits until `servingMin`, any other until its first successor starts
 * (never less than 0, as that successor may have started before the step ended). One `hold_exceeded` warning per
 * step that waits longer than its hold, pinned or not. `plan` must be canonical and valid.
 */
export function rebuildReadout(
  plan: Plan,
  cap: Capacity,
  intervals: ReadonlyMap<string, Interval>,
  pinned: ReadonlySet<string>,
  nowMin: number,
  servingMin: number,
): Readout {
  const succ = successors(plan);
  const intervalOf = (id: string): Interval => {
    const value = intervals.get(id);
    if (value === undefined) throw new Error(`rebuildReadout: no interval for ${id}`);
    return value;
  };
  const tl = timelineFrom(plan, cap, intervals, nowMin);

  const slackMin = new Map<string, number>();
  const waitMin = new Map<string, number | null>();
  const warnings: HoldExceededIssue[] = [];
  for (const step of plan.steps) {
    const here = intervalOf(step.id);
    const users = succ.get(step.id) ?? [];
    const rs = resourcesOf(step);

    let slack = 0;
    if (!pinned.has(step.id)) {
      let deadline = servingMin;
      for (const u of users) {
        if (!pinned.has(u)) deadline = Math.min(deadline, intervalOf(u).startMin);
      }
      const limit = deadline - here.endMin;
      tl.remove(rs, Math.max(here.startMin, nowMin), here.endMin);
      slack = Math.max(0, limit);
      for (let d = 1; d <= limit; d++) {
        if (tl.firstFull(rs, here.endMin + d - 1, here.endMin + d) !== null) {
          slack = d - 1;
          break;
        }
      }
      tl.add(rs, Math.max(here.startMin, nowMin), here.endMin);
    }
    slackMin.set(step.id, slack);

    let wait: number | null = null;
    if (step.holdMin !== null) {
      wait =
        users.length === 0
          ? servingMin - here.endMin
          : Math.max(0, Math.min(...users.map((u) => intervalOf(u).startMin)) - here.endMin);
    }
    waitMin.set(step.id, wait);
    if (wait !== null && step.holdMin !== null && wait > step.holdMin) {
      warnings.push({
        severity: 'warning',
        code: 'hold_exceeded',
        message: holdExceededMessage(step.id, users.length === 0, wait, step.holdMin),
        stepId: step.id,
        waitMin: wait,
        holdMin: step.holdMin,
      });
    }
  }
  return {
    slackMin,
    waitMin,
    warnings: sortIssues(warnings).filter(
      (i): i is HoldExceededIssue => i.code === 'hold_exceeded',
    ),
  };
}
