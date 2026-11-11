import type { VNode } from 'preact';
import { COOK_COPY, cookExtra } from '../copy.js';
import { EXTRA_CHOICES } from '../state/cook-session.js';

/** "Needs more time": +5, +10 and +15 minutes on a running step (CM3.1). */
export function ExtraTime(props: {
  stepId: string;
  title: string;
  onExtra: (stepId: string, minutes: 5 | 10 | 15) => void;
}): VNode {
  return (
    <fieldset class="extra-time">
      <legend>{COOK_COPY.needsMoreTime}</legend>
      <div class="extra-time__buttons">
        {EXTRA_CHOICES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            class="button button--cook"
            onClick={() => props.onExtra(props.stepId, minutes)}
          >
            {cookExtra(minutes)}
            <span class="visually-hidden"> for {props.title}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
