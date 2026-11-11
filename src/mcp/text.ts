import { compareIds } from '../core/index.js';
import type {
  Issue,
  Kitchen,
  Plan,
  Progress,
  Rebuilt,
  Schedule,
  ScheduledStep,
} from '../core/index.js';
import type { SampleDetail, SampleSummary } from './samples.js';

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const kitchenText = (k: Kitchen): string =>
  `${count(k.burners, 'burner', 'burners')}, ${count(k.ovens, 'oven', 'ovens')}, ${count(k.cooks, 'cook', 'cooks')}`;

function laneText(lanes: ScheduledStep['lanes']): string {
  const parts: string[] = [];
  if (lanes.burner !== null) parts.push(`Burner ${lanes.burner}`);
  if (lanes.oven !== null) parts.push(`Oven ${lanes.oven}`);
  if (lanes.cook !== null) parts.push(`Cook ${lanes.cook}`);
  return parts.length === 0 ? 'no lane' : parts.join(', ');
}

/** `<severity> <code> <stepId or dishId or "plan">: <message>` */
export function issueLine(i: Issue): string {
  const where =
    ('stepId' in i && i.stepId !== undefined ? i.stepId : undefined) ??
    ('dishId' in i && i.dishId !== undefined ? i.dishId : undefined) ??
    'plan';
  return `${i.severity} ${i.code} ${where}: ${i.message}`;
}

/**
 * The plan list of a schedule: header, one line per step by start then id, then warnings.
 * `pinned` (a rebuild's done and running steps) replaces the slack mark with the state.
 */
export function planList(
  schedule: Schedule,
  pinned: Readonly<Record<string, 'done' | 'running'>> = {},
): string {
  const { plan, kitchen } = schedule;
  const lines = [
    `${plan.title}: ${count(plan.dishes.length, 'dish', 'dishes')}, ${count(plan.steps.length, 'step', 'steps')}. ` +
      `Kitchen: ${kitchenText(kitchen)}.`,
    `Span ${schedule.spanMin} min, longest chain ${schedule.chainMin} min. Minute 0 is serving; earlier minutes are negative.`,
  ];
  const ordered = [...schedule.steps].sort(
    (a, b) => a.startMin - b.startMin || compareIds(a.id, b.id),
  );
  for (const s of ordered) {
    const step = plan.steps.find((p) => p.id === s.id);
    const keeps = step?.holdMin === null;
    const state = pinned[s.id];
    const mark =
      state !== undefined
        ? state
        : s.slackMin === 0
          ? keeps
            ? 'No slack'
            : 'Critical'
          : `slack ${s.slackMin} min`;
    let line = `${s.startMin} to ${s.endMin}  ${s.id}  ${step?.title ?? s.id}  ${laneText(s.lanes)}  ${mark}`;
    if (step?.holdMin != null && s.waitMin !== null && s.waitMin > step.holdMin) {
      line += `, waits ${s.waitMin} min (hold ${step.holdMin} min)`;
    }
    lines.push(line);
  }
  if (schedule.warnings.length === 0) lines.push('Warnings: none.');
  for (const w of schedule.warnings) lines.push(`Warning: ${w.message}`);
  return lines.join('\n');
}

/** Serving line, moved line, then the plan list with pinned steps marked. */
export function rebuildText(rebuilt: Rebuilt, progress: Progress): string {
  const { schedule, diff } = rebuilt;
  const serving =
    diff.servingShiftMin > 0
      ? `Serving moves ${diff.servingShiftMin} min later, to minute ${schedule.servingMin}.`
      : `Serving stays at minute ${schedule.servingMin}.`;
  const moved =
    diff.moved.length === 0
      ? 'Moved: none.'
      : `Moved: ${diff.moved
          .toSorted((a, b) => compareIds(a.stepId, b.stepId))
          .map((m) => `${m.stepId} ${m.fromStartMin} to ${m.toStartMin}`)
          .join(', ')}.`;
  const pinned: Record<string, 'done' | 'running'> = {};
  for (const [id, entry] of Object.entries(progress)) pinned[id] = entry.state;
  return [serving, moved, planList(schedule, pinned)].join('\n');
}

export function exportText(plan: Plan, dinnerfile: string): string {
  return `Dinnerfile for "${plan.title}" (${plan.steps.length} steps). Check it with make -n -f Dinnerfile dinner.\n\n${dinnerfile}`;
}

export function importText(plan: Plan, issues: readonly Issue[]): string {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const head =
    `Imported "${plan.title}": ${count(plan.dishes.length, 'dish', 'dishes')}, ` +
    `${count(plan.steps.length, 'step', 'steps')}, ${count(errors, 'error', 'errors')}, ` +
    `${count(issues.length - errors, 'warning', 'warnings')}.`;
  return [head, ...issues.map(issueLine)].join('\n');
}

export function listSamplesText(samples: readonly SampleSummary[]): string {
  return samples
    .map(
      (s) =>
        `${s.id}: ${s.title} (${s.dishes.join('; ')}). Kitchen: ${kitchenText(s.kitchen)}. Serving ${s.servingTime}.`,
    )
    .join('\n');
}

export function getSampleText(s: SampleDetail): string {
  return (
    `${s.title} (${s.id}): ${count(s.dishes.length, 'dish', 'dishes')}, ` +
    `${count(s.plan.steps.length, 'step', 'steps')}. Suggested kitchen: ${kitchenText(s.kitchen)}. ` +
    `Serving ${s.servingTime}.`
  );
}
