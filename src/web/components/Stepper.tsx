import type { VNode } from 'preact';
import { fewer, more } from '../copy.js';

interface Props {
  /** The visible label and the group name: "Burners". */
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

/** A count with "−" and "+" buttons, disabled at the bounds (R5.1). */
export function Stepper(props: Props): VNode {
  const id = `stepper-${props.label.toLowerCase()}`;
  return (
    <div class="stepper" role="group" aria-labelledby={id}>
      <span id={id} class="stepper__label">
        {props.label}
      </span>
      <button
        type="button"
        class="button stepper__button"
        aria-label={fewer(props.label)}
        disabled={props.value <= props.min}
        onClick={() => props.onChange(props.value - 1)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <output class="stepper__value">{props.value}</output>
      <button
        type="button"
        class="button stepper__button"
        aria-label={more(props.label)}
        disabled={props.value >= props.max}
        onClick={() => props.onChange(props.value + 1)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
