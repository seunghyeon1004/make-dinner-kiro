import { fromDinnerfile, hasErrors, parseKitchen, validatePlan } from '../../core/index.js';
import type { Result } from '../../core/index.js';
import { err, ok } from '../../core/index.js';
import { DINNERFILE_COPY } from '../copy.js';
import { DEFAULT_KITCHEN } from './store.js';
import type { DinnerLoad, ImportProblem } from './store.js';

export const DINNERFILE_FILE_MAX = 1_048_576;

export interface DinnerfileProblems {
  heading: string;
  problems: ImportProblem[];
}

/**
 * Reads a Dinnerfile in the browser, with no request (R3.2). Errors from `fromDinnerfile` are
 * listed in the order returned (R3.3); a plan failing `validatePlan` outright lists its issues
 * (R3.4); otherwise the plan opens Plan, or Steps when it still has errors (R3.5).
 */
export function readDinnerfile(text: string): Result<DinnerLoad, DinnerfileProblems> {
  const read = fromDinnerfile(text);
  if (!read.ok) {
    return err({
      heading: DINNERFILE_COPY.unreadable,
      problems: read.error.map((e) => ({ kind: 'line', line: e.line, message: e.message })),
    });
  }
  const check = validatePlan(read.value.plan);
  if (check.plan === null) {
    return err({
      heading: DINNERFILE_COPY.invalidPlan,
      problems: check.issues.map((issue) => ({ kind: 'issue', message: issue.message })),
    });
  }
  let kitchen = DEFAULT_KITCHEN;
  let notice: string | null = null;
  const stored = read.value.options.kitchen;
  if (stored !== undefined) {
    const parsed = parseKitchen(stored);
    if (parsed.ok) kitchen = parsed.value;
    else notice = DINNERFILE_COPY.kitchenLineIgnored;
  }
  return ok({
    plan: check.plan,
    source: { kind: 'dinnerfile' },
    kitchen,
    serve: read.value.options.serve ?? null,
    suggested: null,
    route: hasErrors(check.issues) ? 'steps' : 'plan',
    notice,
  });
}
