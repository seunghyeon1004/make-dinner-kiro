import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTokens, contrastRatio } from '../../scripts/check-contrast.js';

describe('contrastRatio (WCAG 2.1 relative luminance, ui.md check:contrast)', () => {
  it('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 6);
  });

  it('a colour on itself is 1:1', () => {
    expect(contrastRatio('#B23A0A', '#B23A0A')).toBeCloseTo(1, 6);
  });

  it('is symmetric: the order of the two colours does not matter', () => {
    expect(contrastRatio('#1F1B16', '#F6F1E7')).toBe(contrastRatio('#F6F1E7', '#1F1B16'));
  });

  // Hand worked: #767676 has linear luminance 0.18116, so (1 + 0.05) / (0.18116 + 0.05) = 4.54.
  it('#767676 on white is 4.54:1 (the lightest grey that passes 4.5:1)', () => {
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });

  // Hand worked: #777777 has linear luminance 0.18447, so 1.05 / 0.23447 = 4.48.
  it('#777777 on white is 4.48:1 (just under 4.5:1)', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('reads three-digit hex and lower case: #fff is white and #000 is black', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 6);
  });

  it('rejects a colour it cannot read', () => {
    expect(() => contrastRatio('orange', '#FFFFFF')).toThrow(/orange/);
  });
});

const GOOD_LIGHT = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  raised: '#F0F0F0',
  ink: '#000000',
  'ink-muted': '#404040',
  accent: '#8B0000',
  'on-accent': '#FFFFFF',
  warn: '#5C3D00',
  done: '#1B4D1B',
  border: '#595959',
  focus: '#0000AA',
};

const GOOD_DARK = {
  bg: '#000000',
  surface: '#111111',
  raised: '#1A1A1A',
  ink: '#FFFFFF',
  'ink-muted': '#CCCCCC',
  accent: '#FFA860',
  'on-accent': '#000000',
  warn: '#FFD070',
  done: '#90E090',
  border: '#888888',
  focus: '#99B3FF',
};

type Tokens = Record<string, string>;

function declarations(tokens: Tokens): string {
  return Object.entries(tokens)
    .map(([name, value]) => `  --color-${name}: ${value};`)
    .join('\n');
}

function buildCss(light: Tokens, dark: Tokens, darkAttribute: Tokens = dark): string {
  return `/* test tokens */
:root {
${declarations(light)}
  --space-1: 4px;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${declarations(dark)}
  }
}
:root[data-theme='dark'] {
${declarations(darkAttribute)}
}
@media (prefers-reduced-motion: reduce) {
  :root { --duration: 0ms; }
}
`;
}

function failing(css: string): string[] {
  return checkTokens(css)
    .pairs.filter((pair) => !pair.ok)
    .map((pair) => `${pair.theme}:${pair.fg} on ${pair.bg}`)
    .sort();
}

