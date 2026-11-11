import type { VNode } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { Appliance, Plan } from '../../core/index.js';
import { EDITOR_COPY, STEPS_COPY } from '../copy.js';
import { useDispatch } from '../state/hooks.js';
import { DEFAULT_HOLD_MIN } from '../state/plan-edit.js';
import type { StepPatch } from '../state/plan-edit.js';
import { PrerequisiteChecklist } from './PrerequisiteChecklist.js';

interface Props {
  plan: Plan;
  index: number;
  onDone: () => void;
}

/** Parses whole minutes in a range; null when the text is not that. */
function wholeMinutes(text: string, min: number, max: number): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
}

/**
 * Edits one step. Field text is local; a value goes to the store only when it would pass
 * `StepSchema`, so the stored plan stays valid and a bad value keeps what was typed (R4.4).
 */
export function StepEditor(props: Props): VNode | null {
  const step = props.plan.steps[props.index];
  const dispatch = useDispatch();
  const ids = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(step?.title ?? '');
  const [minutes, setMinutes] = useState(String(step?.minutes ?? ''));
  const [hold, setHold] = useState(String(step?.holdMin ?? DEFAULT_HOLD_MIN));
  const [titleError, setTitleError] = useState(false);
  const [minutesError, setMinutesError] = useState(false);
  const [holdError, setHoldError] = useState(false);

  useEffect(() => {
    titleInput.current?.focus();
  }, []);

  if (step === undefined) return null;
  const update = (patch: StepPatch): void =>
    dispatch({ type: 'step/update', index: props.index, patch });
  const keeps = step.holdMin === null;

  return (
    <div class="step-editor">
      <div class="field">
        <label for={`${ids}-title`}>{EDITOR_COPY.title}</label>
        <input
          id={`${ids}-title`}
          ref={titleInput}
          class="input"
          type="text"
          value={title}
          aria-invalid={titleError}
          aria-describedby={titleError ? `${ids}-title-error` : undefined}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setTitle(value);
            const valid = value.trim() !== '';
            setTitleError(!valid);
            if (valid) update({ title: value.trim() });
          }}
        />
        {titleError && (
          <p id={`${ids}-title-error`} class="field-error">
            {EDITOR_COPY.titleError}
          </p>
        )}
      </div>

      <div class="field">
        <label for={`${ids}-minutes`}>{EDITOR_COPY.minutes}</label>
        <input
          id={`${ids}-minutes`}
          class="input input--mono"
          type="text"
          inputMode="numeric"
          value={minutes}
          aria-invalid={minutesError}
          aria-describedby={minutesError ? `${ids}-minutes-error` : undefined}
          onInput={(event) => {
            const text = event.currentTarget.value;
            setMinutes(text);
            const value = wholeMinutes(text, 1, 480);
            setMinutesError(value === null);
            if (value !== null) update({ minutes: value });
          }}
        />
        {minutesError && (
          <p id={`${ids}-minutes-error`} class="field-error">
            {EDITOR_COPY.minutesError}
          </p>
        )}
      </div>

      <div class="field">
        <label for={`${ids}-appliance`}>{EDITOR_COPY.appliance}</label>
        <select
          id={`${ids}-appliance`}
          class="input"
          value={step.appliance}
          onChange={(event) => update({ appliance: event.currentTarget.value as Appliance })}
        >
          <option value="burner">{STEPS_COPY.burner}</option>
          <option value="oven">{STEPS_COPY.oven}</option>
          <option value="none">{STEPS_COPY.noAppliance}</option>
        </select>
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={step.handsOn}
          onChange={(event) => update({ handsOn: event.currentTarget.checked })}
        />
        <span>{EDITOR_COPY.handsOn}</span>
      </label>

      <div class="field">
        <label for={`${ids}-dish`}>{EDITOR_COPY.dish}</label>
        <select
          id={`${ids}-dish`}
          class="input"
          value={step.dish}
          onChange={(event) => update({ dish: event.currentTarget.value })}
        >
          {!props.plan.dishes.some((dish) => dish.id === step.dish) && (
            <option value={step.dish} disabled>
              {step.dish} {EDITOR_COPY.notADish}
            </option>
          )}
          {props.plan.dishes.map((dish) => (
            <option key={dish.id} value={dish.id}>
              {dish.name}
            </option>
          ))}
        </select>
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={keeps}
          onChange={(event) => {
            setHoldError(false);
            if (event.currentTarget.checked) update({ holdMin: null });
            else {
              setHold(String(DEFAULT_HOLD_MIN));
              update({ holdMin: DEFAULT_HOLD_MIN });
            }
          }}
        />
        <span>{EDITOR_COPY.keeps}</span>
      </label>

      {!keeps && (
        <div class="field">
          <label for={`${ids}-hold`}>{EDITOR_COPY.canWaitUpTo}</label>
          <input
            id={`${ids}-hold`}
            class="input input--mono"
            type="text"
            inputMode="numeric"
            value={hold}
            aria-invalid={holdError}
            aria-describedby={holdError ? `${ids}-hold-error` : undefined}
            onInput={(event) => {
              const text = event.currentTarget.value;
              setHold(text);
              const value = wholeMinutes(text, 0, 480);
              setHoldError(value === null);
              if (value !== null) update({ holdMin: value });
            }}
          />
          {holdError && (
            <p id={`${ids}-hold-error`} class="field-error">
              {EDITOR_COPY.holdError}
            </p>
          )}
        </div>
      )}

      <PrerequisiteChecklist
        plan={props.plan}
        index={props.index}
        onChange={(after) => update({ after })}
      />

      <div class="actions">
        <button type="button" class="button" onClick={props.onDone}>
          {EDITOR_COPY.doneEditing}
        </button>
      </div>
    </div>
  );
}
