import type { VNode } from 'preact';
import { COOK_COPY } from '../copy.js';

/** The one-line note when the screen cannot be kept awake; never an error (CM6.2). */
export function WakeLockNote(): VNode {
  return <p class="muted">{COOK_COPY.wakeNote}</p>;
}
