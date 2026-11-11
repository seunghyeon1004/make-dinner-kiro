import type { VNode } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { COPY, MANAGE_COPY } from '../copy.js';

interface Props {
  initial: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** A dish name field with a submit and a cancel button; a blank name shows the error (R4.6). */
export function DishNameForm(props: Props): VNode {
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(props.initial);
  const [error, setError] = useState(false);
  useEffect(() => {
    input.current?.focus();
  }, []);
  const submit = (event: Event): void => {
    event.preventDefault();
    if (name.trim() === '') setError(true);
    else props.onSubmit(name);
  };
  return (
    <form class="name-form" onSubmit={submit}>
      <div class="field">
        <label for={`${ids}-name`}>{MANAGE_COPY.dishName}</label>
        <input
          id={`${ids}-name`}
          ref={input}
          class="input"
          type="text"
          maxLength={80}
          value={name}
          aria-invalid={error}
          aria-describedby={error ? `${ids}-error` : undefined}
          onInput={(event) => {
            setName(event.currentTarget.value);
            setError(false);
          }}
        />
        {error && (
          <p id={`${ids}-error`} class="field-error">
            {MANAGE_COPY.nameError}
          </p>
        )}
      </div>
      <div class="actions">
        <button type="submit" class="button button--primary">
          {props.submitLabel}
        </button>
        <button type="button" class="button" onClick={props.onCancel}>
          {COPY.cancel}
        </button>
      </div>
    </form>
  );
}
