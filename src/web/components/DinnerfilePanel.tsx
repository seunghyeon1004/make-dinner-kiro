import type { VNode } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { EXPORT_COPY } from '../copy.js';
import { copyText, downloadText, selectContents } from '../state/clipboard.js';
import { useDispatch } from '../state/hooks.js';

/** The Dinnerfile as text with Copy and Download, and the line on running it with Make (R8.2). */
export function DinnerfilePanel(props: { text: string }): VNode {
  const dispatch = useDispatch();
  const headingId = useId();
  const pre = useRef<HTMLPreElement>(null);

  const copy = async (): Promise<void> => {
    if (await copyText(navigator.clipboard, props.text)) {
      dispatch({ type: 'notice/set', text: EXPORT_COPY.copiedDinnerfile });
    } else {
      if (pre.current !== null) selectContents(document, pre.current);
      dispatch({ type: 'notice/set', text: EXPORT_COPY.copyFailed });
    }
  };

  return (
    <section class="panel" aria-labelledby={headingId}>
      <h3 id={headingId}>{EXPORT_COPY.dinnerfile}</h3>
      <pre ref={pre} class="dinnerfile-text mono" tabIndex={0}>
        {props.text}
      </pre>
      <div class="actions">
        <button type="button" class="button" onClick={() => void copy()}>
          {EXPORT_COPY.copy}
        </button>
        <button
          type="button"
          class="button"
          onClick={() => downloadText(document, 'Dinnerfile', props.text)}
        >
          {EXPORT_COPY.download}
        </button>
      </div>
      <p class="muted">{EXPORT_COPY.makeLine}</p>
    </section>
  );
}
