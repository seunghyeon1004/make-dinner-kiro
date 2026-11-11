import type { VNode } from 'preact';
import { COPY } from '../copy.js';
import { useAppState } from '../state/hooks.js';

export function Plan(): VNode {
  const title = useAppState((state) => state.dinner?.plan.title ?? COPY.planHeading);
  return (
    <main class="screen">
      <h1 tabIndex={-1}>{title}</h1>
    </main>
  );
}
