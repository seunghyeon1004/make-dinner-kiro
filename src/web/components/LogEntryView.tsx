import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { compareIds } from '../../core/index.js';
import { cookHideUpToDate, cookLogLines, cookShowUpToDate, holdWarning } from '../copy.js';
import type { LogLine } from '../copy.js';
import type { CookCore, LogEntry } from '../state/cook-slot.js';

/** A mono line to look at, and the sentence a screen reader gets instead (design, C3). */
function Line(props: { line: LogLine; class?: string }): VNode {
  return (
    <li class={props.class}>
      <span class="log-line mono" aria-hidden="true">
        {props.line.mono}
      </span>
      <span class="visually-hidden log-sentence">{props.line.sentence}</span>
    </li>
  );
}

/** The title of the step that uses `stepId`'s result first in the current schedule, or null. */
function firstUserTitle(core: CookCore, stepId: string): string | null {
  const start = new Map(core.schedule.steps.map((row) => [row.id, row.startMin]));
  const users = core.schedule.plan.steps
    .filter((step) => step.after.includes(stepId))
    .sort((a, b) => (start.get(a.id) ?? 0) - (start.get(b.id) ?? 0) || compareIds(a.id, b.id));
  return users[0]?.title ?? null;
}

/** One rebuild: its cause, moves, counts, serving, new warnings and the up-to-date list (CM5.3 to CM5.5). */
export function LogEntryView(props: { entry: LogEntry; core: CookCore }): VNode {
  const { entry, core } = props;
  const [listed, setListed] = useState(false);
  const steps = new Map(core.schedule.plan.steps.map((step) => [step.id, step]));
  const dishes = new Map(core.schedule.plan.dishes.map((dish) => [dish.id, dish.name]));
  const lines = cookLogLines(entry, {
    axisMs: core.axisMs,
    titleOf: (id) => steps.get(id)?.title ?? id,
  });
  const warnings = entry.result.ok ? entry.result.newWarnings : [];
  return (
    <li class="log-entry">
      <ul class="log-entry__lines">
        <Line line={lines.cause} class="log-entry__cause" />
        {lines.failed !== null && <Line line={lines.failed} />}
        {lines.moves.map((line, index) => (
          <Line key={index} line={line} />
        ))}
        {lines.unchanged !== null && <Line line={lines.unchanged} />}
        {lines.serving !== null && <Line line={lines.serving} />}
        {lines.nothing !== null && <Line line={lines.nothing} />}
      </ul>
      {warnings.map((warning) => {
        const step = steps.get(warning.stepId);
        if (step === undefined) return null;
        return (
          <p class="log-entry__warning" key={warning.stepId}>
            <span class="mark mark--warn">! Warning</span>{' '}
            {holdWarning(
              dishes.get(step.dish) ?? step.dish,
              step.title,
              warning.waitMin,
              warning.holdMin,
              firstUserTitle(core, warning.stepId),
            )}
          </p>
        );
      })}
      {lines.upToDate.length > 0 && (
        <>
          <button
            type="button"
            class="button log-entry__toggle"
            aria-expanded={listed}
            onClick={() => setListed(!listed)}
          >
            {listed ? cookHideUpToDate() : cookShowUpToDate(lines.upToDate.length)}
          </button>
          {listed && (
            <ul class="log-entry__lines">
              {lines.upToDate.map((line, index) => (
                <Line key={index} line={line} />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}
