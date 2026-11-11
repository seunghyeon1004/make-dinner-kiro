import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { COOK_COPY } from '../copy.js';
import { useDispatch } from '../state/hooks.js';
import { ConfirmInline } from './ConfirmInline.js';

/** "Stop cooking" with its second, separate tap; ends the session and opens the Plan (CM8.3). */
export function StopCooking(): VNode {
  const dispatch = useDispatch();
  const [asking, setAsking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!asking && cancelled.current) {
      cancelled.current = false;
      button.current?.focus();
    }
  }, [asking]);
  if (asking) {
    return (
      <ConfirmInline
        text={COOK_COPY.stopAsk}
        confirmLabel={COOK_COPY.stopYes}
        cancelLabel={COOK_COPY.keepCooking}
        onConfirm={() => {
          dispatch({ type: 'cook/stop' });
          dispatch({ type: 'navigate', route: 'plan', cookRegistered: true });
        }}
        onCancel={() => {
          cancelled.current = true;
          setAsking(false);
        }}
      />
    );
  }
  return (
    <button type="button" class="button button--cook" ref={button} onClick={() => setAsking(true)}>
      {COOK_COPY.stopCooking}
    </button>
  );
}
