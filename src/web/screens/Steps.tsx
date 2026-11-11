import type { VNode } from 'preact';
import { COPY } from '../copy.js';

export function Steps(): VNode {
  return (
    <main class="screen">
      <h1 tabIndex={-1}>{COPY.stepsHeading}</h1>
    </main>
  );
}
