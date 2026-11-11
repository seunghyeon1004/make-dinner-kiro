import type { VNode } from 'preact';
import { STEPS_COPY } from '../copy.js';
import type { Issue } from '../../core/index.js';
import type { PlacedIssue } from './issue-placement.js';

/** `!` and the word, so severity is never told by colour alone (R4.9). */
export function IssueMark(props: { issue: Issue }): VNode {
  const error = props.issue.severity === 'error';
  return (
    <span class={error ? 'mark mark--error' : 'mark mark--warn'}>
      <span aria-hidden="true">!</span> {error ? STEPS_COPY.error : STEPS_COPY.warning}
    </span>
  );
}

/** The issues beside a step or at the top of a dish. The anchored copy can take focus. */
export function IssueList(props: { items: readonly PlacedIssue[] }): VNode | null {
  if (props.items.length === 0) return null;
  return (
    <ul class="issues">
      {props.items.map(({ n, issue, anchor }) => (
        <li
          key={n}
          class="issue"
          id={anchor ? `issue-${n}` : undefined}
          tabIndex={anchor ? -1 : undefined}
        >
          <IssueMark issue={issue} /> {issue.message}
        </li>
      ))}
    </ul>
  );
}

function jumpTo(n: number, event: Event): void {
  event.preventDefault();
  const target = document.getElementById(`issue-${n}`);
  if (target === null) return;
  target.scrollIntoView({ block: 'center' });
  target.focus();
}

/** Every issue at the top of the screen, each linking to where it is shown (R4.9). */
export function IssueSummary(props: { items: readonly PlacedIssue[] }): VNode | null {
  if (props.items.length === 0) return null;
  return (
    <ul class="issues">
      {props.items.map(({ n, issue }) => (
        <li key={n} class="summary-issue">
          <IssueMark issue={issue} />{' '}
          {issue.code === 'cycle' || 'stepId' in issue || 'dishId' in issue ? (
            <a href={`#issue-${n}`} onClick={(event) => jumpTo(n, event)}>
              {issue.message}
            </a>
          ) : (
            issue.message
          )}
        </li>
      ))}
    </ul>
  );
}
