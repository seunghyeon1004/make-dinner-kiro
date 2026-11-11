import type { VNode } from 'preact';
import { pastStart, serveAt, serveAtButton, startAt, takes } from '../copy.js';
import {
  clockAt,
  earliestServing,
  formatClock,
  formatDay,
  formatDuration,
} from '../state/clock.js';
import { useDispatch } from '../state/hooks.js';
import type { ScheduleView } from '../state/schedule-view.js';

/** Start time, serving time (with the day when not today) and span (R5.4). */
export function PlanSummary(props: { view: ScheduleView; chosenMs: number; nowMs: number }): VNode {
  const { view, chosenMs, nowMs } = props;
  const dispatch = useDispatch();
  const servingMs = clockAt(chosenMs, view.servingMin);
  const startMs = clockAt(chosenMs, view.startMin);
  const earliestMs = earliestServing(nowMs, view.spanMin);
  return (
    <div class="summary">
      <p class="summary__start">{startAt(formatClock(startMs))}</p>
      <p>{serveAt(formatClock(servingMs), formatDay(servingMs, nowMs))}</p>
      <p>{takes(formatDuration(view.spanMin))}</p>
      {startMs < nowMs && (
        <div class="summary__past">
          <p>{pastStart(formatDuration(view.spanMin), formatClock(earliestMs))}</p>
          <button
            type="button"
            class="button button--primary"
            onClick={() => dispatch({ type: 'serving/set-instant', atMs: earliestMs })}
          >
            {serveAtButton(formatClock(earliestMs))}
          </button>
        </div>
      )}
    </div>
  );
}
