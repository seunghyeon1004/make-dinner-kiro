import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as copy from '../../src/web/copy.js';
import { applyCook, beginSession } from '../../src/web/state/cook-session.js';
import type { CookState } from '../../src/web/state/cook-slot.js';
import { RebuiltScheduleSchema } from '../../src/core/index.js';
import { AXIS_MS, cmAt, H1_SCHEDULE, SUNDAY_ROAST } from '../support/fixtures.js';

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
    COOK_COPY: copy.COOK_COPY,
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

// ---------------------------------------------------------------------------------------
// Cooking mode (T3.1). Expected strings are copied from the design's hand-worked sessions
// (CM-b, CM-c, CM-d, CM-g), not produced by src/.

const H1 = RebuiltScheduleSchema.parse(H1_SCHEDULE);
const titleOf = (id: string): string => SUNDAY_ROAST.steps.find((s) => s.id === id)?.title ?? id;
const ctx = { axisMs: AXIS_MS, titleOf, locale: 'en-GB' } as const;

function begun(nowMs: number): CookState {
  const result = beginSession(H1, AXIS_MS, nowMs);
  if (!result.ok) throw new Error(`could not begin: ${result.error.kind}`);
  return result.value;
}

type Tap =
  | { at: number; type: 'cook/start' | 'cook/done'; stepId: string }
  | { at: number; type: 'cook/behind' }
  | { at: number; type: 'cook/extra'; stepId: string; minutes: 5 | 10 | 15 };

function tap(state: CookState, ...taps: Tap[]): CookState {
  return taps.reduce((current, t) => {
    if (t.type === 'cook/behind') return applyCook(current, { type: t.type, nowMs: t.at });
    if (t.type === 'cook/extra')
      return applyCook(current, {
        type: t.type,
        stepId: t.stepId,
        minutes: t.minutes,
        nowMs: t.at,
      });
    return applyCook(current, { type: t.type, stepId: t.stepId, nowMs: t.at });
  }, state);
}

const CM_F_TAPS: Tap[] = [
  { type: 'cook/start', stepId: 'chicken.prep', at: cmAt(17, 40) },
  { type: 'cook/done', stepId: 'chicken.prep', at: cmAt(17, 50) },
  { type: 'cook/start', stepId: 'chicken.roast', at: cmAt(17, 50) },
  { type: 'cook/start', stepId: 'greens.shred', at: cmAt(17, 50) },
  { type: 'cook/done', stepId: 'greens.shred', at: cmAt(17, 55) },
];

function linesOf(state: CookState): copy.LogLines {
  const entry = state.core.log.at(-1);
  if (entry === undefined) throw new Error('no log entry');
  return copy.cookLogLines(entry, ctx);
}

