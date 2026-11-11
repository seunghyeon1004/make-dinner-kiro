import type { z } from 'zod';
import { err, ok, type Result } from './result.js';
import {
  compareIds,
  DishIdSchema,
  KitchenSchema,
  LIMITS,
  PlanSchema,
  StepIdSchema,
  type Issue,
  type Kitchen,
  type Plan,
} from './schema.js';

// ---------------------------------------------------------------------------------------
// Issue order

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The extra fields that take part in the order, in the order of the design. */
function extraKeys(issue: Issue): string[] {
  const fields: Record<string, unknown> = { ...issue };
  const text = (v: unknown): string => (typeof v === 'string' ? v : '');
  const path = Array.isArray(fields['path']) ? fields['path'].map(text).join('>') : '';
  return [
    text(fields['field']),
    text(fields['ref']),
    path,
    text(fields['appliance']),
    text(fields['word']),
  ];
}

/** One string that is equal for two issues exactly when all their fields are equal. */
function issueKey(issue: Issue): string {
  const entries = Object.entries(issue as Record<string, unknown>).sort(([a], [b]) =>
    compareIds(a, b),
  );
  return JSON.stringify(entries);
}

function compareIssues(a: Issue, b: Issue): number {
  const severity = (i: Issue): number => (i.severity === 'error' ? 0 : 1);
  const bySeverity = severity(a) - severity(b);
  if (bySeverity !== 0) return bySeverity;
  const stepId = (i: Issue): string => ('stepId' in i && i.stepId !== undefined ? i.stepId : '');
  const dishId = (i: Issue): string => ('dishId' in i && i.dishId !== undefined ? i.dishId : '');
  const parts: [string, string][] = [
    [a.code, b.code],
    [stepId(a), stepId(b)],
    [dishId(a), dishId(b)],
  ];
  const extraA = extraKeys(a);
  const extraB = extraKeys(b);
  extraA.forEach((value, i) => parts.push([value, extraB[i] ?? '']));
  parts.push([a.message, b.message]);
  for (const [x, y] of parts) {
    const order = compareIds(x, y);
    if (order !== 0) return order;
  }
  return 0;
}

/** Drops exact duplicates; errors first, then by code, stepId, dishId, extra fields, message. */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  const seen = new Set<string>();
  const distinct: Issue[] = [];
  for (const issue of issues) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(issue);
  }
  return distinct.toSorted(compareIssues);
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

// ---------------------------------------------------------------------------------------
// Parsing: zod issues mapped by path only, never by zod's message text (R7.2)

type Path = readonly PropertyKey[];

const UNRECOGNIZED = 'this entry has fields this app does not use; remove them';

const PLAN_PHRASES: Record<string, string> = {
  title: 'the title must be 1 to 120 characters and not blank',
  dishes: 'dishes must be a list of 1 to 12 dishes',
  steps: 'steps must be a list of 1 to 80 steps',
};

const STEP_PHRASES: Record<string, string> = {
  id: 'the id must look like chicken.roast: lowercase letters, digits and hyphens around one dot, up to 80 characters',
  dish: 'the dish must be a dish id: lowercase letters, digits and hyphens, up to 40 characters',
  title: 'the title must be 1 to 120 characters and not blank',
  detail: 'the detail must be 1 to 1000 characters and not blank, or left out',
  minutes: 'minutes must be a whole number from 1 to 480',
  appliance: 'the appliance must be burner, oven or none',
  handsOn: 'hands-on must be true or false',
  after: 'the prerequisites must be a list of at most 80 step ids',
  holdMin: 'the hold must be a whole number of minutes from 0 to 480, or null',
};

const DISH_PHRASES: Record<string, string> = {
  id: 'the id must be lowercase letters, digits and hyphens, up to 40 characters',
  name: 'the name must be 1 to 80 characters and not blank',
};

const KITCHEN_PHRASES: Record<string, string> = {
  burners: 'burners must be a whole number from 0 to 8',
  ovens: 'ovens must be a whole number from 0 to 4',
  cooks: 'cooks must be a whole number from 1 to 6',
};

/** `steps[3].after[1]`; the root has no path and is called `root`. */
function fieldOf(path: Path, root: string): string {
  if (path.length === 0) return root;
  let field = '';
  for (const segment of path) {
    if (typeof segment === 'number') field += `[${segment}]`;
    else field += `${field === '' ? '' : '.'}${String(segment)}`;
  }
  return field;
}

/** What a path points at: where it is, the valid id of the element if any, and its phrase. */
interface Located {
  location: string;
  stepId?: string;
  dishId?: string;
  phrase: string | undefined;
}

