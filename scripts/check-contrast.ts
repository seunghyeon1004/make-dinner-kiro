import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type Theme = 'light' | 'dark';
type Tokens = Map<string, string>;

export interface PairResult {
  theme: Theme;
  fg: string;
  bg: string;
  ratio: number;
  min: number;
  ok: boolean;
}

export interface CheckResult {
  pairs: PairResult[];
  problems: string[];
}

const TEXT_MIN = 4.5;
const OUTLINE_MIN = 3;

/** The rule in ui.md: which token is checked on which backgrounds, and at what ratio. */
const RULES: { fg: string[]; bg: string[]; min: number }[] = [
  {
    fg: ['ink', 'ink-muted', 'accent', 'warn', 'done'],
    bg: ['bg', 'surface', 'raised'],
    min: TEXT_MIN,
  },
  { fg: ['on-accent'], bg: ['accent'], min: TEXT_MIN },
  { fg: ['border', 'focus'], bg: ['bg', 'surface'], min: OUTLINE_MIN },
];

function parseHex(value: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  const digits = match?.[1];
  if (digits === undefined) return null;
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two hex colours. Throws on a colour it cannot read. */
export function contrastRatio(a: string, b: string): number {
  const rgbA = parseHex(a);
  const rgbB = parseHex(b);
  if (rgbA === null) throw new Error(`Cannot read colour "${a}"`);
  if (rgbB === null) throw new Error(`Cannot read colour "${b}"`);
  const [hi, lo] = [luminance(rgbA), luminance(rgbB)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

interface Block {
  context: string[];
  body: string;
}

/** Every `{ ... }` block that holds declarations, with the preludes of the blocks around it. */
function declarationBlocks(css: string): Block[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  const blocks: Block[] = [];
  let buffer = '';
  for (const char of text) {
    if (char === '{') {
      stack.push(buffer.trim());
      buffer = '';
    } else if (char === '}') {
      if (buffer.trim() !== '') blocks.push({ context: [...stack], body: buffer });
      stack.pop();
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return blocks;
}

function colourTokens(body: string): Tokens {
  const tokens: Tokens = new Map();
  for (const match of body.matchAll(/--color-([\w-]+)\s*:\s*([^;}]+)/g)) {
    tokens.set(match[1] ?? '', (match[2] ?? '').trim());
  }
  return tokens;
}

type Source = 'light' | 'dark-media' | 'dark-attribute';

function sourceOf(context: string[]): Source | null {
  const joined = context.join(' ');
  if (/prefers-color-scheme\s*:\s*dark/.test(joined)) return 'dark-media';
  if (/data-theme\s*=\s*["']?dark/.test(joined)) return 'dark-attribute';
  if (context.length === 1 && context[0] === ':root') return 'light';
  return null;
}

function mergeInto(target: Tokens | undefined, add: Tokens): Tokens {
  const merged = target ?? new Map<string, string>();
  for (const [name, value] of add) merged.set(name, value);
  return merged;
}

/** Checks every pair of ui.md in both themes. `problems` are structural; failing pairs have `ok: false`. */
export function checkTokens(css: string): CheckResult {
  const problems: string[] = [];
  const sources: Partial<Record<Source, Tokens>> = {};
  for (const block of declarationBlocks(css)) {
    const source = sourceOf(block.context);
    const tokens = colourTokens(block.body);
    if (source !== null && tokens.size > 0) sources[source] = mergeInto(sources[source], tokens);
  }

  const light = sources.light;
  if (light === undefined) {
    return { pairs: [], problems: ['No light theme found: expected --color-* tokens in :root'] };
  }

  // Both ways of selecting dark must carry the same values, or one of them goes unchecked.
  const darkMedia = sources['dark-media'];
  const darkAttribute = sources['dark-attribute'];
  if (darkMedia === undefined || darkAttribute === undefined) {
    return {
      pairs: [],
      problems: [
        'Dark theme incomplete: need both the prefers-color-scheme and [data-theme=dark] blocks',
      ],
    };
  }
  for (const name of new Set([...darkMedia.keys(), ...darkAttribute.keys()])) {
    if (darkMedia.get(name) !== darkAttribute.get(name)) {
      problems.push(
        `--color-${name} differs between the dark media block (${darkMedia.get(name) ?? 'missing'}) and [data-theme=dark] (${darkAttribute.get(name) ?? 'missing'})`,
      );
    }
  }

  const pairs: PairResult[] = [];
  const themes: [Theme, Tokens][] = [
    ['light', light],
    ['dark', darkMedia],
  ];
  for (const [theme, tokens] of themes) {
    for (const rule of RULES) {
      for (const fg of rule.fg) {
        for (const bg of rule.bg) {
          const fgValue = tokens.get(fg);
          const bgValue = tokens.get(bg);
          const missing = [fg, bg].filter((name) => !tokens.has(name));
          if (fgValue === undefined || bgValue === undefined) {
            for (const name of missing) {
              const message = `--color-${name} is missing in the ${theme} theme`;
              if (!problems.includes(message)) problems.push(message);
            }
            continue;
          }
          if (parseHex(fgValue) === null || parseHex(bgValue) === null) {
            const [name, value] = parseHex(fgValue) === null ? [fg, fgValue] : [bg, bgValue];
            const message = `--color-${name} in the ${theme} theme is "${value}", which is not a hex colour`;
            if (!problems.includes(message)) problems.push(message);
            continue;
          }
          const ratio = contrastRatio(fgValue, bgValue);
          pairs.push({ theme, fg, bg, ratio, min: rule.min, ok: ratio >= rule.min });
        }
      }
    }
  }
  return { pairs, problems };
}

function main(): number {
  const path = new URL('../src/web/styles/tokens.css', import.meta.url);
  const { pairs, problems } = checkTokens(readFileSync(path, 'utf8'));
  for (const pair of pairs) {
    const mark = pair.ok ? 'ok  ' : 'FAIL';
    console.log(
      `${mark} ${pair.theme.padEnd(5)} ${pair.fg} on ${pair.bg}: ${pair.ratio.toFixed(2)}:1 (needs ${pair.min}:1)`,
    );
  }
  for (const problem of problems) console.error(`PROBLEM ${problem}`);
  const failed = pairs.filter((pair) => !pair.ok).length;
  console.log(
    `${pairs.length} pairs checked, ${failed} below threshold, ${problems.length} problems`,
  );
  return failed === 0 && problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
