import type { VNode } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { normaliseRecipeText } from '../../core/index.js';
import { elapsedSeconds, PASTE_COPY, parseFailureText, recipeCounter } from '../copy.js';
import { systemClock } from '../state/clock.js';
import { newRequestId, useAppState, useClock, useDispatch, useNow } from '../state/hooks.js';

const MAX_CHARACTERS = 12_000;

/** The running request's seconds; its own component so that only it re-renders each second. */
function Elapsed(props: { startedAtMs: number }): VNode {
  const now = useNow(systemClock, 1000);
  return (
    <span aria-hidden="true">
      {' '}
      {elapsedSeconds(Math.max(0, Math.floor((now - props.startedAtMs) / 1000)))}
    </span>
  );
}

/** Paste recipes, count them against the limit and send them to be read (R2.1 to R2.8). */
export function RecipePaste(): VNode {
  const text = useAppState((state) => state.recipeText);
  const parse = useAppState((state) => state.parse);
  const dispatch = useDispatch();
  const clock = useClock();
  const ids = useId();
  const submit = useRef<HTMLButtonElement>(null);

  const length = [...normaliseRecipeText(text)].length;
  const busy = parse.status === 'busy';
  const reason =
    length === 0 ? PASTE_COPY.empty : length > MAX_CHARACTERS ? PASTE_COPY.tooLong : null;
  const blocked = reason !== null;

  const send = (): void => {
    if (blocked || busy) return;
    dispatch({ type: 'parse/start', requestId: newRequestId(), nowMs: clock.nowMs() });
  };

  const cancel = (): void => {
    dispatch({ type: 'parse/cancel' });
    // The button is enabled again after this render; put focus back where the cook started.
    queueMicrotask(() => submit.current?.focus());
  };

  return (
    <div class="paste">
      <div class="field">
        <label for={`${ids}-text`}>{PASTE_COPY.label}</label>
        <p id={`${ids}-hint`} class="muted">
          {PASTE_COPY.hint}
        </p>
        <textarea
          id={`${ids}-text`}
          class="input input--area"
          rows={10}
          maxLength={200_000}
          value={text}
          disabled={busy}
          aria-describedby={`${ids}-hint ${ids}-count`}
          onInput={(event) =>
            dispatch({ type: 'recipe-text/set', text: event.currentTarget.value })
          }
        />
        <p id={`${ids}-count`} class="muted">
          {recipeCounter(length)}
        </p>
      </div>
      {parse.status === 'failed' && (
        <p role="alert" class="field-error">
          {parseFailureText(parse.failure)}
        </p>
      )}
      <div class="actions">
        <button
          type="button"
          class="button button--primary"
          ref={submit}
          disabled={blocked || busy}
          aria-describedby={blocked ? `${ids}-reason` : undefined}
          onClick={send}
        >
          {PASTE_COPY.submit}
        </button>
        {busy && (
          <button type="button" class="button" onClick={cancel}>
            {PASTE_COPY.cancel}
          </button>
        )}
      </div>
      {blocked && !busy && (
        <p id={`${ids}-reason`} class="muted">
          {reason}
        </p>
      )}
      {parse.status === 'busy' && (
        <p role="status">
          {PASTE_COPY.busy}
          <Elapsed startedAtMs={parse.startedAtMs} />
        </p>
      )}
    </div>
  );
}
