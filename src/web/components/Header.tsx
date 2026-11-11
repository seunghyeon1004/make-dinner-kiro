import type { VNode } from 'preact';
import { useId, useState } from 'preact/hooks';
import { COPY } from '../copy.js';
import { hashOf } from '../state/route.js';
import { StartOver } from './StartOver.js';
import { ThemeSwitch } from './ThemeSwitch.js';

/**
 * On every screen: the brand link to the Menu, the theme switch and "Start over" (R9.1). On a
 * phone the last two sit behind one "Settings" disclosure button; from 40rem up they are inline
 * and the button is not shown (plan-ui review B).
 */
export function Header(): VNode {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <header class="app-header no-print">
      <a class="brand" href={hashOf('menu')}>
        {COPY.brand}
      </a>
      <button
        type="button"
        class="button settings-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {COPY.settings}
      </button>
      <div
        id={panelId}
        class={open ? 'app-header__tools app-header__tools--open' : 'app-header__tools'}
      >
        <ThemeSwitch />
        <StartOver />
      </div>
    </header>
  );
}
