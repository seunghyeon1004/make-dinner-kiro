import type { VNode } from 'preact';
import { ConfirmInline } from '../components/ConfirmInline.js';
import { SampleList } from '../components/SampleList.js';
import { COPY, replaceAsk } from '../copy.js';
import { useAppState, useClock, useDispatch } from '../state/hooks.js';

/** Choose a dinner: samples now; pasted recipes and a Dinnerfile follow in later tasks. */
export function Menu(): VNode {
  const pending = useAppState((state) => state.pendingLoad);
  const currentTitle = useAppState((state) => state.dinner?.plan.title ?? '');
  const dispatch = useDispatch();
  const clock = useClock();

  const keep = (): void => {
    const sampleId = pending?.source.kind === 'sample' ? pending.source.sampleId : null;
    dispatch({ type: 'dinner/keep' });
    if (sampleId !== null) {
      // The question is gone after this render; put focus back on the card that was tapped.
      queueMicrotask(() => {
        document.querySelector<HTMLElement>(`[data-sample-id="${sampleId}"]`)?.focus();
      });
    }
  };

  return (
    <main class="screen">
      <h1 tabIndex={-1}>{COPY.menuHeading}</h1>
      <p>{COPY.menuIntro}</p>
      <section aria-labelledby="samples-heading">
        <h2 id="samples-heading">{COPY.samplesHeading}</h2>
        {pending !== null && (
          <ConfirmInline
            text={replaceAsk(currentTitle)}
            confirmLabel={COPY.replaceIt}
            cancelLabel={COPY.keepMine}
            onConfirm={() => dispatch({ type: 'dinner/replace', nowMs: clock.nowMs() })}
            onCancel={keep}
          />
        )}
        <SampleList />
      </section>
    </main>
  );
}