describe('cooking copy: build log lines (CM5.3, CM5.4)', () => {
  it('CM5.3 CM-b: the cause, ten moves in order, the serve line, no unchanged line', () => {
    const lines = linesOf(begun(cmAt(17, 52)));
    expect(lines.cause).toEqual({
      mono: '17:52 rebuild: started 12 min late',
      sentence: 'Rebuilt at 17:52: started 12 min late.',
    });
    expect(lines.moves.map((m) => m.mono)).toEqual([
      'chicken.prep 17:40 -> 17:52',
      'chicken.roast 17:50 -> 18:02',
      'greens.shred 17:50 -> 18:02',
      'chicken.rest 19:05 -> 19:17',
      'gravy.roux 19:10 -> 19:23',
      'gravy.simmer 19:12 -> 19:25',
      'greens.boil 19:20 -> 19:30',
      'greens.toss 19:24 -> 19:34',
      'gravy.strain 19:22 -> 19:35',
      'chicken.carve 19:25 -> 19:37',
    ]);
    expect(lines.moves[0]?.sentence).toBe(
      'Season and truss the chicken moved from 17:40 to 17:52.',
    );
    expect(lines.unchanged).toBeNull();
    expect(lines.serving).toEqual({
      mono: 'serve 19:30 -> 19:42',
      sentence: 'Serving moved from 19:30 to 19:42.',
    });
    expect(lines.nothing).toBeNull();
    expect(lines.failed).toBeNull();
  });

  it('CM5.3 CM-c: the +15 on the roast, seven moves, three up to date, serve 19:30 -> 19:45', () => {
    const state = tap(begun(cmAt(17, 30)), ...CM_F_TAPS, {
      type: 'cook/extra',
      stepId: 'chicken.roast',
      minutes: 15,
      at: cmAt(18, 30),
    });
    const lines = linesOf(state);
    expect(lines.cause.mono).toBe('18:30 rebuild: chicken.roast needs 15 more min');
    expect(lines.cause.sentence).toBe('Rebuilt at 18:30: Roast the chicken needs 15 more min.');
    expect(lines.moves.map((m) => m.mono)).toEqual([
      'chicken.rest 19:05 -> 19:20',
      'gravy.roux 19:10 -> 19:26',
      'gravy.simmer 19:12 -> 19:28',
      'greens.boil 19:20 -> 19:33',
      'greens.toss 19:24 -> 19:37',
      'gravy.strain 19:22 -> 19:38',
      'chicken.carve 19:25 -> 19:40',
    ]);
    expect(lines.moves[0]?.sentence).toBe('Rest the chicken under foil moved from 19:05 to 19:20.');
    expect(lines.unchanged?.mono).toBe('3 steps up to date');
    expect(lines.serving?.mono).toBe('serve 19:30 -> 19:45');
    expect(lines.upToDate.map((l) => l.mono)).toEqual([
      'chicken.prep is up to date',
      'chicken.roast is up to date',
      'greens.shred is up to date',
    ]);
    expect(lines.upToDate[1]?.sentence).toBe('Roast the chicken is up to date.');
  });

  it("CM5.3 CM-d: I'm behind moves the shred only; nine up to date; no serve line", () => {
    const state = tap(
      begun(cmAt(17, 30)),
      { type: 'cook/start', stepId: 'chicken.prep', at: cmAt(17, 40) },
      { type: 'cook/done', stepId: 'chicken.prep', at: cmAt(17, 50) },
      { type: 'cook/start', stepId: 'chicken.roast', at: cmAt(17, 50) },
      { type: 'cook/behind', at: cmAt(17, 53) },
    );
    const lines = linesOf(state);
    expect(lines.cause).toEqual({
      mono: "17:53 rebuild: I'm behind",
      sentence: "Rebuilt at 17:53: I'm behind.",
    });
    expect(lines.moves.map((m) => m.mono)).toEqual(['greens.shred 17:50 -> 17:53']);
    expect(lines.unchanged?.mono).toBe('9 steps up to date');
    expect(lines.serving).toBeNull();
    expect(lines.nothing).toBeNull();
  });

  it("CM5.3 CM-g: I'm behind at 19:10 moves seven steps, three up to date, serve 19:30 -> 19:35; a second tap says Everything is on time", () => {
    const first = tap(begun(cmAt(17, 30)), ...CM_F_TAPS, { type: 'cook/behind', at: cmAt(19, 10) });
    const lines = linesOf(first);
    expect(lines.moves.map((m) => m.mono)).toEqual([
      'chicken.rest 19:05 -> 19:10',
      'gravy.roux 19:10 -> 19:15',
      'gravy.simmer 19:12 -> 19:17',
      'greens.boil 19:20 -> 19:25',
      'gravy.strain 19:22 -> 19:27',
      'greens.toss 19:24 -> 19:29',
      'chicken.carve 19:25 -> 19:30',
    ]);
    expect(lines.unchanged?.mono).toBe('3 steps up to date');
    expect(lines.serving?.mono).toBe('serve 19:30 -> 19:35');
    const second = linesOf(tap(first, { type: 'cook/behind', at: cmAt(19, 10) }));
    expect(second.nothing).toEqual({
      mono: 'Everything is on time',
      sentence: 'Everything is on time.',
    });
    expect(second.moves).toEqual([]);
    expect(second.unchanged?.mono).toBe('10 steps up to date');
    expect(second.serving).toBeNull();
  });

  it('CM5.3 start and done causes name the step and say late or early; one step reads in the singular', () => {
    const at = cmAt(17, 53);
    const base = {
      atMs: at,
      result: {
        ok: true as const,
        moved: [],
        unchanged: ['a.b'],
        servingFromMin: 0,
        servingToMin: 0,
        newWarnings: [],
      },
    };
    const line = (cause: copy.LogCause): string =>
      copy.cookLogLines({ ...base, cause }, ctx).cause.mono;
    expect(line({ kind: 'start', stepId: 'chicken.roast', byMin: 3 })).toBe(
      '17:53 rebuild: chicken.roast started 3 min late',
    );
    expect(line({ kind: 'done', stepId: 'chicken.prep', byMin: -3 })).toBe(
      '17:53 rebuild: chicken.prep done 3 min early',
    );
    expect(copy.cookLogLines({ ...base, cause: { kind: 'behind' } }, ctx).unchanged?.mono).toBe(
      '1 step up to date',
    );
  });

  it('CM5.7 a failed rebuild says so and that the plan is unchanged', () => {
    const lines = copy.cookLogLines(
      {
        atMs: cmAt(17, 53),
        cause: { kind: 'behind' },
        result: { ok: false, error: 'serving_out_of_range' },
      },
      ctx,
    );
    expect(lines.failed).toEqual({
      mono: 'rebuild failed: serving_out_of_range',
      sentence:
        "The plan could not be rebuilt, so it is unchanged. Carry on by the times shown and tap I'm behind to try again.",
    });
    expect(lines.moves).toEqual([]);
    expect(lines.nothing).toBeNull();
  });

  it('CM5.5 CM-c new warning: the hold sentence names the dish, the step and serving', () => {
    expect(copy.holdWarning('Spring greens', 'Toss the greens with butter', 7, 5, null)).toBe(
      'Spring greens: \u201cToss the greens with butter\u201d will be ready 7 min before serving and can wait only 5 min. More ovens, burners or cooks may help.',
    );
  });
});

