import { compareIds } from '../../core/index.js';
import type { ScheduledStep } from '../../core/index.js';
import { COPY, laneName, serveLabel } from '../copy.js';
import { clockAt, formatClock, formatWeekday, quarterCeil, quarterFloor } from '../state/clock.js';
import type { ScheduleView } from '../state/schedule-view.js';

export const PX_PER_MIN = 6; // a step of 8 minutes is a 48 px target (decided here)
export const LABEL_MIN_PX = 56; // shorter bars carry no label

export type RowKind = 'cook' | 'burner' | 'oven' | 'hands-free';
export type BarFill = 'oven' | 'burner' | 'plain';

export interface TimelineBar {
  stepId: string;
  title: string;
  leftPx: number;
  widthPx: number;
  fill: BarFill;
  dashed: boolean;
  showLabel: boolean;
  /** The mark ▲ is drawn only for `critical`. */
  critical: boolean;
}

export interface TimelineRow {
  key: string;
  kind: RowKind;
  lane: number;
  label: string;
  bars: TimelineBar[];
}

export interface TimelineTick {
  minute: number;
  leftPx: number;
  label: string;
}

export interface TimelineLayout {
  originMin: number;
  endMin: number;
  widthPx: number;
  rows: TimelineRow[];
  ticks: TimelineTick[];
  serveLeftPx: number;
  serveLabel: string;
}

/** Width of one monospace character at the 18 px base size (0.6 em), for tick label spans. */
export const TICK_CHAR_PX = 10.8;
/** A tick's left rule and padding, added to its label. */
export const TICK_PAD_PX = 5;

/**
 * Drops tick labels that would overlap (review C). The serve label is right-aligned at
 * `serveLeftPx` and wins: a tick at or after the serve line, or whose label would reach the
 * serve label, goes. Among the rest, left to right, a tick that would start before the
 * previous kept label ends goes. Widths are estimated from the character count, because this
 * module has no DOM.
 */
export function thinTicks(
  ticks: readonly TimelineTick[],
  serveLeftPx: number,
  serveLabelText: string,
): TimelineTick[] {
  const serveStart = serveLeftPx - serveLabelText.length * TICK_CHAR_PX;
  const kept: TimelineTick[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const tick of ticks) {
    if (tick.leftPx >= serveLeftPx) continue;
    const end = tick.leftPx + tick.label.length * TICK_CHAR_PX + TICK_PAD_PX;
    if (end > serveStart || tick.leftPx < previousEnd) continue;
    kept.push(tick);
    previousEnd = end;
  }
  return kept;
}

export function layoutTimeline(
  view: ScheduleView,
  chosenMs: number,
  locale?: string,
): TimelineLayout {
  const originMin = quarterFloor(chosenMs, view.startMin);
  const endMin = quarterCeil(chosenMs, view.servingMin);
  const x = (minute: number): number => (minute - originMin) * PX_PER_MIN;

  const ordered = [...view.steps].sort((a, b) => a.startMin - b.startMin || compareIds(a.id, b.id));

  const barOf = (s: ScheduledStep): TimelineBar | null => {
    const step = view.stepById.get(s.id);
    if (step === undefined) return null;
    const widthPx = (s.endMin - s.startMin) * PX_PER_MIN;
    return {
      stepId: s.id,
      title: step.title,
      leftPx: x(s.startMin),
      widthPx,
      fill: step.appliance === 'none' ? 'plain' : step.appliance,
      dashed: !step.handsOn,
      showLabel: widthPx >= LABEL_MIN_PX,
      critical: view.criticalPath.has(s.id),
    };
  };

  const rows: TimelineRow[] = [];
  const resources: readonly (readonly [RowKind & ('cook' | 'burner' | 'oven'), string])[] = [
    ['cook', 'Cook'],
    ['burner', 'Burner'],
    ['oven', 'Oven'],
  ];
  for (const [kind] of resources) {
    const byLane = new Map<number, TimelineBar[]>();
    for (const s of ordered) {
      const lane = s.lanes[kind];
      const b = lane === null ? null : barOf(s);
      if (lane === null || b === null) continue;
      byLane.set(lane, [...(byLane.get(lane) ?? []), b]);
    }
    for (const lane of [...byLane.keys()].sort((a, b) => a - b)) {
      rows.push({
        key: `${kind}-${lane}`,
        kind,
        lane,
        label: laneName(kind, lane),
        bars: byLane.get(lane) ?? [],
      });
    }
  }

  // Hands-free: no appliance and no cook. Each goes into the lowest row that is free at its start.
  const free: { end: number; bars: TimelineBar[] }[] = [];
  for (const s of ordered) {
    const step = view.stepById.get(s.id);
    if (step === undefined || step.appliance !== 'none' || step.handsOn) continue;
    const b = barOf(s);
    if (b === null) continue;
    const row = free.find((r) => r.end <= s.startMin);
    if (row === undefined) free.push({ end: s.endMin, bars: [b] });
    else {
      row.bars.push(b);
      row.end = s.endMin;
    }
  }
  for (const [index, row] of free.entries()) {
    rows.push({
      key: `hands-free-${index + 1}`,
      kind: 'hands-free',
      lane: index + 1,
      label: free.length === 1 ? COPY.handsFree : `${COPY.handsFree} ${index + 1}`,
      bars: row.bars,
    });
  }

  const ticks: TimelineTick[] = [];
  for (let minute = originMin; minute <= endMin; minute += 15) {
    const ms = clockAt(chosenMs, minute);
    const local = new Date(ms);
    const clock = formatClock(ms, locale);
    const midnight = local.getHours() === 0 && local.getMinutes() === 0;
    ticks.push({
      minute,
      leftPx: x(minute),
      label: midnight ? `${formatWeekday(ms, locale)} ${clock}` : clock,
    });
  }

  const serveLeftPx = x(view.servingMin);
  const serveText = serveLabel(formatClock(clockAt(chosenMs, view.servingMin), locale));
  return {
    originMin,
    endMin,
    widthPx: x(endMin),
    rows,
    ticks: thinTicks(ticks, serveLeftPx, serveText),
    serveLeftPx,
    serveLabel: serveText,
  };
}
