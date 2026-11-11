import { createContext, createElement } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useRef } from 'preact/hooks';
import type { AlertPort } from './alerts.js';
import { systemClock } from './clock.js';
import { TICK_MS } from './cook-session.js';
import type { UndoLabel } from './cook-slot.js';
import { announcementFor } from './cook-view.js';
import { useAppState, useDispatch } from './hooks.js';
import type { WakeLockPort } from './wake-lock.js';

/** The device ports of the Cook screen, provided once by `main.tsx` (and faked in tests). */
export interface CookPorts {
  wakeLock: WakeLockPort;
  alerts: AlertPort;
}

const PortsContext = createContext<CookPorts | null>(null);

export function CookPortsProvider(props: {
  ports: CookPorts;
  children: ComponentChildren;
}): ComponentChildren {
  return createElement(PortsContext.Provider, { value: props.ports }, props.children);
}

export function useCookPorts(): CookPorts {
  const ports = useContext(PortsContext);
  if (ports === null) throw new Error('useCookPorts needs a CookPortsProvider');
  return ports;
}

/**
 * Effects while the Cook screen is mounted. Now: a `cook/tick` every `TICK_MS` and when the
 * page becomes visible. A tick changes nothing in the state; it lets the screen catch up.
 */
export function useCookEffects(): void {
  const dispatch = useDispatch();
  const cook = useAppState((state) => state.cook);

  // A rebuild, an undo or the end of dinner is announced once, when the state changes. The
  // first render is not a change, so a reload announces nothing (CM9.4).
  const previous = useRef(cook);
  useEffect(() => {
    const before = previous.current;
    previous.current = cook;
    if (cook === before) return;
    let label: UndoLabel | undefined;
    if (
      before?.undo != null &&
      cook !== null &&
      cook.undo === null &&
      cook.core === before.undo.before
    ) {
      label = before.undo.label;
    }
    const text = announcementFor(before, cook, label);
    if (text !== null) dispatch({ type: 'notice/set', text });
  }, [cook]);

  useEffect(() => {
    const tick = (): void => dispatch({ type: 'cook/tick', nowMs: systemClock.nowMs() });
    const id = setInterval(tick, TICK_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [dispatch]);
}
