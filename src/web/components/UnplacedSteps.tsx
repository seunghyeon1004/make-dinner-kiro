import type { VNode } from 'preact';
import type { Plan } from '../../core/index.js';
import { STEPS_COPY } from '../copy.js';
import { useDispatch } from '../state/hooks.js';
import { StepCard } from './StepCard.js';
import type { IssuePlacement } from './issue-placement.js';

interface Props {
  plan: Plan;
  /** Step indices in screen order. */
  order: readonly number[];
  placement: IssuePlacement;
  editing: number | null;
  readOnly: boolean;
  onEdit: (index: number | null) => void;
}

/**
 * Steps whose `dish` matches no dish of the plan (an imported Dinnerfile can have them).
 * They get a section of their own so that their `unknown_dish` error can be fixed by
 * picking a dish. Nothing is shown when every step has a dish.
 */
export function UnplacedSteps(props: Props): VNode | null {
  const { plan, placement } = props;
  const dispatch = useDispatch();
  const known = new Set(plan.dishes.map((dish) => dish.id));
  const indices = props.order.filter((index) => {
    const step = plan.steps[index];
    return step !== undefined && !known.has(step.dish);
  });
  if (indices.length === 0) return null;
  return (
    <section class="dish" aria-labelledby="no-dish-heading">
      <h2 id="no-dish-heading" tabIndex={-1}>
        {STEPS_COPY.noDishHeading}
      </h2>
      <p class="muted">{STEPS_COPY.noDishHint}</p>
      <ol class="card-list step-list">
        {indices.map((index) => {
          const step = plan.steps[index];
          if (step === undefined) return null;
          return (
            <StepCard
              key={index}
              plan={plan}
              step={step}
              index={index}
              issues={placement.byStep.get(index) ?? []}
              editing={props.editing === index}
              readOnly={props.readOnly}
              onEdit={() => props.onEdit(index)}
              onDone={() => props.onEdit(null)}
              onRemove={() => {
                props.onEdit(null);
                dispatch({ type: 'step/remove', index });
                queueMicrotask(() => document.getElementById('issues-heading')?.focus());
              }}
            />
          );
        })}
      </ol>
    </section>
  );
}
