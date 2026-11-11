import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { COOK_COPY, cookEarlier } from '../copy.js';
import type { CookCore } from '../state/cook-slot.js';
import { LogEntryView } from './LogEntryView.js';

/** The rebuilds of this session, newest first; older ones one tap away (CM5.3, CM5.4). */
export function BuildLog(props: { core: CookCore }): VNode {
  const { core } = props;
  const [older, setOlder] = useState(false);
  const entries = [...core.log].reverse();
  const [latest, ...rest] = entries;
  return (
    <section aria-labelledby="build-log">
      <h2 id="build-log" tabIndex={-1}>
        {COOK_COPY.buildLog}
      </h2>
      {latest === undefined ? (
        <p>{COOK_COPY.logEmpty}</p>
      ) : (
        <ol class="build-log">
          <LogEntryView entry={latest} core={core} />
          {older &&
            rest.map((entry, index) => <LogEntryView key={index} entry={entry} core={core} />)}
        </ol>
      )}
      {rest.length > 0 && (
        <button type="button" class="button" aria-expanded={older} onClick={() => setOlder(!older)}>
          {cookEarlier(rest.length)}
        </button>
      )}
    </section>
  );
}
