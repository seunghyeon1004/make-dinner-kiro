import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { COOK_COPY, cookAlertsText } from '../copy.js';
import { useCookPorts } from '../state/cook-hooks.js';
import { useAppState, useDispatch } from '../state/hooks.js';

/** Alerts stay off until a tap turns them on; the tap is what lets the browser play sound (CM4.4). */
export function AlertToggle(): VNode {
  const wanted = useAppState((state) => state.cook?.alertsWanted ?? false);
  const dispatch = useDispatch();
  const { alerts } = useCookPorts();
  const [ready, setReady] = useState(alerts.ready());
  const canVibrate = typeof navigator.vibrate === 'function';
  const on = wanted && ready;
  const mode = on ? 'on' : wanted ? 'reload' : 'off';
  const toggle = (): void => {
    if (on) {
      dispatch({ type: 'cook/alerts', wanted: false });
      return;
    }
    // `enable` starts inside the tap, which is what the browser needs to allow sound.
    void alerts.enable().then((ok) => {
      setReady(alerts.ready());
      dispatch({ type: 'cook/alerts', wanted: ok });
    });
  };
  return (
    <div class="alert-toggle">
      <button type="button" class="button button--cook" aria-pressed={on} onClick={toggle}>
        {COOK_COPY.alertsButton}: {on ? COOK_COPY.alertsOn : COOK_COPY.alertsOff}
      </button>
      <p class="muted">{cookAlertsText(mode, canVibrate)}</p>
    </div>
  );
}
