import { createContext, createElement } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { AlertPort } from './alerts.js';
import { systemClock } from './clock.js';
import { TICK_MS } from './cook-session.js';
import type { UndoLabel } from './cook-slot.js';
import { cookTimeUp } from '../copy.js';
import { announcementFor, cookView, finishedBetween } from './cook-view.js';
import { useAppState, useDispatch, useNow } from './hooks.js';
import type { WakeLockPort, WakeLockStatus } from './wake-lock.js';

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
export function useCookEffects(): WakeLockStatus {
  const dispatch = useDispatch();
  const cook = useAppState((state) => state.cook);
  const { wakeLock, alerts } = useCookPorts();
  const nowMs = useNow(systemClock, 1000);
  const [lockStatus, setLockStatus] = useState<WakeLockStatus>(wakeLock.status());

  // CM6.1: hold the screen awake while a session is cooking; ask again when the page becomes
  // visible without the lock; let go when the screen closes or dinner is served.
  const cooking = cook !== null && cookView(cook, 0).phase !== 'finished';
  useEffect(() => {
    if (!cooking) {
      void wakeLock.release().then(() => setLockStatus(wakeLock.status()));
      return;
    }
    const acquire = (): void => {
      if (wakeLock.status() !== 'held') void wakeLock.acquire().then(setLockStatus);
    };
    acquire();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void wakeLock.release();
    };
  }, [cooking, wakeLock]);

  // CM4.2, CM4.3: a hands-free step whose time came up since the last check is announced once
  // and, when the cook asked for it, sounded. The check starts at mount, so a reload replays nothing.
  const checkedMs = useRef(systemClock.nowMs());
  useEffect(() => {
    const from = checkedMs.current;
    checkedMs.current = Math.max(from, nowMs);
    if (cook === null || nowMs <= from) return;
    const ids = finishedBetween(cook, from, nowMs);
    if (ids.length === 0) return;
    const titleOf = (id: string): string =>
      cook.core.schedule.plan.steps.find((step) => step.id === id)?.title ?? id;
    dispatch({ type: 'notice/set', text: cookTimeUp(ids.map(titleOf)) });
    if (cook.alertsWanted && alerts.ready()) alerts.play();
  }, [nowMs]);

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
  return lockStatus;
}
