import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as copy from '../../src/web/copy.js';

const original = process.env['TZ'];
beforeAll(() => {
  process.env['TZ'] = 'Europe/London';
  expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
});
afterAll(() => {
  if (original === undefined) delete process.env['TZ'];
  else process.env['TZ'] = original;
});

const AT_1702 = Date.parse('2026-11-11T17:02:00Z');

/** Every constant string of copy.ts, by name. */
function constants(): [string, string][] {
  const tables = {
    COPY: copy.COPY,
    EDIT_ERRORS: copy.EDIT_ERRORS,
    STEPS_COPY: copy.STEPS_COPY,
    EDITOR_COPY: copy.EDITOR_COPY,
    MANAGE_COPY: copy.MANAGE_COPY,
    PASTE_COPY: copy.PASTE_COPY,
    DINNERFILE_COPY: copy.DINNERFILE_COPY,
    SHARE_COPY: copy.SHARE_COPY,
    EXPORT_COPY: copy.EXPORT_COPY,
  };
  return Object.entries(tables).flatMap(([table, entries]) =>
    Object.entries(entries).map(([key, value]): [string, string] => [`${table}.${key}`, value]),
  );
}

/** Every copy function on fixed arguments, singular and plural, by call. */
function results(): [string, string][] {
  const failures = [
    { kind: 'bad_request' },
    { kind: 'input_too_long' },
    { kind: 'model_unavailable' },
    { kind: 'model_refused' },
    { kind: 'model_output_invalid' },
    { kind: 'internal' },
    { kind: 'network' },
    { kind: 'rate_limited', retryAtMs: AT_1702 },
    { kind: 'rate_limited', retryAtMs: null },
    { kind: 'daily_cap_reached', retryAtMs: AT_1702 },
    { kind: 'daily_cap_reached', retryAtMs: null },
    { kind: 'unexpected', status: 502 },
  ] as const;
  const calls: [string, string][] = [
    ['documentTitle', copy.documentTitle('Plan')],
    ['dishesLine', copy.dishesLine(['Roast chicken', 'Gravy'])],
    ['replaceAsk', copy.replaceAsk('Sunday roast')],
    ['listWait', copy.listWait(40, 10)],
    ['slackLabel', copy.slackLabel(75)],
    ['laneName', copy.laneName('oven', 1)],
    ['fewer', copy.fewer('Burners')],
    ['more', copy.more('Burners')],
    ['startAt', copy.startAt('17:40')],
    ['serveAt', copy.serveAt('00:30', 'tomorrow')],
    ['takes', copy.takes('1 h 50 min')],
    ['holdWarning terminal', copy.holdWarning('Pie', 'Bake the pie', 40, 10, null)],
    ['holdWarning user', copy.holdWarning('Pie', 'Bake the pie', 40, 10, 'Serve the pie')],
    ['missingAppliance oven', copy.missingAppliance('oven', ['Roast the chicken'])],
    ['missingAppliance burner', copy.missingAppliance('burner', ['Boil the greens', 'Make gravy'])],
    ['pastStart', copy.pastStart('1 h 50 min', '19:35')],
    ['serveAtButton', copy.serveAtButton('19:35')],
    ['serveLabel', copy.serveLabel('19:30')],
    ['removedStep 0', copy.removedStep('Roast the chicken', [])],
    ['removedStep 2', copy.removedStep('Roast the chicken', ['Rest', 'Make roux'])],
    ['removedDish 0', copy.removedDish('Gravy', [])],
    ['stepsIntro', copy.stepsIntro('Sunday roast')],
    ['issueSummary 1 1', copy.issueSummary(1, 1)],
    ['issueSummary 2 2', copy.issueSummary(2, 2)],
    ['makeBlocked 1', copy.makeBlocked(1)],
    ['makeBlocked 2', copy.makeBlocked(2)],
    ['applianceLabel', copy.applianceLabel('oven')],
    ['handsLabel', copy.handsLabel(true)],
    ['holdLabel keeps', copy.holdLabel(null)],
    ['holdLabel 5', copy.holdLabel(5)],
    ['waitsFor 0', copy.waitsFor([])],
    ['waitsFor 2', copy.waitsFor(['Prep', 'Roast'])],
    ['removeStepAsk 0', copy.removeStepAsk('Roast the chicken', [])],
    ['removeStepAsk 1', copy.removeStepAsk('Roast the chicken', ['Rest'])],
    ['removeStepAsk 2', copy.removeStepAsk('Roast the chicken', ['Rest', 'Make roux'])],
    ['removeDishAsk 1', copy.removeDishAsk('Gravy', 1, [])],
    ['removeDishAsk 3', copy.removeDishAsk('Gravy', 3, ['Carve'])],
    ['recipeCounter', copy.recipeCounter(12000)],
    ['elapsedSeconds', copy.elapsedSeconds(5)],
    ['showLine', copy.showLine(57)],
    ['shareTooLong', copy.shareTooLong(9000)],
  ];
  for (const failure of failures) {
    calls.push([`parseFailureText ${failure.kind}`, copy.parseFailureText(failure, 'en-GB')]);
  }
  return calls;
}

