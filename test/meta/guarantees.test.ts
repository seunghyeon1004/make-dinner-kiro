import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLAIMS } from './guarantee-claims.js';

// Coverage check for scheduler-guarantees.md (scheduler design, "test/meta/guarantees.test.ts").
// Everything here is text: no import from src/. A family named in CLAIMS (or already seen in a
// property title) needs a property title for every one of its ids; the check is red until the
// properties exist, so it cannot pass by saying nothing.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_DIR = fileURLToPath(new URL('../', import.meta.url));
const STEERING = `${ROOT}.kiro/steering/scheduler-guarantees.md`;

// ---------------------------------------------------------------------------------------
// Parsers

const ID_LINE = /^\s*-\s+(?:\*\*)?([A-Z][0-9]+(?:\.[0-9]+)*)(?=[\s.*])/;

/** The guarantee ids of the steering file, in order of appearance, without repeats. */
function parseIds(markdown: string): string[] {
  const ids: string[] = [];
  for (const line of markdown.split('\n')) {
    const id = ID_LINE.exec(line)?.[1];
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

const familyOf = (id: string): string => id.charAt(0);

const TEST_OPEN = /(?<![\w.$])(?:it|test)\(\s*(['"`])/g;

/**
 * The first argument of every `it(` or `test(` call: a quoted or template literal, cut at its
 * closing quote or, in a template, at the first `${`. `it.each` and `.test(` are not matched.
 */
function extractTitles(source: string): string[] {
  const titles: string[] = [];
  for (const match of source.matchAll(TEST_OPEN)) {
    const quote = match[1] ?? "'";
    let i = (match.index ?? 0) + match[0].length;
    let title = '';
    while (i < source.length) {
      const ch = source.charAt(i);
      if (ch === '\\') {
        title += source.charAt(i + 1);
        i += 2;
        continue;
      }
      if (ch === quote) break;
      if (quote === '`' && ch === '$' && source.charAt(i + 1) === '{') break;
      title += ch;
      i++;
    }
    titles.push(title);
  }
  return titles;
}

/** Every title of every `test/**\/*.pbt.ts`. */
function propertyTitles(): string[] {
  const files = readdirSync(TEST_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.pbt.ts'))
    .sort();
  return files.flatMap((f) => extractTitles(readFileSync(`${TEST_DIR}${f}`, 'utf8')));
}

// ---------------------------------------------------------------------------------------
// Rules

const TITLE_ID = /^([A-Z][0-9]+(?:\.[0-9]+)*)(?= |$)/;

/** Families to cover: those in CLAIMS plus the family of every known id that begins a title. */
function requiredFamilies(
  claims: Readonly<Record<string, readonly string[]>>,
  ids: readonly string[],
  titles: readonly string[],
): Set<string> {
  const families = new Set<string>(Object.values(claims).flat());
  for (const title of titles) {
    const id = TITLE_ID.exec(title)?.[1];
    if (id !== undefined && ids.includes(id)) families.add(familyOf(id));
  }
  return families;
}

/**
 * Ids of the required families with no property. A leaf is covered by a title equal to the id
 * or starting with the id and a space (`G4.10 ...` does not cover `G4.1`); a parent is covered
 * iff all its leaves are.
 */
function uncoveredIds(
  ids: readonly string[],
  titles: readonly string[],
  families: ReadonlySet<string>,
): string[] {
  const hasTitle = (id: string): boolean => titles.some((t) => t === id || t.startsWith(`${id} `));
  const isLeaf = (id: string): boolean => !ids.some((o) => o.startsWith(`${id}.`));
  const leavesUnder = (id: string): string[] =>
    ids.filter((o) => o.startsWith(`${id}.`) && isLeaf(o));
  return ids
    .filter((id) => families.has(familyOf(id)))
    .filter((id) => (isLeaf(id) ? !hasTitle(id) : leavesUnder(id).some((leaf) => !hasTitle(leaf))));
}

/** Titles that begin like an id but not with a known one (`G9 ...`, `G4.4 ...`, `G4.10 ...`). */
function unknownTitleIds(titles: readonly string[], ids: readonly string[]): string[] {
  return titles.flatMap((title) => {
    const id = TITLE_ID.exec(title)?.[1];
    return id !== undefined && !ids.includes(id) ? [id] : [];
  });
}

// ---------------------------------------------------------------------------------------
// Checks

const KNOWN_IDS = [
  'G1',
  'G2',
  'G3',
  'G4',
  'G4.1',
  'G4.2',
  'G4.3',
  'G5',
  'G5.1',
  'G5.2',
  'G5.3',
  'G6',
  'G7',
  'G7.1',
  'G7.2',
  'G8',
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
  'R6',
  'S1',
  'S2',
  'D1',
  'D2',
];

const steeringIds = parseIds(readFileSync(STEERING, 'utf8'));
const titles = propertyTitles();

describe('parser: ids of scheduler-guarantees.md', () => {
  it('parser: the steering file has every id the design lists (a superset check)', () => {
    expect(steeringIds).toEqual(expect.arrayContaining(KNOWN_IDS));
  });
  it('parser: ids are not repeated and nothing but ids with a leading letter and digits is read', () => {
    expect(new Set(steeringIds).size).toBe(steeringIds.length);
    for (const id of steeringIds) expect(id).toMatch(/^[A-Z][0-9]+(\.[0-9]+)*$/);
  });
  it('parser: reads bold and plain bullets, nested sub-ids, and ignores prose bullets', () => {
    const markdown = [
      '- **G1 capacity.** For every minute.',
      '- **G4 landing.**',
      '  - G4.1 With unlimited resources.',
      '  - G4.12 A twelfth.',
      '- Valid input: a `Plan`.',
      '- `start(s)`, `end(s)` are integers.',
      '- **R2 pinned.** Done steps.',
      'G9 not a bullet',
      '- **G1 capacity.** Repeated.',
    ].join('\n');
    expect(parseIds(markdown)).toEqual(['G1', 'G4', 'G4.1', 'G4.12', 'R2']);
  });
  it('parser: a parent is an id that another id extends, a family is the leading letter', () => {
    expect(steeringIds.filter((id) => steeringIds.some((o) => o.startsWith(`${id}.`)))).toEqual(
      expect.arrayContaining(['G4', 'G5', 'G7']),
    );
    expect(familyOf('G4.1')).toBe('G');
    expect(familyOf('S2')).toBe('S');
  });
});

describe('parser: titles of property tests', () => {
  it('parser: cuts a template title at ${ and reads quoted titles', () => {
    const source = [
      "it('G1 capacity: plain', () => {});",
      'it(`S2 sound: ${rule} fires`, () => {});',
      'test("G6 lanes: double quoted", () => {});',
      'it(`G7.1 no substitution`, () => {});',
    ].join('\n');
    expect(extractTitles(source)).toEqual([
      'G1 capacity: plain',
      'S2 sound: ',
      'G6 lanes: double quoted',
      'G7.1 no substitution',
    ]);
  });
  it('parser: reads a prettier-wrapped call, an escaped quote, and skips .test( and it.each', () => {
    const source = [
      'it(',
      "  'G2 precedence: it\\'s wrapped',",
      '  () => {},',
      ');',
      'expect(/a/.test(line)).toBe(true);',
      "it.each([1])('G3 completeness: skipped %s', () => {});",
      "describe('G8 slack', () => {});",
    ].join('\n');
    expect(extractTitles(source)).toEqual(["G2 precedence: it's wrapped"]);
  });
  it('parser: finds the titles of the real property files, S1 and S2 among them', () => {
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some((t) => t.startsWith('S1 '))).toBe(true);
    expect(titles.some((t) => t.startsWith('S2 '))).toBe(true);
  });
});

describe('unknown ids in property titles', () => {
  it('unknown: every title that begins like an id begins with a known one', () => {
    expect(unknownTitleIds(titles, steeringIds)).toEqual([]);
  });
  it('unknown: flags G12, G4.4 and G4.10, not P-RG3, P-SC1 or a bare known id', () => {
    const inline = [
      'G12 typo',
      'G4.4 typo',
      'G4.10 not G4.1',
      'P-RG3 topological order',
      'P-SC1 errors',
      'G6',
      'G6 lanes',
    ];
    expect(unknownTitleIds(inline, steeringIds)).toEqual(['G12', 'G4.4', 'G4.10']);
  });
});

describe('claims', () => {
  it('claims: recipe-graph claims S and scheduler claims G (an entry is never removed)', () => {
    expect(CLAIMS['recipe-graph']).toEqual(expect.arrayContaining(['S']));
    expect(CLAIMS['scheduler']).toEqual(expect.arrayContaining(['G']));
  });
  it('claims: every key has a requirements.md and every family has an id in the steering file', () => {
    const families = new Set(steeringIds.map(familyOf));
    for (const [spec, claimed] of Object.entries(CLAIMS)) {
      expect(existsSync(`${ROOT}.kiro/specs/${spec}/requirements.md`), spec).toBe(true);
      for (const family of claimed) expect(families.has(family), `${spec}: ${family}`).toBe(true);
    }
  });
});

describe('coverage rule, on inline data', () => {
  const ids = ['G1', 'G4', 'G4.1', 'G4.2', 'S1', 'R1'];
  const g = new Set(['G']);

  it('with no titles every id of a required family is reported, parents included', () => {
    expect(uncoveredIds(ids, [], g)).toEqual(['G1', 'G4', 'G4.1', 'G4.2']);
  });
  it('a title equal to the id, or starting with the id and a space, covers a leaf', () => {
    expect(uncoveredIds(ids, ['G1', 'G4.1 landing', 'G4.2 bound'], g)).toEqual([]);
  });
  it('G4.10 does not cover G4.1, and a title for a parent does not cover its children', () => {
    expect(uncoveredIds(ids, ['G1 a', 'G4.10 b', 'G4.2 c', 'G4 d'], g)).toEqual(['G4', 'G4.1']);
  });
  it('a parent is uncovered while one child is, covered when all are', () => {
    expect(uncoveredIds(ids, ['G1 a', 'G4.1 b'], g)).toEqual(['G4', 'G4.2']);
    expect(uncoveredIds(ids, ['G1 a', 'G4.1 b', 'G4.2 c'], g)).toEqual([]);
  });
  it('a family that is not required is not reported', () => {
    expect(uncoveredIds(ids, [], new Set(['S']))).toEqual(['S1']);
  });
  it('required families are the claimed ones plus those already seen in titles', () => {
    expect([...requiredFamilies({ a: ['S'] }, ids, [])]).toEqual(['S']);
    expect([...requiredFamilies({}, ids, ['G1 something', 'x'])]).toEqual(['G']);
    expect([...requiredFamilies({ a: ['S'] }, ids, ['R1 rebuild'])].sort()).toEqual(['R', 'S']);
    // A title that only looks like an id does not add a family.
    expect([...requiredFamilies({}, ids, ['Z9 nothing'])]).toEqual([]);
  });
});

describe('coverage of the guarantees by properties', () => {
  const required = requiredFamilies(CLAIMS, steeringIds, titles);

  it('coverage: the claimed families G and S are required, so the check is not vacuous', () => {
    expect(required.has('G')).toBe(true);
    expect(required.has('S')).toBe(true);
    expect(uncoveredIds(steeringIds, [], required).length).toBeGreaterThanOrEqual(15);
  });

  it('coverage: every id of every required family has a property whose title starts with it', () => {
    const missing = uncoveredIds(steeringIds, titles, required);
    expect(missing, `no property title starts with: ${missing.join(', ')}`).toEqual([]);
  });
});
