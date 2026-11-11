import type { VNode } from 'preact';
import { cookCountdown } from '../copy.js';

/**
 * A big mono countdown (ui.md: 56 px, tabular). `role="timer"` is not live, so a screen reader
 * does not read every second (CM9.4). Over zero it reads `+02:10`.
 */
export function Countdown(props: { remainingMs: number; label: string }): VNode {
  return (
    <div class="countdown mono" role="timer" aria-live="off" aria-label={props.label}>
      {cookCountdown(props.remainingMs)}
    </div>
  );
}
