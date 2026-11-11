import type { VNode } from 'preact';
import { COOK_COPY, cookDue, cookLate, cookReady, cookWaitsFor } from '../copy.js';
import { formatClock, MINUTE_MS } from '../state/clock.js';
import type { CardStep } from '../state/cook-view.js';
import { Countdown } from './Countdown.js';

/** The id of the primary button of a step: `focusAfter` points at it (CM9.3). */
export function actionId(stepId: string, action: 'start' | 'done'): string {
  return `act-${stepId}-${action}`;
}

/** The words of a card's second line: when it is due, or when a running step is ready. */
function metaOf(card: CardStep, nowMs: number): string {
  if (card.state === 'running' && card.endsAtMs !== null) {
    return cookReady(card.dishName, formatClock(card.endsAtMs));
  }
  const since = nowMs - card.plannedStartMs >= MINUTE_MS;
  return cookDue(card.dishName, card.minutes, formatClock(card.plannedStartMs), since);
}

/**
 * What every step card shows: title (large), detail, dish, duration and time, the prerequisites
 * not done, and the countdown of a running step (CM2.3). The action button is the caller's.
 */
export function StepCardBody(props: { card: CardStep; nowMs: number }): VNode {
  const { card, nowMs } = props;
  return (
    <>
      <h3 id={`card-${card.stepId}`} tabIndex={-1} class="cook-card__title">
        {card.title}
      </h3>
      {card.detail !== null && <p class="cook-card__detail">{card.detail}</p>}
      <p class="cook-card__meta muted mono">{metaOf(card, nowMs)}</p>
      {card.waitsFor.length > 0 && (
        <p class="cook-card__warn">
          <span aria-hidden="true">!</span> {cookWaitsFor(card.waitsFor)}
        </p>
      )}
      {card.lateByMin !== null && (
        <p class="cook-card__warn">
          <span aria-hidden="true">!</span> {cookLate(card.lateByMin)}
        </p>
      )}
      {card.remainingMs !== null && (
        <Countdown remainingMs={card.remainingMs} label={COOK_COPY.timeLeft} />
      )}
    </>
  );
}

/** The Start or Done button of a card. Its name carries the step title, which the dock shows beside it. */
export function StepButton(props: {
  card: CardStep;
  onStart: (stepId: string) => void;
  onDone: (stepId: string) => void;
}): VNode {
  const { card } = props;
  const action = card.state === 'due' ? 'start' : 'done';
  return (
    <button
      type="button"
      id={actionId(card.stepId, action)}
      class="button button--primary button--cook"
      onClick={() => (action === 'start' ? props.onStart(card.stepId) : props.onDone(card.stepId))}
    >
      {action === 'start' ? COOK_COPY.start : COOK_COPY.done}
      <span class="visually-hidden"> {card.title}</span>
    </button>
  );
}