const all = (): [string, string][] => [...constants(), ...results()];

describe('copy: ui.md "Copy" rules (R10.3, N5, N6)', () => {
  it('N5 the copy has strings to check', () => {
    expect(constants().length).toBeGreaterThan(100);
    expect(results().length).toBeGreaterThan(40);
  });

  it('R10.3 no exclamation mark except the warning mark that opens a plan list warning', () => {
    const bad = all().filter(([, text]) => text.replace(/^! Warning: /, '').includes('!'));
    expect(bad).toEqual([]);
  });

  it('R10.3 the warning mark is followed by "Warning"', () => {
    for (const [name, text] of all()) {
      if (text.startsWith('!'))
        expect([name, text.startsWith('! Warning: ')]).toEqual([name, true]);
    }
  });

  it('N6 no "task" or "job" (the glossary says step)', () => {
    const bad = all().filter(([, text]) => /\b(tasks?|jobs?)\b/i.test(text));
    expect(bad).toEqual([]);
  });

  it('R10.3 no emoji; the marks ▲ ✓ and the dashes are not emoji', () => {
    const bad = all().filter(([, text]) =>
      /\p{Extended_Pictographic}/u.test(text.replace(/[▲✓]/g, '')),
    );
    expect(bad).toEqual([]);
  });

  it('N5 no ANTHROPIC and no key marker', () => {
    const bad = all().filter(([, text]) => /anthropic|sk-ant-/i.test(text));
    expect(bad).toEqual([]);
  });

  it('R10.3 labels, headings and buttons are in sentence case: only the first word and proper names are capitalised', () => {
    // Proper names: the product, the file, and the screens a string points to.
    const PROPER = new Set(['Dinnerfile', 'Make', 'Dinner', 'GNU', 'Steps', 'Menu', 'Plan']);
    // A label is a short string without sentence punctuation.
    const labels = constants().filter(
      ([, text]) => text.split(' ').length <= 6 && !/[.?:!]/.test(text),
    );
    expect(labels.length).toBeGreaterThan(60);
    const bad = labels.filter(([, text]) =>
      text
        .replace(/^[▲✓!] /, '')
        .split(' ')
        .slice(1)
        .some((word) => /^[A-Z]/.test(word) && !PROPER.has(word)),
    );
    expect(bad).toEqual([]);
  });

  it('R10.3 sentences start with a capital letter or a bracket and end with a full stop, question mark or colon', () => {
    const sentences = all().filter(([, text]) => text.split(' ').length > 6);
    const bad = sentences.filter(
      ([, text]) => !/^[A-Z(\u201c!▲]/.test(text) || !/[.?:)]$|\bmin$/.test(text),
    );
    expect(bad).toEqual([]);
  });
});

describe('copy: plurals (1 and 2)', () => {
  it('R4.10 error and warning counts read 1 error and 1 warning, 2 errors and 2 warnings', () => {
    expect(copy.issueSummary(1, 1)).toBe('1 error and 1 warning.');
    expect(copy.issueSummary(2, 2)).toBe('2 errors and 2 warnings.');
    expect(copy.issueSummary(0, 0)).toBe('0 errors and 0 warnings.');
  });
  it('R4.10 the blocked reason reads Fix 1 error, Fix 2 errors', () => {
    expect(copy.makeBlocked(1)).toBe('Fix 1 error to make the plan.');
    expect(copy.makeBlocked(2)).toBe('Fix 2 errors to make the plan.');
  });
  it('R4.7 removing a step names one dependent in the singular and two in the plural', () => {
    expect(copy.removeStepAsk('Roast', ['Rest'])).toBe(
      'Remove \u201cRoast\u201d? 1 step waits for it: Rest. It will no longer wait for it.',
    );
    expect(copy.removeStepAsk('Roast', ['Rest', 'Roux'])).toBe(
      'Remove \u201cRoast\u201d? 2 steps wait for it: Rest, Roux. They will no longer wait for it.',
    );
  });
  it('R4.7 removing a dish counts its steps: 1 step, 3 steps', () => {
    expect(copy.removeDishAsk('Gravy', 1, [])).toBe('Remove the dish Gravy and its 1 step?');
    expect(copy.removeDishAsk('Gravy', 3, [])).toBe('Remove the dish Gravy and its 3 steps?');
  });
  it('R4.7 the removal notice says "no longer waits" for one step and "no longer wait" for several', () => {
    expect(copy.removedStep('Roast', ['Rest'])).toBe(
      'Removed \u201cRoast\u201d. Rest no longer waits for it.',
    );
    expect(copy.removedStep('Roast', ['Rest', 'Roux'])).toBe(
      'Removed \u201cRoast\u201d. Rest, Roux no longer wait for it.',
    );
  });
});
