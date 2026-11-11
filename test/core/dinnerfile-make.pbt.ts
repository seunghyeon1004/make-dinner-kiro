import { rmSync } from 'node:fs';
import fc from 'fast-check';
import { afterAll, expect, it } from 'vitest';
import { toDinnerfile } from '../../src/core/dinnerfile.js';
import type { DinnerfileOptions } from '../../src/core/dinnerfile.js';
import type { Plan } from '../../src/core/schema.js';
import { arbDinnerfileOptions, arbPlan } from '../support/arbitraries.js';
import { fcMakeParams } from '../support/fc-params.js';
import { makeDir, runMake } from '../support/make.js';
import {
  decodeEchoLine,
  oracleEchoText,
  oracleNeededSteps,
  respectsPrecedence,
} from '../support/oracles.js';

// D2 and P-DF7 spawn GNU Make (about 11 ms a run), so they use fcMakeParams(): 50 runs by
// default, FC_MAKE_RUNS to change (dinnerfile design, conflict C1). They need GNU Make on PATH
// and fail, not skip, without it (R9.3). One temporary directory for the file.

const TIMEOUT_MS = 120_000;

const dir = makeDir();
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const exportOf = (plan: Plan, options: DinnerfileOptions): string => {
  const result = toDinnerfile(plan, options);
  expect(result.ok).toBe(true);
  return result.ok ? result.value : '';
};

/** What `make -n` printed, as step ids and texts; fails the property on a line of another form. */
const decodePrinted = (stdout: string): { stepId: string; text: string }[] => {
  expect(stdout === '' || stdout.endsWith('\n')).toBe(true);
  const lines = stdout === '' ? [] : stdout.replace(/\n$/, '').split('\n');
  return lines.map((line) => {
    const decoded = decodeEchoLine(line, 'printed');
    expect(decoded).not.toBeNull();
    return decoded ?? { stepId: '', text: '' };
  });
};

it(
  'D2 make agrees: make -n dinner exits 0 with no stderr and prints every step once, after its prerequisites',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(
          arbPlan(large ? { large: true } : {}),
          arbDinnerfileOptions(),
          (plan, options) => {
            const run = runMake(dir, exportOf(plan, options), ['-n', 'dinner']);
            expect(run.status).toBe(0);
            expect(run.stderr).toBe('');
            const printed = decodePrinted(run.stdout);
            const ids = printed.map((p) => p.stepId);
            expect(ids.slice().sort()).toEqual(plan.steps.map((s) => s.id).sort());
            expect(respectsPrecedence(plan, ids)).toBe(true);
            for (const p of printed) {
              const title = plan.steps.find((s) => s.id === p.stepId)?.title ?? '';
              expect(p.text).toBe(oracleEchoText(title));
            }
          },
        ),
        fcMakeParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'P-DF7 dish target: make -n <dish> prints exactly the steps that dish needs, once each, in an order that works',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(
          arbPlan(large ? { large: true } : {}),
          fc.nat(),
          arbDinnerfileOptions(),
          (plan, pick, options) => {
            // A dish called dinner has no rule of its own (R4.2); there is nothing to run for it.
            const dishes = plan.dishes.filter((d) => d.id !== 'dinner');
            if (dishes.length === 0) return;
            const dish = dishes[pick % dishes.length]?.id ?? '';
            const run = runMake(dir, exportOf(plan, options), ['-n', dish]);
            expect(run.status).toBe(0);
            expect(run.stderr).toBe('');
            const ids = decodePrinted(run.stdout).map((p) => p.stepId);
            expect(ids.slice().sort()).toEqual(oracleNeededSteps(plan, dish));
            const position = new Map(ids.map((id, i) => [id, i]));
            for (const step of plan.steps) {
              const at = position.get(step.id);
              if (at === undefined) continue;
              for (const before of step.after) {
                expect(position.get(before) ?? Infinity).toBeLessThan(at);
              }
            }
          },
        ),
        fcMakeParams(),
      );
    }
  },
  TIMEOUT_MS,
);
