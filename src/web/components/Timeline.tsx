import type { VNode } from 'preact';
import { COPY } from '../copy.js';
import { hashOf } from '../state/route.js';
import type { TimelineBar, TimelineLayout } from './timeline-layout.js';

/** Moves focus to the plan list item of a step, or to the list itself (R6.7, R6.8). */
function focusElement(id: string): void {
  const target = document.getElementById(id);
  if (target === null) return;
  target.focus();
  target.scrollIntoView({ block: 'center' });
}

function BarView(props: { bar: TimelineBar }): VNode {
  const { bar } = props;
  const classes = [
    'bar',
    `bar--${bar.fill}`,
    bar.dashed ? 'bar--dashed' : '',
    bar.critical ? 'bar--critical' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');
  return (
    <div
      class={classes}
      data-step-id={bar.stepId}
      style={{ left: `${bar.leftPx}px`, width: `${bar.widthPx}px` }}
    >
      {bar.showLabel && (
        <span class="bar__label">
          {bar.critical ? '▲ ' : ''}
          {bar.title}
        </span>
      )}
    </div>
  );
}

/**
 * The timeline: one row per lane. A picture only: `aria-hidden`, nothing focusable; every
 * bar's step is in the plan list, which a visible link skips to (R6.7). A tap on a bar
 * focuses its list item (R6.8) through one delegated handler.
 */
export function Timeline(props: { layout: TimelineLayout }): VNode {
  const { layout } = props;
  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const bar = target.closest('[data-step-id]');
    const id = bar?.getAttribute('data-step-id');
    if (id !== null && id !== undefined) focusElement(`step-${id}`);
  };
  const innerStyle = { '--timeline-width': `${layout.widthPx}px` };

  return (
    <section aria-labelledby="timeline-heading" class="no-print">
      <h2 id="timeline-heading">{COPY.timelineHeading}</h2>
      <p class="timeline-skip">
        <a
          href={hashOf('plan')}
          onClick={(event) => {
            event.preventDefault();
            focusElement('plan-list');
          }}
        >
          {COPY.skipToList}
        </a>
      </p>
      <div class="timeline" aria-hidden="true" onClick={onClick}>
        <div class="timeline__inner" style={innerStyle}>
          <div class="timeline__row timeline__row--axis">
            <div class="timeline__corner" />
            <div class="timeline__track">
              {layout.ticks.map((tick) => (
                <span key={tick.minute} class="timeline__tick" style={{ left: `${tick.leftPx}px` }}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {layout.rows.map((row) => (
            <div key={row.key} class="timeline__row">
              <div class="timeline__label">{row.label}</div>
              <div class="timeline__track">
                {row.bars.map((bar) => (
                  <BarView key={bar.stepId} bar={bar} />
                ))}
              </div>
            </div>
          ))}
          <div class="timeline__row timeline__row--axis">
            <div class="timeline__corner" />
            <div class="timeline__track">
              <span class="timeline__serve-label" style={{ left: `${layout.serveLeftPx}px` }}>
                {layout.serveLabel}
              </span>
            </div>
          </div>
          <div class="timeline__serve-line" style={{ left: `${layout.serveLeftPx}px` }} />
        </div>
      </div>
    </section>
  );
}
