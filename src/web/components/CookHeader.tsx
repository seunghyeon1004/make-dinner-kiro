import type { VNode } from 'preact';
import { cookPlannedFor, serveAt } from '../copy.js';
import { formatClock, formatDay } from '../state/clock.js';

/** The clock, the serving time, and the planned one when the session moved it (CM2.1). */
export function CookHeader(props: {
  nowMs: number;
  servingMs: number;
  plannedServingMs: number;
}): VNode {
  const { nowMs, servingMs, plannedServingMs } = props;
  return (
    <div class="cook-header">
      <p class="cook-header__clock mono">{formatClock(nowMs)}</p>
      <p class="cook-header__serving">
        <span class="mono">{serveAt(formatClock(servingMs), formatDay(servingMs, nowMs))}</span>
        {servingMs !== plannedServingMs && (
          <span class="cook-header__planned muted mono">
            {' '}
            {cookPlannedFor(formatClock(plannedServingMs))}
          </span>
        )}
      </p>
    </div>
  );
}
