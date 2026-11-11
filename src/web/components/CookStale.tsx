import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { COOK_COPY, cookStaleBody } from '../copy.js';
import { formatClock, formatWeekday } from '../state/clock.js';
import { ConfirmInline } from './ConfirmInline.js';

/** A session whose last action is over 8 hours old: resume it or discard it first (CM7.3). */
export function CookStale(props: {
  planTitle: string;
  beganAtMs: number;
  onResume: () => void;
  onDiscard: () => void;
}): VNode {
  const [asking, setAsking] = useState(false);
  const discard = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!asking && cancelled.current) {
      cancelled.current = false;
      discard.current?.focus();
    }
  }, [asking]);
  return (
    <section class="cook-stale" aria-labelledby="cook-stale-heading">
      <h2 id="cook-stale-heading">{COOK_COPY.staleHeading}</h2>
      <p>
        {cookStaleBody(
          props.planTitle,
          formatWeekday(props.beganAtMs),
          formatClock(props.beganAtMs),
        )}
      </p>
      {asking ? (
        <ConfirmInline
          text={COOK_COPY.discardAsk}
          confirmLabel={COOK_COPY.discardYes}
          cancelLabel="Cancel"
          onConfirm={props.onDiscard}
          onCancel={() => {
            cancelled.current = true;
            setAsking(false);
          }}
        />
      ) : (
        <div class="actions">
          <button
            type="button"
            class="button button--primary button--cook"
            onClick={props.onResume}
          >
            {COOK_COPY.resume}
          </button>
          <button
            type="button"
            class="button button--cook"
            ref={discard}
            onClick={() => setAsking(true)}
          >
            {COOK_COPY.discard}
          </button>
        </div>
      )}
    </section>
  );
}
