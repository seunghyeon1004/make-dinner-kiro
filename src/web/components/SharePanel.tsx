import type { VNode } from 'preact';
import { useId, useLayoutEffect, useRef } from 'preact/hooks';
import { EXPORT_COPY, shareTooLong } from '../copy.js';

/** The link for the current dinner, computed by an effect when the dinner changes (R8.3, R8.4). */
export type ShareState =
  | { status: 'pending' }
  | { status: 'ready'; url: string }
  | { status: 'too_long'; length: number }
  | { status: 'unavailable' };

interface Props {
  share: ShareState;
  onCopy: () => void;
  /** Changes when a copy failed: the link is selected so it can be copied by hand (R8.7). */
  selectToken: number;
}

export function SharePanel(props: Props): VNode {
  const headingId = useId();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (props.selectToken > 0) field.current?.select();
  }, [props.selectToken]);

  const { share } = props;
  return (
    <section class="panel" aria-labelledby={headingId}>
      <h3 id={headingId}>{EXPORT_COPY.shareLink}</h3>
      {share.status === 'too_long' && <p>{shareTooLong(share.length)}</p>}
      {share.status === 'ready' && (
        <>
          <div class="field">
            <label for={fieldId}>{EXPORT_COPY.linkLabel}</label>
            <input
              id={fieldId}
              ref={field}
              class="input input--mono"
              type="text"
              readOnly
              value={share.url}
            />
          </div>
          <div class="actions">
            <button type="button" class="button" onClick={props.onCopy}>
              {EXPORT_COPY.copyLink}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
