import type { VNode } from 'preact';
import { useId } from 'preact/hooks';
import type { Plan } from '../../core/index.js';
import { EDITOR_COPY } from '../copy.js';
import { stepOrder, waitingOn } from '../state/plan-edit.js';

interface Props {
  plan: Plan;
  /** Index of the step being edited. */
  index: number;
  onChange: (after: string[]) => void;
}

interface Option {
  id: string;
  label: string;
  suffix: string | null;
  checked: boolean;
  disabled: boolean;
}

/** The options of the checklist: other steps (same dish first), then ids that are not steps (R4.3, R4.5). */
function optionsOf(plan: Plan, index: number): Option[] {
  const step = plan.steps[index];
  if (step === undefined) return [];
  const later = waitingOn(plan, step.id);
  const order = stepOrder(plan).filter((i) => i !== index);
  const sameDish = order.filter((i) => plan.steps[i]?.dish === step.dish);
  const others = plan.dishes
    .filter((d) => d.id !== step.dish)
    .flatMap((d) => order.filter((i) => plan.steps[i]?.dish === d.id));
  const options: Option[] = [];
  const seen = new Set<string>();
  for (const i of [...sameDish, ...others]) {
    const other = plan.steps[i];
    if (other === undefined || other.id === step.id || seen.has(other.id)) continue;
    seen.add(other.id);
    const checked = step.after.includes(other.id);
    // A step that already waits for this one would make a cycle, unless it is checked and
    // the cook needs to be able to clear it.
    const disabled = later.has(other.id) && !checked;
    options.push({
      id: other.id,
      label: other.title,
      suffix: disabled ? EDITOR_COPY.alreadyWaits : null,
      checked,
      disabled,
    });
  }
  const stepIds = new Set(plan.steps.map((s) => s.id));
  for (const id of new Set(step.after)) {
    if (id === step.id) {
      options.push({ id, label: id, suffix: EDITOR_COPY.thisStep, checked: true, disabled: false });
    } else if (!stepIds.has(id)) {
      options.push({ id, label: id, suffix: EDITOR_COPY.notAStep, checked: true, disabled: false });
    }
  }
  return options;
}

/** "Waits for": a checklist of the other steps; options that would make a cycle are disabled. */
export function PrerequisiteChecklist(props: Props): VNode | null {
  const step = props.plan.steps[props.index];
  const name = useId();
  if (step === undefined) return null;
  const toggle = (id: string, checked: boolean): void => {
    props.onChange(
      checked ? [...step.after.filter((a) => a !== id), id] : step.after.filter((a) => a !== id),
    );
  };
  return (
    <fieldset class="checklist">
      <legend>{EDITOR_COPY.waitsFor}</legend>
      {optionsOf(props.plan, props.index).map((option) => (
        <label key={option.id} class={`check${option.disabled ? ' check--off' : ''}`}>
          <input
            type="checkbox"
            name={name}
            checked={option.checked}
            disabled={option.disabled}
            onChange={(event) => toggle(option.id, event.currentTarget.checked)}
          />
          <span>{option.suffix === null ? option.label : `${option.label} ${option.suffix}`}</span>
        </label>
      ))}
    </fieldset>
  );
}
