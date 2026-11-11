import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { COPY } from '../copy.js';
import { useDispatch } from '../state/hooks.js';
import { ConfirmInline } from './ConfirmInline.js';

/** "Start over" with a separate confirming tap (R9.7). */
export function StartOver(): VNode {
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
        text={COPY.startOverAsk}
        confirmLabel={COPY.startOverYes}
        cancelLabel={COPY.cancel}
        onConfirm={() => {
          setAsking(false);
          dispatch({ type: 'start-over' });
        }}
        onCancel={() => {
          cancelled.current = true;
          setAsking(false);
        }}
      />
    );
  }
  return (
    <button type="button" class="button" ref={button} onClick={() => setAsking(true)}>
      {COPY.startOver}
    </button>
  );
}
