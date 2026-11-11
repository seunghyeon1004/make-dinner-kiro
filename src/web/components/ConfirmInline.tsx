import type { VNode } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';

interface Props {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The second, separate tap that a destructive or replacing action needs (ui.md). Focus moves
 * to the question when it appears; the caller returns focus to its own button on cancel.
 */
export function ConfirmInline(props: Props): VNode {
  const textId = useId();
  const question = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    question.current?.focus();
  }, []);
  return (
    <div class="confirm-inline" role="group" aria-labelledby={textId}>
      <p id={textId} ref={question} tabIndex={-1}>
        {props.text}
      </p>
      <div class="actions">
        <button type="button" class="button button--primary" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
        <button type="button" class="button" onClick={props.onCancel}>
          {props.cancelLabel}
        </button>
      </div>
    </div>
  );
}
