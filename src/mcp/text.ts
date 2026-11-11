import { compareIds } from '../core/index.js';
import type { Schedule, ScheduledStep } from '../core/index.js';

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function laneText(lanes: ScheduledStep['lanes']): string {
  const parts: string[] = [];
  if (lanes.burner !== null) parts.push(`Burner ${lanes.burner}`);
  if (lanes.oven !== null) parts.push(`Oven ${lanes.oven}`);
  if (lanes.cook !== null) parts.push(`Cook ${lanes.cook}`);
  return parts.length === 0 ? 'no lane' : parts.join(', ');
}

/** The plan list of a schedule: header, one line per step by start then id, then warnings. */
export function planList(schedule: Schedule): string {
  const { plan, kitchen } = schedule;
  const lines = [
    `${plan.title}: ${count(plan.dishes.length, 'dish', 'dishes')}, ${count(plan.steps.length, 'step', 'steps')}. ` +
      `Kitchen: ${count(kitchen.burners, 'burner', 'burners')}, ${count(kitchen.ovens, 'oven', 'ovens')}, ${count(kitchen.cooks, 'cook', 'cooks')}.`,
    `Span ${schedule.spanMin} min, longest chain ${schedule.chainMin} min. Minute 0 is serving; earlier minutes are negative.`,
  ];
  const ordered = [...schedule.steps].sort(
    (a, b) => a.startMin - b.startMin || compareIds(a.id, b.id),
  );
  for (const s of ordered) {
    const step = plan.steps.find((p) => p.id === s.id);
    const keeps = step?.holdMin === null;
    const mark = s.slackMin === 0 ? (keeps ? 'No slack' : 'Critical') : `slack ${s.slackMin} min`;
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
