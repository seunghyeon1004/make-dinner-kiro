import type { VNode } from 'preact';
import { compareIds } from '../../core/index.js';
import { COPY, holdWarning } from '../copy.js';
import type { ScheduleView } from '../state/schedule-view.js';

/** The title of the step that uses `stepId`'s result first, or null for a terminal step. */
function firstUserTitle(view: ScheduleView, stepId: string): string | null {
  const start = new Map(view.steps.map((s) => [s.id, s.startMin]));
  const users = view.plan.steps
    .filter((s) => s.after.includes(stepId))
    .sort((a, b) => (start.get(a.id) ?? 0) - (start.get(b.id) ?? 0) || compareIds(a.id, b.id));
  return users[0]?.title ?? null;
}

/** One sentence per hold_exceeded warning, or the all-clear (R5.6). */
export function WarningList(props: { view: ScheduleView }): VNode {
  const { view } = props;
  return (
    <section aria-labelledby="warnings-heading">
      <h2 id="warnings-heading">{COPY.warningsHeading}</h2>
      {view.warnings.length === 0 ? (
        <p>{COPY.noWarnings}</p>
      ) : (
        <ul class="warning-list">
          {view.warnings.map((w) => {
            const step = view.stepById.get(w.stepId);
            if (step === undefined) return null;
            return (
              <li key={w.stepId}>
                <span class="mark mark--warn">! Warning</span>{' '}
                <span>
                  {holdWarning(
                    view.dishName.get(step.dish) ?? step.dish,
                    step.title,
                    w.waitMin,
                    w.holdMin,
                    firstUserTitle(view, w.stepId),
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
