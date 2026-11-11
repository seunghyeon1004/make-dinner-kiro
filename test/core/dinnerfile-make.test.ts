import { readdirSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { toDinnerfile } from '../../src/core/dinnerfile.js';
import type { Plan } from '../../src/core/schema.js';
import {
  MEZZE,
  SUNDAY_ROAST,
  SUNDAY_ROAST_MAKE_DINNER,
  SUNDAY_ROAST_MAKE_GRAVY,
  TIGHT_OVEN,
  WORST_CASE,
  WORST_CASE_MAKE_DINNER,
} from '../support/fixtures.js';
import { gnuMakeVersion, makeDir, runMake } from '../support/make.js';
import { decodeEchoLine, oracleEchoText, respectsPrecedence } from '../support/oracles.js';

// Dinnerfile spec, T2.2: GNU Make on the output of toDinnerfile (not on the fixtures). These
// tests need GNU Make on PATH and fail, not skip, without it (R9.3).

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const freshDir = (): string => {
  const dir = makeDir();
  dirs.push(dir);
  return dir;
};

/** The export, or the empty text when it fails; the first test of each block checks `ok`. */
const exported = (plan: Plan): string => {
  const result = toDinnerfile(plan);
  return result.ok ? result.value : '';
};

/** The lines Make printed, without the final LF. */
const printed = (stdout: string): string[] => stdout.replace(/\n$/, '').split('\n');

describe('R9.3 GNU Make is on PATH', () => {
  it('make --version starts with GNU Make', () => {
    expect(gnuMakeVersion().startsWith('GNU Make')).toBe(true);
  });
  it.each([
    ['SUNDAY_ROAST', SUNDAY_ROAST],
    ['WORST_CASE', WORST_CASE],
    ['MEZZE', MEZZE],
    ['TIGHT_OVEN', TIGHT_OVEN],
  ])('the plan %s exports without error', (_name, plan) => {
    expect(toDinnerfile(plan).ok).toBe(true);
  });
});

describe('R3.5, R9.1, R9.2 make -n on the export of SUNDAY_ROAST', () => {
  const text = exported(SUNDAY_ROAST);

  it('make -n dinner prints exactly SUNDAY_ROAST_MAKE_DINNER, exit 0, empty stderr', () => {
    const run = runMake(freshDir(), text, ['-n', 'dinner']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(printed(run.stdout)).toEqual(SUNDAY_ROAST_MAKE_DINNER);
  });
  it('make -n gravy prints exactly SUNDAY_ROAST_MAKE_GRAVY', () => {
    const run = runMake(freshDir(), text, ['-n', 'gravy']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(printed(run.stdout)).toEqual(SUNDAY_ROAST_MAKE_GRAVY);
  });
  it('R1.5: make -n with no goal prints the same as make -n dinner', () => {
    const dir = freshDir();
    const noGoal = runMake(dir, text, ['-n']);
    const dinner = runMake(dir, text, ['-n', 'dinner']);
    expect(noGoal.status).toBe(0);
    expect(noGoal.stdout).toBe(dinner.stdout);
    expect(printed(noGoal.stdout)).toEqual(SUNDAY_ROAST_MAKE_DINNER);
  });
});

describe('R3.5, R3.6, R4.2 make on the export of WORST_CASE', () => {
  const text = exported(WORST_CASE);

  it('make -n dinner prints exactly WORST_CASE_MAKE_DINNER, exit 0, empty stderr', () => {
    const run = runMake(freshDir(), text, ['-n', 'dinner']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(printed(run.stdout)).toEqual(WORST_CASE_MAKE_DINNER);
  });
  it('make dinner without -n exits 0 and leaves only the Dinnerfile: nothing ran but echo', () => {
    const dir = freshDir();
    const run = runMake(dir, text, ['dinner']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(readdirSync(dir)).toEqual(['Dinnerfile']);
  });
  it('the dish called dinner has no rule of its own: make -n export prints its two steps', () => {
    const run = runMake(freshDir(), text, ['-n', 'export']);
    expect(run.status).toBe(0);
    expect(printed(run.stdout).map((l) => decodeEchoLine(l, 'printed')?.stepId)).toEqual([
      '--.--',
      'export.x',
    ]);
  });
});

describe.each([
  ['MEZZE', MEZZE],
  ['TIGHT_OVEN', TIGHT_OVEN],
])('D2 checks on the export of %s', (_name, plan) => {
  it('make -n dinner exits 0 with empty stderr, prints every step once, in an order that works', () => {
    const run = runMake(freshDir(), exported(plan), ['-n', 'dinner']);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const decoded = printed(run.stdout).map((l) => decodeEchoLine(l, 'printed'));
    expect(decoded.every((d) => d !== null)).toBe(true);
    const ids = decoded.map((d) => d?.stepId ?? '');
    expect(ids.slice().sort()).toEqual(plan.steps.map((s) => s.id).sort());
    expect(respectsPrecedence(plan, ids)).toBe(true);
    for (const d of decoded) {
      const title = plan.steps.find((s) => s.id === d?.stepId)?.title ?? '';
      expect(d?.text).toBe(oracleEchoText(title));
    }
  });
});