describe('checkTokens (ui.md: the rule behind npm run check:contrast)', () => {
  it('a token set that meets every threshold has no failing pair and no problem', () => {
    const result = checkTokens(buildCss(GOOD_LIGHT, GOOD_DARK));
    expect(result.problems).toEqual([]);
    expect(result.pairs.filter((pair) => !pair.ok)).toEqual([]);
  });

  it('checks 20 pairs per theme: 5 text colours x 3 backgrounds, on-accent, 2 outlines x 2 backgrounds', () => {
    const { pairs } = checkTokens(buildCss(GOOD_LIGHT, GOOD_DARK));
    expect(pairs.filter((p) => p.theme === 'light')).toHaveLength(20);
    expect(pairs.filter((p) => p.theme === 'dark')).toHaveLength(20);
  });

  it('ink-muted below 4.5:1 in light fails on all three backgrounds, and only there', () => {
    const light = { ...GOOD_LIGHT, 'ink-muted': '#BBBBBB' };
    expect(failing(buildCss(light, GOOD_DARK))).toEqual([
      'light:ink-muted on bg',
      'light:ink-muted on raised',
      'light:ink-muted on surface',
    ]);
  });

  it('a border at 4.48:1 passes, because outlines need 3:1 only', () => {
    const light = { ...GOOD_LIGHT, border: '#777777' };
    expect(failing(buildCss(light, GOOD_DARK))).toEqual([]);
  });

  it('the same 4.48:1 grey as ink-muted fails, because text needs 4.5:1', () => {
    const light = { ...GOOD_LIGHT, 'ink-muted': '#777777' };
    expect(failing(buildCss(light, GOOD_DARK))).toEqual([
      'light:ink-muted on bg',
      'light:ink-muted on raised',
      'light:ink-muted on surface',
    ]);
  });

  it('on-accent on accent is checked at 4.5:1 in dark', () => {
    const dark = { ...GOOD_DARK, 'on-accent': '#FFA860' };
    expect(failing(buildCss(GOOD_LIGHT, dark))).toEqual(['dark:on-accent on accent']);
  });

  it('a dark focus colour below 3:1 fails on bg and surface', () => {
    const dark = { ...GOOD_DARK, focus: '#222222' };
    expect(failing(buildCss(GOOD_LIGHT, dark))).toEqual([
      'dark:focus on bg',
      'dark:focus on surface',
    ]);
  });

  it('reports a token that is missing from a theme', () => {
    const withoutWarn: Tokens = { ...GOOD_DARK };
    delete withoutWarn['warn'];
    const result = checkTokens(buildCss(GOOD_LIGHT, withoutWarn));
    expect(result.problems.some((p) => p.includes('--color-warn') && p.includes('dark'))).toBe(
      true,
    );
  });

  it('reports a dark theme whose media block and [data-theme=dark] block disagree', () => {
    const attribute = { ...GOOD_DARK, ink: '#EEEEEE' };
    const result = checkTokens(buildCss(GOOD_LIGHT, GOOD_DARK, attribute));
    expect(result.problems.some((p) => p.includes('--color-ink') && p.includes('differ'))).toBe(
      true,
    );
  });

  it('reports a colour it cannot read instead of passing it', () => {
    const light = { ...GOOD_LIGHT, ink: 'rebeccapurple' };
    const result = checkTokens(buildCss(light, GOOD_DARK));
    expect(
      result.problems.some((p) => p.includes('--color-ink') && p.includes('rebeccapurple')),
    ).toBe(true);
  });

  it('reports a stylesheet with no light theme', () => {
    const result = checkTokens('body { color: red; }');
    expect(result.pairs).toEqual([]);
    expect(result.problems.some((p) => p.includes('light'))).toBe(true);
  });
});

describe('src/web/styles/tokens.css', () => {
  const css = readFileSync(new URL('../../src/web/styles/tokens.css', import.meta.url), 'utf8');

  it('meets every contrast threshold in ui.md in both themes', () => {
    const result = checkTokens(css);
    expect(result.problems).toEqual([]);
    expect(failing(css)).toEqual([]);
    expect(result.pairs).toHaveLength(40);
  });

  it('defines the twelve colour tokens of ui.md with the light values', () => {
    const light = new Map<string, string>();
    for (const match of css
      .slice(0, css.indexOf('@media'))
      .matchAll(/--color-([\w-]+):\s*(#\w+)/g)) {
      light.set(match[1] ?? '', (match[2] ?? '').toUpperCase());
    }
    expect(Object.fromEntries(light)).toEqual({
      bg: '#F6F1E7',
      surface: '#FFFDF8',
      raised: '#EDE5D6',
      ink: '#1F1B16',
      'ink-muted': '#5C5346',
      rule: '#D9CFBF',
      border: '#8A7F70',
      accent: '#B23A0A',
      'on-accent': '#FFFFFF',
      warn: '#8A5A00',
      done: '#2F6B3A',
      focus: '#1D4ED8',
    });
  });
});