describe('cooking copy: countdowns and sentences (CM1.2, CM2.3, CM2.9, CM4.4, CM8.1)', () => {
  it('CM4.1 countdowns read mm:ss with unbounded minutes and +mm:ss over', () => {
    expect(copy.cookCountdown(600_000)).toBe('10:00');
    expect(copy.cookCountdown(69 * 60_000)).toBe('69:00');
    expect(copy.cookCountdown(-130_000)).toBe('+02:10');
    expect(copy.cookCountdown(500)).toBe('00:01');
    expect(copy.cookCountdown(0)).toBe('00:00');
  });

  it('CM1.2 the countdown screen: heading, first steps, start-now sentence', () => {
    expect(copy.cookStartsAt('17:40')).toBe('Cooking starts at 17:40');
    expect(copy.cookFirst([{ title: 'Season and truss the chicken', dish: 'Roast chicken' }])).toBe(
      'First: Season and truss the chicken (Roast chicken)',
    );
    expect(
      copy.cookFirst([
        { title: 'Season and truss the chicken', dish: 'Roast chicken' },
        { title: 'Shred the greens', dish: 'Spring greens' },
      ]),
    ).toBe('First: Season and truss the chicken (Roast chicken); Shred the greens (Spring greens)');
    expect(copy.cookStartNow('19:20', 10)).toBe('Start now to serve at 19:20, 10 min earlier.');
  });

  it('CM2.3 card lines: due, due since, ready, waits, next, late', () => {
    expect(copy.cookDue('Roast chicken', 10, '17:40', false)).toBe(
      'Roast chicken \u00b7 10 min \u00b7 due 17:40',
    );
    expect(copy.cookDue('Roast chicken', 75, '17:50', true)).toBe(
      'Roast chicken \u00b7 1 h 15 min \u00b7 due since 17:50',
    );
    expect(copy.cookReady('Roast chicken', '19:05')).toBe('Roast chicken \u00b7 ready at 19:05');
    expect(copy.cookWaitsFor(['Roast the chicken'])).toBe(
      'Waits for \u201cRoast the chicken\u201d, not done yet.',
    );
    expect(copy.cookWaitsFor(['A', 'B'])).toBe(
      'Waits for \u201cA\u201d, \u201cB\u201d, not done yet.',
    );
    expect(copy.cookNext('Make a roux in the roasting tin', '19:26', 56)).toBe(
      'Next: Make a roux in the roasting tin at 19:26, in 56 min.',
    );
    expect(copy.cookIn(69)).toBe('in 1 h 9 min');
    expect(copy.cookLate(5)).toBe('Late by 5 min');
    expect(copy.cookBlockedAsk('Make a roux in the roasting tin', ['Roast the chicken'])).toBe(
      'Make a roux in the roasting tin waits for \u201cRoast the chicken\u201d, not done yet. Start it anyway?',
    );
  });

  it('CM2.7 dish chips', () => {
    expect(copy.cookDishChip('Roast chicken', 1, 4)).toBe('Roast chicken: 1 of 4 done');
    expect(copy.cookDishState('done', '')).toBe('Done');
    expect(copy.cookDishState('cooking', '')).toBe('Cooking');
    expect(copy.cookDishState('due', '')).toBe('Due now');
    expect(copy.cookDishState('next', '19:10')).toBe('Next at 19:10');
  });

  it('CM5.4 the earlier-rebuilds and up-to-date toggles', () => {
    expect(copy.cookEarlier(3)).toBe('Earlier rebuilds (3)');
    expect(copy.cookShowUpToDate(3)).toBe('Show the 3 steps that are up to date');
    expect(copy.cookShowUpToDate(1)).toBe('Show the 1 step that is up to date');
    expect(copy.cookHideUpToDate()).toBe('Hide the steps that are up to date');
    expect(copy.COOK_COPY['logEmpty']).toBe('No rebuilds yet.');
  });

  it('CM3.4 undo buttons and their words', () => {
    const roast = 'Roast the chicken';
    expect(
      copy.cookUndoButton(copy.cookUndoWords({ kind: 'extra', stepId: 'x', minutes: 15 }, roast)),
    ).toBe('Undo: +15 min on Roast the chicken');
    expect(copy.cookUndoButton(copy.cookUndoWords({ kind: 'start', stepId: 'x' }, roast))).toBe(
      'Undo: started Roast the chicken',
    );
    expect(copy.cookUndoButton(copy.cookUndoWords({ kind: 'done', stepId: 'x' }, roast))).toBe(
      'Undo: done Roast the chicken',
    );
    expect(copy.cookUndoButton(copy.cookUndoWords({ kind: 'behind' }, ''))).toBe(
      "Undo: I'm behind",
    );
    expect(copy.cookUndoButton(copy.cookUndoWords({ kind: 'start-now' }, ''))).toBe(
      'Undo: start now',
    );
  });

  it('CM8.1 the finished line: on time, later, earlier', () => {
    expect(copy.cookFinishedLine('19:30', '19:30', 0)).toBe(
      'Served at 19:30. Planned for 19:30: on time.',
    );
    expect(copy.cookFinishedLine('19:33', '19:30', 3)).toBe(
      'Served at 19:33. Planned for 19:30: 3 min later.',
    );
    expect(copy.cookFinishedLine('19:27', '19:30', -3)).toBe(
      'Served at 19:27. Planned for 19:30: 3 min earlier.',
    );
  });

  it('CM7.3 CM1.5 the stale and too-late sentences', () => {
    expect(copy.cookStaleBody('Sunday roast', 'Wed', '17:40')).toBe(
      'You started cooking Sunday roast on Wed at 17:40, more than 8 hours ago.',
    );
    expect(copy.cookTooLate('19:30', 'Fri 13 Nov')).toBe(
      'This plan was for 19:30 Fri 13 Nov, too long ago to cook against. Choose a new serving time on the Plan screen.',
    );
    expect(copy.cookTooLate('19:30', null)).toBe(
      'This plan was for 19:30, too long ago to cook against. Choose a new serving time on the Plan screen.',
    );
  });

  it('CM4.4 the alerts explanation: off, on, after a reload, and without vibration', () => {
    expect(copy.cookAlertsText('off', true)).toBe(
      'Turn on to hear a chime and feel a buzz when a timer ends. The browser allows sound only after you tap here.',
    );
    expect(copy.cookAlertsText('on', true)).toBe(
      'A chime and a buzz play when a timer ends. Silent mode may still mute them.',
    );
    expect(copy.cookAlertsText('reload', true)).toBe(
      'Sound was on before the page reloaded. Tap once to turn it on again.',
    );
    expect(copy.cookAlertsText('off', false)).toBe(
      'Turn on to hear a chime and feel a buzz when a timer ends. The browser allows sound only after you tap here. This device cannot vibrate.',
    );
  });

  it('CM9.4 announcements: rebuild, failed, time up, start reached, finished', () => {
    expect(copy.cookRebuilt(10, true, '19:42', 1)).toBe(
      'Plan rebuilt: 10 steps moved. Serving is now 19:42. 1 new warning.',
    );
    expect(copy.cookRebuilt(7, true, '19:45', 0)).toBe(
      'Plan rebuilt: 7 steps moved. Serving is now 19:45.',
    );
    expect(copy.cookRebuilt(1, false, '19:30', 0)).toBe(
      'Plan rebuilt: 1 step moved. Serving stays at 19:30.',
    );
    expect(copy.cookRebuilt(0, false, '19:30', 0)).toBe('Plan rebuilt: everything is on time.');
    expect(copy.COOK_ANNOUNCE.rebuildFailed).toBe('The plan could not be rebuilt.');
    expect(copy.cookTimeUp(['Roast the chicken'])).toBe('Time is up: Roast the chicken.');
    expect(copy.cookStartReached(['Roast the chicken', 'Shred the greens'])).toBe(
      'Time to start: Roast the chicken, Shred the greens.',
    );
    expect(copy.COOK_ANNOUNCE.finished).toBe('Everything is done. Dinner is served.');
    expect(copy.cookUndone('+15 min on Roast the chicken')).toBe(
      'Undone: +15 min on Roast the chicken.',
    );
  });

  it('CM8.3 CM7.3 the fixed strings of the screens', () => {
    const c = copy.COOK_COPY;
    expect([
      c['h1'],
      c['doNow'],
      c['running'],
      c['upNext'],
      c['dishes'],
      c['buildLog'],
      c['soundAndScreen'],
    ]).toEqual([
      'Right now',
      'Do now',
      'Running',
      'Up next',
      'Dishes',
      'Build log',
      'Sound and screen',
    ]);
    expect([c['start'], c['done'], c['startNow'], c['behind'], c['needsMoreTime']]).toEqual([
      'Start',
      'Done',
      'Start now',
      "I'm behind",
      'Needs more time',
    ]);
    expect([
      c['startThenLeave'],
      c['nothingToDo'],
      c['nothingMore'],
      c['alsoDue'],
      c['timeIsUp'],
      c['timeLeft'],
      c['countdownLabel'],
    ]).toEqual([
      'Start, then leave it',
      'Nothing to do now',
      'Nothing more for this cook.',
      'Also due',
      'Time is up',
      'Time left',
      'Time until cooking starts',
    ]);
    expect([c['startAnyway'], c['notYet'], c['nothingElse'], c['onTime']]).toEqual([
      'Start anyway',
      'Not yet',
      'Nothing else is planned.',
      'Everything is on time',
    ]);
    expect([
      c['finishedHeading'],
      c['backToPlan'],
      c['staleHeading'],
      c['resume'],
      c['discard'],
      c['discardAsk'],
      c['discardYes'],
      c['stopCooking'],
      c['stopAsk'],
      c['stopYes'],
      c['keepCooking'],
      c['goToPlan'],
    ]).toEqual([
      'Dinner is served',
      'Back to the plan',
      'Carry on with this dinner?',
      'Resume',
      'Discard',
      'Discard the recorded times?',
      'Yes, discard',
      'Stop cooking',
      'Stop cooking? The times you recorded will be cleared.',
      'Yes, stop cooking',
      'Keep cooking',
      'Go to the plan',
    ]);
    expect(c['wakeNote']).toBe(
      'The screen may turn off while you cook. To keep it on, set Auto-Lock or Screen timeout to a longer time in your device settings.',
    );
    expect(c['storedBad']).toBe(
      'Your cooking session could not be read, so it was cleared. Your dinner is still here.',
    );
    expect([c['alertsButton'], c['alertsOff'], c['alertsOn']]).toEqual([
      'Sound and vibration',
      'Off',
      'On',
    ]);
  });

  it('CM9.2 plan-ui copy checks over the new strings: no exclamation mark, no task or job, no emoji, no key marker', () => {
    const lines = [
      ...Object.values(copy.COOK_COPY),
      copy.cookStartNow('19:20', 10),
      copy.cookAlertsText('off', false),
      copy.cookTooLate('19:30', 'Fri 13 Nov'),
      copy.cookStaleBody('Sunday roast', 'Wed', '17:40'),
      copy.cookBlockedAsk('Make a roux', ['Roast']),
      copy.cookFinishedLine('19:33', '19:30', 3),
    ];
    expect(lines.length).toBeGreaterThan(40);
    const bad = lines.filter(
      (text) =>
        text === '' ||
        text.includes('!') ||
        /\b(tasks?|jobs?)\b/i.test(text) ||
        /\p{Extended_Pictographic}/u.test(text.replace(/[▲✓]/g, '')) ||
        /anthropic|sk-ant-/i.test(text),
    );
    expect(bad).toEqual([]);
  });
});
