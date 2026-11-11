import { successors } from '../graph.js';
import { sortIssues } from '../sanity.js';
import type { HoldExceededIssue, Plan } from '../schema.js';
import { createTimeline, resourcesOf } from '../timeline.js';
import type { Capacity } from '../timeline.js';

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
 * measured to the latest successor, and one `hold_exceeded` per step that waits too long.
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

    const wait = step.holdMin === null ? null : (users.length === 0 ? 0 : Math.max(...users)) - end;
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
