import type { VNode } from 'preact';
import { COOK_COPY } from '../copy.js';
import type { CardStep } from '../state/cook-view.js';
import { StepButton, StepCardBody } from './StepCardBody.js';

/** A due hands-free step: start it, then leave it (CM2.4). Dashed border: hands-free (ui.md). */
export function StartCard(props: {
  card: CardStep;
  nowMs: number;
  dockStepId: string | null;
  onStart: (stepId: string) => void;
  onDone: (stepId: string) => void;
}): VNode {
  const { card } = props;
  return (
    <section class="cook-card cook-card--hands-free" aria-labelledby={`card-${card.stepId}`}>
      <p class="cook-card__label">{COOK_COPY.startThenLeave}</p>
      <StepCardBody card={card} nowMs={props.nowMs} />
      {card.stepId !== props.dockStepId && (
        <StepButton card={card} onStart={props.onStart} onDone={props.onDone} />
      )}
    </section>
  );
}
