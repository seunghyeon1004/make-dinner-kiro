import type { ScheduledStep } from '../../core/index.js';
import { compareIds } from '../../core/index.js';
import { COPY, laneName, listWait } from '../copy.js';
import {
  clockAt,
  formatClock,
  formatDuration,
  formatWeekday,
  sameLocalDate,
} from '../state/clock.js';
import type { ScheduleView } from '../state/schedule-view.js';

/** On the critical path; can slip `minutes` (slack above 0); or nothing to say (slack 0). */
export type ItemStatus =
  { kind: 'critical' } | { kind: 'slack'; minutes: number } | { kind: 'none' };

export interface PlanListItem {
  stepId: string;
  range: string;
  title: string;
  detail: string | null;
  dishName: string;
  lanes: string;
  duration: string;
  status: ItemStatus;
  warning: string | null;
}

export interface PlanListGroup {
  minute: number;
  heading: string;
  items: PlanListItem[];
}

/** The lanes a step holds in text: appliance lane first, then the cook; "Hands-free" if none. */
function lanesOf(s: ScheduledStep): string {
  const names: string[] = [];
  if (s.lanes.burner !== null) names.push(laneName('burner', s.lanes.burner));
  if (s.lanes.oven !== null) names.push(laneName('oven', s.lanes.oven));
  if (s.lanes.cook !== null) names.push(laneName('cook', s.lanes.cook));
  return names.length === 0 ? COPY.handsFree : names.join(', ');
}

/**
 * Every step once, ordered by start then id, grouped by start minute (R7.1, R7.2). `chosenMs`
 * is minute 0 of the axis; the serving instant is `clockAt(chosenMs, view.servingMin)`.
 */
export function planListGroups(
  view: ScheduleView,
  chosenMs: number,
  locale?: string,
): PlanListGroup[] {
  const servingMs = clockAt(chosenMs, view.servingMin);
  const sorted = [...view.steps].sort((a, b) => a.startMin - b.startMin || compareIds(a.id, b.id));
  // R7.4: one decision for the whole list, from the first start and the serving instant.
  const showDay = !sameLocalDate(clockAt(chosenMs, view.startMin), servingMs);
  const waits = new Map(view.warnings.map((w) => [w.stepId, w]));
  const groups: PlanListGroup[] = [];

  for (const s of sorted) {
    const step = view.stepById.get(s.id);
    if (step === undefined) continue;
    const startMs = clockAt(chosenMs, s.startMin);
    const status: ItemStatus = view.criticalPath.has(s.id)
      ? { kind: 'critical' }
      : s.slackMin > 0
        ? { kind: 'slack', minutes: s.slackMin }
        : { kind: 'none' };
    const warning = waits.get(s.id);
    const item: PlanListItem = {
      stepId: s.id,
      range: `${formatClock(startMs, locale)}–${formatClock(clockAt(chosenMs, s.endMin), locale)}`,
      title: step.title,
      detail: step.detail ?? null,
      dishName: view.dishName.get(step.dish) ?? step.dish,
      lanes: lanesOf(s),
      duration: formatDuration(step.minutes),
      status,
      warning: warning === undefined ? null : listWait(warning.waitMin, warning.holdMin),
    };
    const last = groups[groups.length - 1];
    if (last !== undefined && last.minute === s.startMin) {
      last.items.push(item);
    } else {
      const clock = formatClock(startMs, locale);
      const heading = showDay ? `${formatWeekday(startMs, locale)} ${clock}` : clock;
      groups.push({ minute: s.startMin, heading, items: [item] });
    }
  }
  return groups;
}
