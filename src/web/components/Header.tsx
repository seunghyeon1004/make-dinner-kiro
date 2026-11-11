import type { VNode } from 'preact';
import { COPY } from '../copy.js';
import { hashOf } from '../state/route.js';
import { StartOver } from './StartOver.js';
import { ThemeSwitch } from './ThemeSwitch.js';

/** On every screen: the brand link to the Menu, the theme switch and "Start over" (R9.1). */
export function Header(): VNode {
  return (
    <header class="app-header no-print">
      <a class="brand" href={hashOf('menu')}>
        {COPY.brand}
      </a>
      <div class="app-header__tools">
        <ThemeSwitch />
        <StartOver />
      </div>
    </header>
  );
}
