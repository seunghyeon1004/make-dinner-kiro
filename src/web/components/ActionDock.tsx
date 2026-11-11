import type { VNode } from 'preact';
import { COOK_COPY, cookBlockedAsk, cookUndoButton, cookUndoWords } from '../copy.js';
import type { CardStep, CookView } from '../state/cook-view.js';
import { ConfirmInline } from './ConfirmInline.js';
import { actionId } from './StepCardBody.js';

/** The card the dock's primary acts on: lane 1's current step, else an overrun hands-free step. */
export function dockCard(view: CookView): CardStep | null {
  if (view.dock === null) return null;
  const id = view.dock.stepId;
  const all = [...view.lanes.flatMap((lane) => [lane.current, ...lane.also]), ...view.running];
  return all.find((card) => card?.stepId === id) ?? null;
}

interface Props {
  view: CookView;
  card: CardStep | null;
  /** The step whose start waits for a second tap, with the titles it waits for. */
  blocked: { stepId: string; title: string; waitsFor: string[] } | null;
  titleOf: (stepId: string) => string;
  onStart: (stepId: string) => void;
  onDone: (stepId: string) => void;
  onBehind: () => void;
  onUndo: () => void;
  onStartAnyway: () => void;
  onNotYet: () => void;
}

/** The words of the Undo button: "Undo: +15 min on Roast the chicken". */
function undoText(view: CookView, titleOf: (stepId: string) => string): string | null {
  const label = view.undo?.label;
  if (label === undefined) return null;
  const id =
    label.kind === 'start' || label.kind === 'done' || label.kind === 'extra' ? label.stepId : '';
  return cookUndoButton(cookUndoWords(label, titleOf(id)));
}

/**
 * The thumb zone: sticky at the bottom of the screen, full-width primary actions (ui.md, CM3.6).
 * The dock's step is not also given a button in its card. A start that waits for another step
 * asks for a second tap here (CM3.3).
 */
export function ActionDock(props: Props): VNode {
  const { card, view, blocked } = props;
  const action = card === null ? null : card.state === 'due' ? 'start' : 'done';
  const undo = undoText(view, props.titleOf);
  if (blocked !== null) {
    return (
      <div class="action-dock" role="region" aria-label={COOK_COPY.dockLabel}>
        <ConfirmInline
          text={cookBlockedAsk(blocked.title, blocked.waitsFor)}
          confirmLabel={COOK_COPY.startAnyway}
          cancelLabel={COOK_COPY.notYet}
          onConfirm={props.onStartAnyway}
          onCancel={props.onNotYet}
        />
      </div>
    );
  }
  return (
    <div class="action-dock" role="region" aria-label={COOK_COPY.dockLabel}>
      {card !== null && action !== null && (
        <>
          <p class="action-dock__title">{card.title}</p>
          <button
            type="button"
            id={actionId(card.stepId, action)}
            class="button button--primary button--cook"
            onClick={() =>
              action === 'start' ? props.onStart(card.stepId) : props.onDone(card.stepId)
            }
          >
            {action === 'start' ? COOK_COPY.start : COOK_COPY.done}
          </button>
        </>
      )}
      <div class={undo === null ? 'action-dock__row' : 'action-dock__row action-dock__row--two'}>
        <button
          type="button"
          class={`button button--cook${view.emphasiseBehind ? ' button--emphasis' : ''}`}
          onClick={props.onBehind}
        >
          {COOK_COPY.behind}
        </button>
        {undo !== null && (
          <button type="button" class="button button--cook" onClick={props.onUndo}>
            {undo}
          </button>
        )}
      </div>
    </div>
  );
}
