import type { VNode } from 'preact';
import { COPY, slackLabel } from '../copy.js';
import { clockAt, formatClock } from '../state/clock.js';
import type { ScheduleView } from '../state/schedule-view.js';
import { planListGroups } from './plan-list-items.js';
import type { ItemStatus } from './plan-list-items.js';

/** The words for a step's status; null when slack is 0 and the step is off the critical path. */
function statusText(status: ItemStatus): string | null {
  if (status.kind === 'critical') return COPY.listCritical;
  if (status.kind === 'slack') return slackLabel(status.minutes);
  return null;
}

/**
 * The plan as text: always in the DOM, the accessible alternative to the timeline and the
 * print layout (R7.1 to R7.3). Items are focusable by script.
 */
export function PlanList(props: { view: ScheduleView; chosenMs: number }): VNode {
  const { view, chosenMs } = props;
  const groups = planListGroups(view, chosenMs);
  const servingMs = clockAt(chosenMs, view.servingMin);
  return (
    <section id="plan-list" tabIndex={-1} aria-labelledby="plan-list-heading">
      <h2 id="plan-list-heading">{COPY.planListHeading}</h2>
      {groups.map((group) => (
        <div key={group.minute} class="plan-group">
          <h3 class="mono">{group.heading}</h3>
          <ol class="plan-items">
            {group.items.map((item) => {
              const status = statusText(item.status);
              return (
                <li key={item.stepId} id={`step-${item.stepId}`} tabIndex={-1} class="plan-item">
                  <p class="plan-item__title">
                    <span class="mono plan-item__range">{item.range}</span>
                    {item.title}
                  </p>
                  <p class="plan-item__meta">
                    {item.dishName} · <span class="mono">{item.lanes}</span> · {item.duration}
                  </p>
                  {status !== null && (
                    <p
                      class={
                        item.status.kind === 'critical'
                          ? 'plan-item__status mark mark--critical'
                          : 'plan-item__status muted'
                      }
                    >
                      {status}
                    </p>
                  )}
                  {item.detail !== null && <p class="plan-item__detail">{item.detail}</p>}
                  {item.warning !== null && <p class="mark mark--warn">{item.warning}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      <div class="plan-group">
        <h3 class="mono">{formatClock(servingMs)}</h3>
        <ol class="plan-items">
          <li class="plan-item">
            <p class="plan-item__title">{COPY.listServe}</p>
          </li>
        </ol>
      </div>
    </section>
  );
}
