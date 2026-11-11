import type { VNode } from 'preact';
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

/** Menu, Steps, Plan, Cook as navigation (R9.2). `cookRegistered` is `SCREENS.cook !== null`. */
export function FlowNav(props: { cookRegistered: boolean }): VNode {
  const route = useAppState((state) => state.route);
  const reach = useAppState((state) => reachable(state, props.cookRegistered));
  return (
    <nav class="flow-nav no-print" aria-label={COPY.navLabel}>
      <ol>
        {ITEMS.map((item) => {
          const state = reach[item.route];
          if (!state.ok) {
            return (
              <li key={item.route} class="flow-nav__item flow-nav__item--off">
                <span>{item.label}</span> <span class="flow-nav__reason">{state.reason}</span>
              </li>
            );
          }
          return (
            <li key={item.route} class="flow-nav__item">
              <a href={hashOf(item.route)} aria-current={item.route === route ? 'step' : undefined}>
                {item.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
