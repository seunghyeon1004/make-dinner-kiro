import { createContext, createElement } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import type { Action, AppState, Store } from './store.js';

const StoreContext = createContext<Store | null>(null);

export function StoreProvider(props: {
  store: Store;
  children: ComponentChildren;
}): ComponentChildren {
  return createElement(StoreContext.Provider, { value: props.store }, props.children);
}

function useStore(): Store {
  const store = useContext(StoreContext);
  if (store === null) throw new Error('useAppState needs a StoreProvider');
  return store;
}

/** Reads a part of the state; re-renders when the selected value changes (`Object.is`). */
export function useAppState<T>(select: (state: AppState) => T): T {
  const store = useStore();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const value = select(store.getState());
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    const changed = (): boolean => !Object.is(select(store.getState()), latest.current);
    // The store may have changed between the render and this effect; do not miss it.
    if (changed()) rerender(0);
    return store.subscribe(() => {
      if (changed()) rerender(0);
    });
    // `select` is usually an inline function; the subscription only needs the store.
  }, [store]);
  return value;
}

export function useDispatch(): (action: Action) => void {
  const store = useStore();
  return store.dispatch;
}

/** The clock that components read when they dispatch an action carrying `nowMs`. */
export function useClock(): Clock {
  return systemClock;
}

/** The clock's time in ms, read again every `everyMs`; the component re-renders when it does. */
export function useNow(clock: Clock, everyMs: number): number {
  const [now, setNow] = useState(() => clock.nowMs());
  useEffect(() => {
    setNow(clock.nowMs());
    const id = setInterval(() => setNow(clock.nowMs()), everyMs);
    return () => clearInterval(id);
  }, [clock, everyMs]);
  return now;
}
