import type { ComponentType, VNode } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { FlowNav } from './components/FlowNav.js';
import { Header } from './components/Header.js';
import { LiveNotice } from './components/LiveNotice.js';
import { COPY, documentTitle } from './copy.js';
import { Menu } from './screens/Menu.js';
import { Plan } from './screens/Plan.js';
import { Steps } from './screens/Steps.js';
import { useAppState } from './state/hooks.js';
import type { Route } from './state/store.js';

/** The screen table. cooking-mode fills `cook` and changes nothing else (R9.9). */
export const SCREENS: Record<Route, ComponentType | null> = {
  menu: Menu,
  steps: Steps,
  plan: Plan,
  cook: null,
};

const SCREEN_NAMES: Record<Route, string> = {
  menu: COPY.navMenu,
  steps: COPY.navSteps,
  plan: COPY.navPlan,
  cook: COPY.navCook,
};

export function App(): VNode {
  const route = useAppState((state) => state.route);
  const Screen = SCREENS[route] ?? Menu;
  const first = useRef(true);

  useEffect(() => {
    document.title = documentTitle(SCREEN_NAMES[route]);
    // Focus goes to the h1 when the screen changes, not on the first paint (R9.4).
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector<HTMLElement>('h1')?.focus();
  }, [route]);

  return (
    <ErrorBoundary>
      <div class="app">
        <Header />
        <FlowNav cookRegistered={SCREENS.cook !== null} />
        <LiveNotice />
        <Screen />
      </div>
    </ErrorBoundary>
  );
}
