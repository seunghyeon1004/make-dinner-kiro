import type { VNode } from 'preact';
import { COOK_COPY, cookNext, laneName } from '../copy.js';
import { formatClock, MINUTE_MS } from '../state/clock.js';
import type { LaneCard as LaneCardData } from '../state/cook-view.js';
import { ExtraTime } from './ExtraTime.js';
import { StepButton, StepCardBody } from './StepCardBody.js';

interface Props {
  lane: LaneCardData;
  /** The label "Cook 2" is shown only when the kitchen has several cooks. */
  labelled: boolean;
  nowMs: number;
  /** The step whose button is in the dock, so its card has none. */
  dockStepId: string | null;
  onStart: (stepId: string) => void;
  onDone: (stepId: string) => void;
  onExtra: (stepId: string, minutes: 5 | 10 | 15) => void;
}

/** One cook lane: what that cook is doing or should do next, and any further due steps (CM2.2). */
export function LaneCard(props: Props): VNode {
  const { lane, nowMs } = props;
  const label = props.labelled ? laneName('cook', lane.cookLane) : null;
  const { current } = lane;
  return (
    <section
      class="cook-card"
      aria-labelledby={current === null ? `card-lane-${lane.cookLane}` : `card-${current.stepId}`}
    >
      {label !== null && <p class="cook-card__label mono">{label}</p>}
      {current === null ? (
        <>
          <h3 id={`card-lane-${lane.cookLane}`} tabIndex={-1} class="cook-card__title">
            {COOK_COPY.nothingToDo}
          </h3>
          <p class="cook-card__meta muted">
            {lane.next === null
              ? COOK_COPY.nothingMore
              : cookNext(
                  lane.next.title,
                  formatClock(lane.next.startMs),
                  Math.ceil((lane.next.startMs - nowMs) / MINUTE_MS),
                )}
          </p>
        </>
      ) : (
        <>
          <StepCardBody card={current} nowMs={nowMs} />
          {current.state === 'running' && (
            <ExtraTime stepId={current.stepId} title={current.title} onExtra={props.onExtra} />
          )}
          {current.stepId !== props.dockStepId && (
            <StepButton card={current} onStart={props.onStart} onDone={props.onDone} />
          )}
        </>
      )}
      {lane.also.length > 0 && (
        <div class="cook-card__also">
          <h4 class="cook-card__also-heading">{COOK_COPY.alsoDue}</h4>
          {lane.also.map((card) => (
            <div class="cook-card__also-item" key={card.stepId}>
              <StepCardBody card={card} nowMs={nowMs} />
              {card.state === 'running' && (
                <ExtraTime stepId={card.stepId} title={card.title} onExtra={props.onExtra} />
              )}
              <StepButton card={card} onStart={props.onStart} onDone={props.onDone} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
