import type { VNode } from 'preact';
import { useId, useRef } from 'preact/hooks';
import { DINNERFILE_COPY, showLine } from '../copy.js';
import { DINNERFILE_FILE_MAX, readDinnerfile } from '../state/dinnerfile-import.js';
import { useAppState, useClock, useDispatch } from '../state/hooks.js';

/** Start and end offsets of the 1-based `line` in `text`, the line break excluded. */
function lineRange(text: string, line: number): [number, number] {
  const lines = text.split('\n');
  const start = lines.slice(0, line - 1).reduce((sum, l) => sum + l.length + 1, 0);
  return [start, start + (lines[line - 1]?.length ?? 0)];
}

/** Paste or open a Dinnerfile and read it in the browser (R3.1 to R3.5). */
export function DinnerfilePaste(): VNode {
  const text = useAppState((state) => state.dinnerfileText);
  const importState = useAppState((state) => state.import);
  const dispatch = useDispatch();
  const clock = useClock();
  const ids = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const empty = text.trim() === '';

  const open = (source: string): void => {
    const result = readDinnerfile(source);
    if (result.ok) dispatch({ type: 'dinner/load', load: result.value, nowMs: clock.nowMs() });
    else dispatch({ type: 'import/failed', ...result.error });
  };

  const choose = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    if (file.size > DINNERFILE_FILE_MAX) {
      dispatch({ type: 'import/failed', heading: DINNERFILE_COPY.fileTooLarge, problems: [] });
      return;
    }
    let content: string;
    try {
      content = await file.text();
    } catch {
      dispatch({ type: 'import/failed', heading: DINNERFILE_COPY.fileUnreadable, problems: [] });
      return;
    }
    dispatch({ type: 'dinnerfile-text/set', text: content });
    open(content);
  };

  const show = (line: number): void => {
    const [start, end] = lineRange(text, line);
    area.current?.focus();
    area.current?.setSelectionRange(start, end);
  };

  return (
    <div class="paste">
      <div class="field">
        <label for={`${ids}-text`}>{DINNERFILE_COPY.label}</label>
        <textarea
          id={`${ids}-text`}
          ref={area}
          class="input input--area input--mono"
          rows={10}
          maxLength={DINNERFILE_FILE_MAX}
          spellcheck={false}
          value={text}
          onInput={(event) =>
            dispatch({ type: 'dinnerfile-text/set', text: event.currentTarget.value })
          }
        />
      </div>
      {importState.status === 'failed' && (
        <div role="alert" class="import-problems">
          <p class="field-error">{importState.heading}</p>
          {importState.problems.length > 0 && (
            <ul>
              {importState.problems.map((problem, n) => (
                <li key={n}>
                  <span>{problem.message}</span>
                  {problem.kind === 'line' && problem.line !== null && (
                    <button type="button" class="button" onClick={() => show(problem.line ?? 1)}>
                      {showLine(problem.line)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div class="actions">
        <button
          type="button"
          class="button button--primary"
          disabled={empty}
          aria-describedby={empty ? `${ids}-reason` : undefined}
          onClick={() => open(text)}
        >
          {DINNERFILE_COPY.open}
        </button>
        <label class="button file-button">
          {DINNERFILE_COPY.fileLabel}
          <input
            type="file"
            class="visually-hidden"
            onChange={(event) => {
              const input = event.currentTarget;
              void choose(input.files?.[0]).then(() => {
                input.value = '';
              });
            }}
          />
        </label>
      </div>
      {empty && (
        <p id={`${ids}-reason`} class="muted">
          {DINNERFILE_COPY.empty}
        </p>
      )}
    </div>
  );
}
