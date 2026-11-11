import type { VNode } from 'preact';
import { COOK_COPY } from '../copy.js';
import type { CardStep } from '../state/cook-view.js';
import { ExtraTime } from './ExtraTime.js';
import { StepButton, StepCardBody } from './StepCardBody.js';

/** A hands-free step in progress: its countdown, "Time is up" once over, and more time (CM2.5). */
export function RunningCard(props: {
  card: CardStep;
  nowMs: number;
  dockStepId: string | null;
  onStart: (stepId: string) => void;
  onDone: (stepId: string) => void;
  onExtra: (stepId: string, minutes: 5 | 10 | 15) => void;
}): VNode {
  const { card } = props;
  const over = card.remainingMs !== null && card.remainingMs <= 0;
  return (
    <section class="cook-card cook-card--hands-free" aria-labelledby={`card-${card.stepId}`}>
      <StepCardBody card={card} nowMs={props.nowMs} />
      {over && (
        <p class="cook-card__warn">
          <span aria-hidden="true">!</span> {COOK_COPY.timeIsUp}
        </p>
      )}
      <ExtraTime stepId={card.stepId} title={card.title} onExtra={props.onExtra} />
      {card.stepId !== props.dockStepId && (
        <StepButton card={card} onStart={props.onStart} onDone={props.onDone} />
      )}
    </section>
  );
}
