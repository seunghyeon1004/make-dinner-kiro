import type { VNode } from 'preact';
import { useAppState } from '../state/hooks.js';

/** The one `aria-live="polite"` region (R9.4). Always in the DOM, so a new text is announced. */
export function LiveNotice(): VNode {
  const notice = useAppState((state) => state.notice);
  return (
    <div class="live-notice no-print" role="status" aria-live="polite">
      {notice}
    </div>
  );
}
