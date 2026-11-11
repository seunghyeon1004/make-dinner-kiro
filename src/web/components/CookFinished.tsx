import type { VNode } from 'preact';
import { COOK_COPY, cookFinishedLine } from '../copy.js';
import { formatClock, MINUTE_MS } from '../state/clock.js';
import { hashOf } from '../state/route.js';
import { StartOver } from './StartOver.js';

/** Every terminal step is done: when dinner was served against when it was planned (CM8.1, CM8.2). */
export function CookFinished(props: { servedMs: number; plannedMs: number }): VNode {
  const lateMin = Math.round((props.servedMs - props.plannedMs) / MINUTE_MS);
  return (
    <section class="cook-finished" aria-labelledby="cook-finished-heading">
      <h2 id="cook-finished-heading" tabIndex={-1}>
        {COOK_COPY.finishedHeading}
      </h2>
      <p>{cookFinishedLine(formatClock(props.servedMs), formatClock(props.plannedMs), lateMin)}</p>
      <div class="actions">
        <a class="button button--primary button--cook" href={hashOf('plan')}>
          {COOK_COPY.backToPlan}
        </a>
        <StartOver />
      </div>
    </section>
  );
}
