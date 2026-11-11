import type { VNode } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Plan, Step } from '../../core/index.js';
import {
  applianceLabel,
  EDIT_ERRORS,
  EDITOR_COPY,
  handsLabel,
  holdLabel,
  MANAGE_COPY,
  removeStepAsk,
  waitsFor,
} from '../copy.js';
import { formatDuration } from '../state/clock.js';
import { dependentsOf } from '../state/plan-edit.js';
import { ConfirmInline } from './ConfirmInline.js';
import { IssueList } from './IssueList.js';
import { StepEditor } from './StepEditor.js';
import type { PlacedIssue } from './issue-placement.js';

interface Props {
  plan: Plan;
  step: Step;
  issues: readonly PlacedIssue[];
  /** Index of the step in the plan. */
  index: number;
  editing: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onDone: () => void;
  /** Removes the step; the dish section moves focus afterwards. */
  onRemove: () => void;
}

/** A step as a summary: title, id, minutes, appliance, hands-on, hold, prerequisites (R4.2). */
export function StepCard(props: Props): VNode {
  const { plan, step } = props;
  const editButton = useRef<HTMLButtonElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const wasConfirming = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const reasonId = useId();
  const lastStep = plan.steps.length === 1;

  // Closing the editor or the question returns focus to the button that opened it.
  useEffect(() => {
    if (wasEditing.current && !props.editing) editButton.current?.focus();
    wasEditing.current = props.editing;
  }, [props.editing]);
  useEffect(() => {
    if (wasConfirming.current && !confirming) removeButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const titles = step.after.map((id) => plan.steps.find((s) => s.id === id)?.title ?? id);
  return (
    <li class="card step-card" data-step-id={step.id}>
      <h3>{step.title}</h3>
      <p class="mono muted step-card__id">{step.id}</p>
      <ul class="facts">
        <li class="mono">{formatDuration(step.minutes)}</li>
        <li>{applianceLabel(step.appliance)}</li>
        <li>{handsLabel(step.handsOn)}</li>
        <li>{holdLabel(step.holdMin)}</li>
      </ul>
      <p class="muted">{waitsFor(titles)}</p>
      <IssueList items={props.issues} />
      {props.editing && <StepEditor plan={plan} index={props.index} onDone={props.onDone} />}
      {!props.readOnly && confirming && (
        <ConfirmInline
          text={removeStepAsk(
            step.title,
            dependentsOf(plan, [step.id]).map((i) => plan.steps[i]?.title ?? ''),
          )}
          confirmLabel={MANAGE_COPY.removeStep}
          cancelLabel={MANAGE_COPY.keepStep}
          onConfirm={props.onRemove}
          onCancel={() => setConfirming(false)}
        />
      )}
      {!props.readOnly && !confirming && (
        <div class="actions">
          {!props.editing && (
            <button type="button" class="button" ref={editButton} onClick={props.onEdit}>
              {EDITOR_COPY.edit}
              <span class="visually-hidden"> {step.title}</span>
            </button>
          )}
          <button
            type="button"
            class="button"
            ref={removeButton}
            disabled={lastStep}
            aria-describedby={lastStep ? reasonId : undefined}
            onClick={() => setConfirming(true)}
          >
            {MANAGE_COPY.removeStep}
            <span class="visually-hidden"> {step.title}</span>
          </button>
        </div>
      )}
      {!props.readOnly && lastStep && (
        <p id={reasonId} class="muted">
          {EDIT_ERRORS.last_step}
        </p>
      )}
    </li>
  );
}
