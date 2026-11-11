import type { VNode } from 'preact';
import { COPY } from '../copy.js';
import { useAppState, useDispatch } from '../state/hooks.js';
import type { ThemeChoice } from '../state/store.js';

const CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'system', label: COPY.themeSystem },
  { value: 'light', label: COPY.themeLight },
  { value: 'dark', label: COPY.themeDark },
];

function isThemeChoice(value: string): value is ThemeChoice {
  return CHOICES.some((choice) => choice.value === value);
}

export function ThemeSwitch(): VNode {
  const theme = useAppState((state) => state.theme);
  const dispatch = useDispatch();
  return (
    <label class="theme-switch">
      <span>{COPY.theme}</span>
      <select
        class="select"
        value={theme}
        onChange={(event) => {
          const value = event.currentTarget.value;
          if (isThemeChoice(value)) dispatch({ type: 'theme/set', theme: value });
        }}
      >
        {CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}
