import type { VNode } from 'preact';
import { COOK_COPY, cookIn } from '../copy.js';
import { formatClock } from '../state/clock.js';
import type { UpNextItem } from '../state/cook-view.js';

/** The next three steps that are not due yet, each with its wait and clock time (CM2.6). */
export function UpNext(props: { items: UpNextItem[] }): VNode {
  return (
    <section aria-labelledby="up-next">
      <h2 id="up-next" tabIndex={-1}>
        {COOK_COPY.upNext}
      </h2>
      {props.items.length === 0 ? (
        <p>{COOK_COPY.nothingElse}</p>
      ) : (
        <ol class="up-next">
          {props.items.map((item) => (
            <li key={item.stepId} class="up-next__item">
              <span class="up-next__title">{item.title}</span>
              <span class="up-next__meta muted">
                {item.dishName} · {cookIn(item.inMin)} ·{' '}
                <time class="mono" dateTime={new Date(item.startMs).toISOString()}>
                  {formatClock(item.startMs)}
                </time>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
