import type { VNode } from 'preact';
import { COOK_COPY, cookFirst, cookStartNow, cookStartsAt } from '../copy.js';
import { formatClock, MINUTE_MS } from '../state/clock.js';
import type { CookView } from '../state/cook-view.js';
import { Countdown } from './Countdown.js';

/** Before the first step: the time to the start, the first steps, and "Start now" (CM1.2, CM1.3). */
export function CookCountdown(props: {
  view: CookView;
  shiftMin: number;
  onStartNow: () => void;
}): VNode {
  const { view, shiftMin } = props;
  const first = view.upNext
    .filter((item) => item.startMs === view.startMs)
    .slice(0, 2)
    .map((item) => ({ title: item.title, dish: item.dishName }));
  const newServing = formatClock(view.servingMs - shiftMin * MINUTE_MS);
  return (
    <section class="cook-countdown" aria-labelledby="cook-countdown-heading">
      <h2 id="cook-countdown-heading">{cookStartsAt(formatClock(view.startMs))}</h2>
      <Countdown remainingMs={view.startMs - view.nowMs} label={COOK_COPY.countdownLabel} />
      {first.length > 0 && <p>{cookFirst(first)}</p>}
      <p>{cookStartNow(newServing, shiftMin)}</p>
      <button type="button" class="button button--primary button--cook" onClick={props.onStartNow}>
        {COOK_COPY.startNow}
      </button>
    </section>
  );
}
