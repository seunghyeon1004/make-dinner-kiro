---
inclusion: fileMatch
fileMatchPattern: ["src/web/**", "public/**", "e2e/**"]
---

# UI

## Identity: kitchen meets terminal

Warm paper and cast iron, one saturated accent (ember orange). Times, step ids, lanes and the
Dinnerfile are set in monospace, like a build log; instructions are set in a readable humanist
face. Flat surfaces, 1 px rules, no gradients, no drop shadows beyond focus, no illustrations.
The only Halloween touch is the Halloween sample menu's content.

## Design tokens (decided here; defined once in `src/web/styles/tokens.css`)

Light is the default; dark applies under `prefers-color-scheme: dark` or `[data-theme=dark]`.
A manual toggle (system, light, dark) is stored in localStorage (decided here).

| token                | light     | dark      | use                                  |
| -------------------- | --------- | --------- | ------------------------------------ |
| `--color-bg`         | `#F6F1E7` | `#1A1816` | page (paper / cast iron)             |
| `--color-surface`    | `#FFFDF8` | `#24211E` | cards, timeline rows                 |
| `--color-raised`     | `#EDE5D6` | `#2E2A26` | inputs, alternate rows               |
| `--color-ink`        | `#1F1B16` | `#F2EBDD` | body text                            |
| `--color-ink-muted`  | `#5C5346` | `#B5AA98` | secondary text, slack                |
| `--color-rule`       | `#D9CFBF` | `#3A3530` | decorative dividers only             |
| `--color-border`     | `#8A7F70` | `#7A7064` | input and control outlines (3:1)     |
| `--color-accent`     | `#B23A0A` | `#FB923C` | primary action, critical bars, links |
| `--color-on-accent`  | `#FFFFFF` | `#1A1816` | text on accent                       |
| `--color-warn`       | `#8A5A00` | `#F5C35B` | warning text and marks               |
| `--color-done`       | `#2F6B3A` | `#8BCB95` | done marks                           |
| `--color-focus`      | `#1D4ED8` | `#93B4FF` | focus ring                           |

Spacing `--space-1..7` = 4, 8, 12, 16, 24, 32, 48 px. Radius `--radius` = 6 px.
Motion `--duration` = 150 ms, `0ms` under reduced motion.

`npm run check:contrast` parses `tokens.css` and fails unless, in both themes: ink, ink-muted,
accent, warn and done on bg, surface and raised are at least 4.5:1; on-accent on accent at
least 4.5:1; border and focus on bg and surface at least 3:1. Changing a token means running it.

## Type

- `--font-text`: `Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", source-sans-pro, sans-serif`.
- `--font-mono`: `ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace`.
- System stacks only. No web font files, no font CDN, no `@font-face`.
- Base size 18 px, line height 1.5 (decided here). Cooking mode: current instruction 32 px,
  countdown 56 px mono with `font-variant-numeric: tabular-nums`. Nothing below 16 px.
- Sizes in `rem`; the layout must survive 200% browser zoom without horizontal scrolling.

## Counter distance and one-handed reach

- Every interactive target is at least 48×48 px with 8 px between targets. Cooking-mode
  primary actions ("Done", "Start") are at least 64 px tall and full width (decided here).
- Primary actions sit in the bottom third of the screen in cooking mode, reachable by a thumb.
- No hover-only affordance, no swipe-only, long-press-only or double-tap-only action.
- Destructive actions ("Start over") need a second, separate confirmation tap.
- Times show as clock times in the user's locale (`Intl.DateTimeFormat`), durations as `25 min`.

## Accessibility

- The timeline has a text alternative carrying the same information: the plan list, ordered
  by start, giving clock time, step title, dish, lane, minutes, "On the critical path" or "Can
  slip", and any wait warning. It is always in the DOM, reachable from the timeline by a visible link, and
  is the print layout. The timeline graphic is `aria-hidden="true"`; anything interactive in
  it also exists in the list.
- Nothing is told by colour alone. Steps on the critical path (see the glossary) get the mark `▲`
  and the words "On the critical path";
  warnings get `!` and "Warning"; done steps get `✓` and "Done"; lanes are labelled with
  text ("Burner 1", "Oven 1", "Cook 2"); oven bars carry a hatch pattern, burner bars a solid
  fill, hands-free steps a dashed outline (decided here).
- Visible focus on every focusable element: 3 px `--color-focus` outline, 2 px offset, via
  `:focus-visible`. Never `outline: none` without a replacement.
- `prefers-reduced-motion: reduce` removes transitions and animation; countdowns update
  digits only.
- Semantic HTML first: real `<button>`, `<label for>`, `<ol>` for ordered steps, one `<h1>`
  per screen. Rebuild results are announced in an `aria-live="polite"` region.
- WCAG 2.1 AA contrast, checked by `npm run check:contrast` and by axe in `e2e/`.

## Copy

- Plain, short, imperative: "Roast the chicken", "Add a dish", "Start cooking".
- Sentence case for labels and headings (decided here). No exclamation marks. No jokes,
  puns or emoji in instructions, labels or errors.
- Use the glossary words from `product.md`: step, dish, lane, slack, critical, rebuild,
  Dinnerfile. Never "task" or "job".
- Errors say what happened and what to do next: "The recipe text is over 12,000 characters.
  Shorten it or split it into two dinners."
- After a rebuild, say what moved in one line per step: "Gravy moved from 18:40 to 18:55".
  If nothing moved, say "Everything is on time".
