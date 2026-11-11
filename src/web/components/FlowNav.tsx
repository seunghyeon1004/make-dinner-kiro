import type { VNode } from 'preact';
import { useId, useState } from 'preact/hooks';
import { COPY } from '../copy.js';
import { useAppState } from '../state/hooks.js';
import { hashOf } from '../state/route.js';
import { reachable } from '../state/store.js';
import type { Route } from '../state/store.js';

const ITEMS: ReadonlyArray<{ route: Route; label: string }> = [
  { route: 'menu', label: COPY.navMenu },
  { route: 'steps', label: COPY.navSteps },
  { route: 'plan', label: COPY.navPlan },
  { route: 'cook', label: COPY.navCook },
];

/**
 * Menu, Steps, Plan, Cook as one compact row of numbered steps (R9.2, plan-ui review B).
 * An unreachable step is a dashed, focusable button with `aria-disabled`; its reason is always
 * its accessible description and shows as visible text only while it is tapped or focused.
 */
export function FlowNav(props: { cookRegistered: boolean }): VNode {
  const route = useAppState((state) => state.route);
  const reach = useAppState((state) => reachable(state, props.cookRegistered));
  const [shown, setShown] = useState<Route | null>(null);
  const baseId = useId();
  const shownState = shown === null ? null : reach[shown];
  return (
    <nav class="flow-nav no-print" aria-label={COPY.navLabel}>
      <ol>
        {ITEMS.map((item, index) => {
          const state = reach[item.route];
          const number = (
            <span class="flow-nav__number" aria-hidden="true">
              {index + 1}{' '}
            </span>
          );
          if (!state.ok) {
            const reasonId = `${baseId}-${item.route}`;
            return (
              <li key={item.route} class="flow-nav__item flow-nav__item--off">
                <button
                  type="button"
                  class="flow-nav__off"
                  aria-disabled="true"
                  aria-describedby={reasonId}
                  onClick={() => setShown(item.route)}
                  onFocus={() => setShown(item.route)}
                  onBlur={() => setShown((current) => (current === item.route ? null : current))}
                >
                  {number}
                  {item.label}
                </button>
                <span id={reasonId} class="visually-hidden">
                  {state.reason}
                </span>
              </li>
            );
          }
          return (
            <li key={item.route} class="flow-nav__item">
              <a
                href={hashOf(item.route)}
                aria-current={item.route === route ? 'step' : undefined}
                onClick={() => setShown(null)}
              >
                {number}
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
      <p class="flow-nav__helper muted" aria-hidden="true">
        {shownState !== null && !shownState.ok ? shownState.reason : ''}
      </p>
    </nav>
  );
}