function locate(input: unknown, path: Path, unrecognized: boolean): Located {
  const [first, second, third] = path;
  const list = isRecord(input) && typeof first === 'string' ? input[first] : undefined;
  const element =
    Array.isArray(list) && typeof second === 'number' ? (list as unknown[])[second] : undefined;
  const idOf = (schema: z.ZodType<string>): string | undefined => {
    const id = isRecord(element) ? schema.safeParse(element['id']) : undefined;
    return id?.success === true ? id.data : undefined;
  };
  const pick = (table: Record<string, string>): string | undefined => {
    if (unrecognized) return UNRECOGNIZED;
    if (path.length === 2) return 'this entry must be an object';
    if (typeof third !== 'string') return undefined;
    if (third === 'after' && path.length === 4) {
      return 'each prerequisite must be a step id such as chicken.roast';
    }
    return table[third];
  };

  if (first === 'steps' && typeof second === 'number') {
    const stepId = idOf(StepIdSchema);
    return {
      location: stepId === undefined ? `Step ${second + 1}` : `Step ${stepId}`,
      ...(stepId === undefined ? {} : { stepId }),
      phrase: pick(STEP_PHRASES),
    };
  }
  if (first === 'dishes' && typeof second === 'number') {
    const dishId = idOf(DishIdSchema);
    return {
      location: dishId === undefined ? `Dish ${second + 1}` : `Dish ${dishId}`,
      ...(dishId === undefined ? {} : { dishId }),
      phrase: pick(DISH_PHRASES),
    };
  }
  return { location: 'The plan', phrase: undefined };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function planIssues(input: unknown, zodIssues: readonly z.core.$ZodIssue[]): Issue[] {
  const issues: Issue[] = [];
  for (const zodIssue of zodIssues) {
    const path: Path = zodIssue.path;
    const unrecognized = zodIssue.code === 'unrecognized_keys';
    const [first, second, third] = path;

    // Whole-list problems: the list itself is an array that is empty or too long.
    if (path.length === 1 && (first === 'dishes' || first === 'steps')) {
      const value = isRecord(input) ? input[first] : undefined;
      if (Array.isArray(value)) {
        const count = value.length;
        if (count === 0) {
          issues.push({
            severity: 'error',
            code: 'empty_plan',
            message: 'The plan has no dishes or no steps. Add at least one dish with one step.',
          });
          continue;
        }
        if (first === 'dishes' && count > LIMITS.dishesMax) {
          issues.push({
            severity: 'error',
            code: 'too_many_dishes',
            count,
            limit: LIMITS.dishesMax,
            message: `The plan has ${count} dishes and the limit is ${LIMITS.dishesMax}. Remove or merge ${plural(count - LIMITS.dishesMax, 'dish', 'dishes')}.`,
          });
          continue;
        }
        if (first === 'steps' && count > LIMITS.stepsMax) {
          issues.push({
            severity: 'error',
            code: 'too_many_steps',
            count,
            limit: LIMITS.stepsMax,
            message: `The plan has ${count} steps and the limit is ${LIMITS.stepsMax}. Remove or merge ${plural(count - LIMITS.stepsMax, 'step', 'steps')}.`,
          });
          continue;
        }
      }
    }

    const field = fieldOf(path, 'plan');
    const located = locate(input, path, unrecognized);
    let phrase = located.phrase;
    if (phrase === undefined) {
      if (unrecognized) phrase = UNRECOGNIZED;
      else if (path.length === 0) {
        phrase = 'this value must be an object with a title, dishes and steps';
      } else if (path.length === 1 && typeof first === 'string') phrase = PLAN_PHRASES[first];
    }
    const message = `${located.location}: ${phrase ?? 'this value is not valid'}.`;

    if (
      first === 'steps' &&
      typeof second === 'number' &&
      third === 'minutes' &&
      path.length === 3
    ) {
      issues.push({
        severity: 'error',
        code: 'minutes_out_of_range',
        field,
        ...(located.stepId === undefined ? {} : { stepId: located.stepId }),
        message,
      });
      continue;
    }
    issues.push({
      severity: 'error',
      code: 'invalid_field',
      field,
      ...(located.stepId === undefined ? {} : { stepId: located.stepId }),
      ...(located.dishId === undefined ? {} : { dishId: located.dishId }),
      message,
    });
  }
  return issues;
}

function kitchenIssues(zodIssues: readonly z.core.$ZodIssue[]): Issue[] {
  return zodIssues.map((zodIssue): Issue => {
    const path: Path = zodIssue.path;
    const [first] = path;
    let phrase: string | undefined;
    if (zodIssue.code === 'unrecognized_keys') phrase = UNRECOGNIZED;
    else if (path.length === 0) {
      phrase = 'this value must be an object with burners, ovens and cooks';
    } else if (path.length === 1 && typeof first === 'string') phrase = KITCHEN_PHRASES[first];
    return {
      severity: 'error',
      code: 'invalid_field',
      field: fieldOf(path, 'kitchen'),
      message: `The kitchen: ${phrase ?? 'this value is not valid'}.`,
    };
  });
}

/** Any value to a typed plan, or to the issues that say what to fix. Never throws on input. */
export function parsePlan(input: unknown): Result<Plan, Issue[]> {
  const parsed = PlanSchema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return err(sortIssues(planIssues(input, parsed.error.issues)));
}

/** Any value to a typed kitchen, or to `invalid_field` issues. Never throws on input. */
export function parseKitchen(input: unknown): Result<Kitchen, Issue[]> {
  const parsed = KitchenSchema.safeParse(input);
  if (parsed.success) return ok(parsed.data);
  return err(sortIssues(kitchenIssues(parsed.error.issues)));
}
