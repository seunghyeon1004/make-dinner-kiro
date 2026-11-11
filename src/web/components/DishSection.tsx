import type { VNode } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Plan } from '../../core/index.js';
import { EDIT_ERRORS, MANAGE_COPY, removeDishAsk } from '../copy.js';
import { useDispatch } from '../state/hooks.js';
import { dependentsOf } from '../state/plan-edit.js';
import { ConfirmInline } from './ConfirmInline.js';
import { DishNameForm } from './DishNameForm.js';
import { IssueList } from './IssueList.js';
import type { IssuePlacement } from './issue-placement.js';
import { StepCard } from './StepCard.js';

interface Props {
  plan: Plan;
  dishIndex: number;
  /** Step indices in screen order. */
  order: readonly number[];
  placement: IssuePlacement;
  /** Index of the step whose editor is open, if any. */
  editing: number | null;
  readOnly: boolean;
  onEdit: (index: number | null) => void;
}

/** Puts focus on `id` after the render that follows the current dispatch. */
function focusAfterRender(id: string): void {
  queueMicrotask(() => document.getElementById(id)?.focus());
}

/** A dish: its name, its own issues, then its steps in dependency order (R4.1, R4.6). */
export function DishSection(props: Props): VNode | null {
  const { plan, placement } = props;
  const dispatch = useDispatch();
  const reasonId = useId();
  const renameButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  const wasConfirming = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Closing the form or the question returns focus to the button that opened it.
  useEffect(() => {
    if (wasRenaming.current && !renaming) renameButton.current?.focus();
    wasRenaming.current = renaming;
  }, [renaming]);
  useEffect(() => {
    if (wasConfirming.current && !confirming) removeButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const dish = plan.dishes[props.dishIndex];
  if (dish === undefined) return null;
  const headingId = `dish-${props.dishIndex}-heading`;
  const stepIds = plan.steps.filter((s) => s.dish === dish.id).map((s) => s.id);
  const lastDish = plan.dishes.length === 1;
  const lastStep = stepIds.length === plan.steps.length;
  const removeReason = lastDish ? EDIT_ERRORS.last_dish : lastStep ? EDIT_ERRORS.last_step : null;
  const stepsFull = plan.steps.length >= 80;

  return (
    <section class="dish" aria-labelledby={headingId}>
      <h2 id={headingId} tabIndex={-1}>
        {dish.name}
      </h2>
      <IssueList items={placement.byDish.get(dish.id) ?? []} />
      {!props.readOnly && renaming && (
        <DishNameForm
          initial={dish.name}
          submitLabel={MANAGE_COPY.saveName}
          onSubmit={(name) => {
            dispatch({ type: 'dish/rename', index: props.dishIndex, name });
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      )}
      {!props.readOnly && confirming && (
        <ConfirmInline
          text={removeDishAsk(
            dish.name,
            stepIds.length,
            dependentsOf(plan, stepIds).map((i) => plan.steps[i]?.title ?? ''),
          )}
          confirmLabel={MANAGE_COPY.removeDish}
          cancelLabel={MANAGE_COPY.keepDish}
          onConfirm={() => {
            props.onEdit(null);
            dispatch({ type: 'dish/remove', index: props.dishIndex });
            focusAfterRender('issues-heading');
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {!props.readOnly && !renaming && !confirming && (
        <div class="actions">
          <button type="button" class="button" ref={renameButton} onClick={() => setRenaming(true)}>
            {MANAGE_COPY.renameDish}
            <span class="visually-hidden"> {dish.name}</span>
          </button>
          <button
            type="button"
            class="button"
            ref={removeButton}
            disabled={removeReason !== null}
            aria-describedby={removeReason === null ? undefined : reasonId}
            onClick={() => setConfirming(true)}
          >
            {MANAGE_COPY.removeDish}
            <span class="visually-hidden"> {dish.name}</span>
          </button>
        </div>
      )}
      {!props.readOnly && removeReason !== null && (
        <p id={reasonId} class="muted">
          {removeReason}
        </p>
      )}
      <ol class="card-list step-list">
        {props.order.map((index) => {
          const step = plan.steps[index];
          if (step === undefined || step.dish !== dish.id) return null;
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
                focusAfterRender(headingId);
              }}
            />
          );
        })}
      </ol>
      {!props.readOnly && (
        <div class="actions">
          <button
            type="button"
            class="button"
            disabled={stepsFull}
            aria-describedby={stepsFull ? `${reasonId}-steps` : undefined}
            onClick={() => {
              dispatch({ type: 'step/add', dishIndex: props.dishIndex });
              props.onEdit(plan.steps.length);
            }}
          >
            {MANAGE_COPY.addStep}
            <span class="visually-hidden"> {dish.name}</span>
          </button>
        </div>
      )}
      {!props.readOnly && stepsFull && (
        <p id={`${reasonId}-steps`} class="muted">
          {EDIT_ERRORS.too_many_steps}
        </p>
      )}
    </section>
  );
}
