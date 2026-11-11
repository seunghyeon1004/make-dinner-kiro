import { terminalSteps } from './graph.js';
import { err, ok } from './result.js';
import type { Result } from './result.js';
import { parseKitchen, parsePlan, sortIssues } from './sanity.js';
import {
  canonicalPlan,
  compareIds,
  SERVE_TIME_PATTERN,
  ServeTimeSchema,
  STEP_ID_PATTERN,
} from './schema.js';
import type { Appliance, Issue, Kitchen, Plan, ServeTime, Step } from './schema.js';

export interface DinnerfileOptions {
  kitchen?: Kitchen;
  serve?: ServeTime;
}

export interface DinnerfileImport {
  /** Lexically checked only (R6.4); the caller runs validatePlan on it. Canonical order. */
  plan: Plan;
  /** Keys present only when their line is present. */
  options: DinnerfileOptions;
}

export type MetadataKeyword = 'plan' | 'dish' | 'step' | 'kitchen' | 'serve';

export type DinnerfileError =
  | {
      code: 'unsupported_line';
      line: number;
      message: string;
      reason: 'space_before_colon' | 'double_colon' | 'several_targets' | 'other';
    }
  | { code: 'line_continuation'; line: number; message: string }
  | { code: 'recipe_before_rule'; line: number; message: string }
  | { code: 'bad_target'; line: number; message: string }
  | {
      code: 'bad_prerequisite';
      line: number;
      message: string;
      stepId?: string;
      dishId?: string;
    }
  | { code: 'missing_plan'; line: null; message: string }
  | {
      code: 'duplicate_metadata';
      line: number;
      message: string;
      keyword: 'plan' | 'kitchen' | 'serve';
      firstLine: number;
    }
  | { code: 'bad_metadata'; line: number; message: string; keyword: MetadataKeyword }
  | {
      code: 'unknown_key';
      line: number;
      message: string;
      keyword: 'step' | 'kitchen';
      stepId?: string;
    }
  | {
      code: 'duplicate_key';
      line: number;
      message: string;
      keyword: 'step' | 'kitchen';
      key: string;
      stepId?: string;
    }
  | {
      code: 'missing_key';
      line: number;
      message: string;
      keyword: 'step' | 'kitchen';
      key: string;
      stepId?: string;
    }
  | {
      code: 'bad_value';
      line: number;
      message: string;
      keyword: MetadataKeyword;
      key: string;
      stepId?: string;
    }
  | { code: 'step_without_target'; line: number; message: string }
  | { code: 'target_without_step'; line: number; message: string; stepId: string }
  | {
      code: 'duplicate_target';
      line: number;
      message: string;
      target: string;
      firstLine: number;
      stepId?: string;
      dishId?: string;
    }
  | { code: 'dish_target_mismatch'; line: number; message: string; dishId: string }
  | { code: 'dinner_mismatch'; line: number; message: string }
  | { code: 'too_many_errors'; line: number; message: string; count: number };

export type DinnerfileErrorCode = DinnerfileError['code'];

// ---------------------------------------------------------------------------------------
// Export

const HEADER: readonly string[] = [
  '# Dinnerfile written by Make Dinner. GNU Make reads it:',
  '#   make -n -f Dinnerfile dinner    prints every step in an order that works',
  '#   make -n -f Dinnerfile <dish>    prints the steps one dish needs',
  '# The "# plan", "# dish", "# step", "# kitchen" and "# serve" lines hold the plan.',
];

const NO_DINNER_DISH_RULE = '# No target for dish dinner: "dinner" makes the whole plan.';

const SERVE_ISSUE_MESSAGE =
  'The serving time must be a 24-hour time from 00:00 to 23:59, like 19:00.';

const isLoneSurrogate = (cp: number): boolean => cp >= 0xd800 && cp <= 0xdfff;
const isControl = (cp: number): boolean => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);
const isBidiControl = (cp: number): boolean =>
  cp === 0x61c ||
  cp === 0x200e ||
  cp === 0x200f ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069);

const SHORT_ESCAPES = new Map<number, string>([
  [0x22, '\\"'],
  [0x5c, '\\\\'],
  [0x08, '\\b'],
  [0x0c, '\\f'],
  [0x0a, '\\n'],
  [0x0d, '\\r'],
  [0x09, '\\t'],
]);

const unicodeEscape = (cp: number): string => `\\u${cp.toString(16).padStart(4, '0')}`;

/**
 * Text in a metadata line: a JSON string that reads back unit for unit. Line breaks, control
 * and bidirectional code points, U+2028, U+2029, U+FEFF and lone surrogates are escaped, so the
 * line holds none of them and ends with the closing quote.
 */
function enc(text: string): string {
  let out = '"';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const short = SHORT_ESCAPES.get(cp);
    if (short !== undefined) out += short;
    else if (
      isControl(cp) ||
      cp === 0x2028 ||
      cp === 0x2029 ||
      isBidiControl(cp) ||
      cp === 0xfeff ||
      isLoneSurrogate(cp)
    ) {
      out += unicodeEscape(cp);
    } else out += ch;
  }
  return `${out}"`;
}

/**
 * The argument of the `@echo` line: the title's display form (one line, nothing that reorders
 * or hides text), quoted for the shell (`'` as `'\\''`) and for Make (`$` as `$$`, with `''`
 * after it before `(` or `{`, so the line never holds `$(` or `${`).
 */
function echoArg(title: string): string {
  const display: string[] = [];
  for (const ch of title) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isControl(cp) || cp === 0x2028 || cp === 0x2029) display.push(' ');
    else if (isBidiControl(cp) || cp === 0xfeff || isLoneSurrogate(cp)) display.push('\ufffd');
    else display.push(ch);
  }
  let out = '';
  display.forEach((ch, i) => {
    if (ch === "'") out += "'\\''";
    else if (ch === '$') {
      const next = display[i + 1];
      out += next === '(' || next === '{' ? "$$''" : '$$';
    } else out += ch;
  });
  return out;
}

const rule = (target: string, prerequisites: readonly string[]): string =>
  prerequisites.length === 0 ? `${target}:` : `${target}: ${prerequisites.join(' ')}`;

/** Per dish id, the steps of that dish no other step of the same dish waits on, sorted. */
function lastSteps(plan: Plan, dishId: string): string[] {
  const ofDish = plan.steps.filter((s) => s.dish === dishId);
  const waitedOn = new Set(ofDish.flatMap((s) => s.after));
  const last = new Set(ofDish.filter((s) => !waitedOn.has(s.id)).map((s) => s.id));
  return [...last]; // plan.steps is in id order, so this is too
}

/** The Dinnerfile text of a plan. err when the plan or the options fail their schemas. */
export function toDinnerfile(plan: Plan, options?: DinnerfileOptions): Result<string, Issue[]> {
  const issues: Issue[] = [];
  const parsed = parsePlan(plan);
  if (!parsed.ok) issues.push(...parsed.error);

  // Only the keys kitchen and serve are read, and an undefined value means absent.
  const given: Record<string, unknown> =
    typeof options === 'object' && options !== null ? { ...options } : {};
  const kitchenInput = given['kitchen'];
  const serveInput = given['serve'];
  let kitchen: Kitchen | undefined;
  if (kitchenInput !== undefined) {
    const k = parseKitchen(kitchenInput);
    if (k.ok) kitchen = k.value;
    else issues.push(...k.error);
  }
  let serve: ServeTime | undefined;
  if (serveInput !== undefined) {
    const t = ServeTimeSchema.safeParse(serveInput);
    if (t.success) serve = t.data;
    else {
      issues.push({
        severity: 'error',
        code: 'invalid_field',
        field: 'serve',
        message: SERVE_ISSUE_MESSAGE,
      });
    }
  }
  if (!parsed.ok || issues.length > 0) return err(sortIssues(issues));

  const p = canonicalPlan(parsed.value);
  const dishIds = [...new Set(p.dishes.map((d) => d.id))];
  const lines: string[] = [...HEADER, '', `# plan ${enc(p.title)}`];
  if (kitchen !== undefined) {
    lines.push(
      `# kitchen burners=${kitchen.burners} ovens=${kitchen.ovens} cooks=${kitchen.cooks}`,
    );
  }
  if (serve !== undefined) lines.push(`# serve ${serve}`);
  for (const dish of p.dishes) lines.push(`# dish ${dish.id} ${enc(dish.name)}`);
  lines.push('');
  lines.push(
    `.PHONY: ${['dinner', ...dishIds.filter((id) => id !== 'dinner'), ...p.steps.map((s) => s.id)].join(' ')}`,
  );
  lines.push(rule('dinner', terminalSteps(p)));
  lines.push('');
  for (const id of dishIds) {
    lines.push(id === 'dinner' ? NO_DINNER_DISH_RULE : rule(id, lastSteps(p, id)));
  }
  for (const step of p.steps) {
    const detail = step.detail === undefined ? '' : ` detail=${enc(step.detail)}`;
    lines.push(
      '',
      `# step dish=${step.dish} minutes=${step.minutes} appliance=${step.appliance} handsOn=${step.handsOn} hold=${step.holdMin ?? 'keeps'} title=${enc(step.title)}${detail}`,
      rule(step.id, step.after),
      `\t@echo '${echoArg(step.title)}' # ${step.id}`,
    );
  }
  return ok(`${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------------------------------
// Import
//
// One pass over the lines, then two checks. No recursion, no regular expression with a nested
// quantifier; the string scanner walks code units once, so the time is linear in the text.

const MAX_ERRORS = 50;
const KEYWORDS: readonly string[] = ['plan', 'dish', 'step', 'kitchen', 'serve'];
const STEP_KEYS: readonly string[] = [
  'dish',
  'minutes',
  'appliance',
  'handsOn',
  'hold',
  'title',
  'detail',
];
const STEP_REQUIRED: readonly string[] = [
  'dish',
  'minutes',
  'appliance',
  'handsOn',
  'hold',
  'title',
];
const KITCHEN_KEYS: readonly string[] = ['burners', 'ovens', 'cooks'];

type ValueKind = 'dishId' | 'nat' | 'appliance' | 'bool' | 'hold' | 'string';
const STEP_KINDS: Record<string, ValueKind> = {
  dish: 'dishId',
  minutes: 'nat',
  appliance: 'appliance',
  handsOn: 'bool',
  hold: 'hold',
  title: 'string',
  detail: 'string',
};

const isWsp = (c: string | undefined): boolean => c === ' ' || c === '\t';
const isNameChar = (c: string | undefined): boolean =>
  c !== undefined &&
  ((c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '.' ||
    c === '_' ||
    c === '-');
const isKeyChar = (c: string | undefined): boolean =>
  c !== undefined &&
  ((c >= 'a' && c <= 'z') ||
    (c >= 'A' && c <= 'Z') ||
    (c >= '0' && c <= '9') ||
    c === '_' ||
    c === '-');
const isLowerAlnum = (part: string): boolean => {
  if (part === '') return false;
  for (const c of part) if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) return false;
  return true;
};
/** Lexical form of a dish id: lowercase letters and digits, single hyphens between them. */
const isDishId = (id: string): boolean => id.split('-').every(isLowerAlnum);
const isStepId = (id: string): boolean => STEP_ID_PATTERN.test(id);
const isNat = (value: string): boolean => {
  if (value === '0') return true;
  if (value.length < 1 || value.length > 6 || value.startsWith('0')) return false;
  for (const c of value) if (c < '0' || c > '9') return false;
  return true;
};
const isTime = (value: string): boolean => SERVE_TIME_PATTERN.test(value);

/**
 * Reads the JSON string that starts at `rest[at]` (a double quote). The value, and the index
 * after the closing quote, or null when the string is not well formed: an end of line before
 * the closing quote, a code unit below U+0020, a bad escape.
 */
function scanString(rest: string, at: number): { value: string; end: number } | null {
  let i = at + 1;
  while (i < rest.length) {
    const code = rest.charCodeAt(i);
    if (code === 0x22) {
      return { value: JSON.parse(rest.slice(at, i + 1)) as string, end: i + 1 };
    }
    if (code < 0x20) return null;
    if (code === 0x5c) {
      const next = rest.charAt(i + 1);
      if ('"\\/bfnrt'.includes(next) && next !== '') i += 2;
      else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(rest.slice(i + 2, i + 6))) i += 6;
      else return null;
    } else i += 1;
  }
  return null;
}

const where = (line: number, text: string): string => `Line ${line}: ${text}`;

const BAD_METADATA_SHAPE: Record<MetadataKeyword, string> = {
  plan: 'a "# plan" line must look like: # plan "Sunday roast"',
  dish: 'a "# dish" line must look like: # dish gravy "Gravy"',
  step: 'a "# step" line must be a list of key=value fields, like: # step dish=gravy minutes=2 appliance=none handsOn=true hold=keeps title="Strain the gravy"',
  kitchen:
    'a "# kitchen" line must be a list of key=value fields, like: # kitchen burners=4 ovens=1 cooks=1',
  serve: 'a "# serve" line must look like: # serve 19:00',
};

const NAT_SENTENCE = 'a whole number with no sign or leading zero';
const BAD_VALUE_SENTENCE: Record<string, string> = {
  'step.dish':
    'dish must be a dish id like chicken: lowercase letters and digits, with single hyphens between them.',
  'step.minutes': `minutes must be ${NAT_SENTENCE}, like minutes=15.`,
  'step.appliance': 'appliance must be burner, oven or none.',
  'step.handsOn': 'handsOn must be true or false.',
  'step.hold': `hold must be ${NAT_SENTENCE}, or keeps, like hold=5.`,
  'step.title': 'title must be text in double quotes, like title="Carve the chicken".',
  'step.detail': 'detail must be text in double quotes, like detail="Use the tin juices".',
  'kitchen.burners': `burners must be ${NAT_SENTENCE}, like burners=4.`,
  'kitchen.ovens': `ovens must be ${NAT_SENTENCE}, like ovens=1.`,
  'kitchen.cooks': `cooks must be ${NAT_SENTENCE}, like cooks=1.`,
  'plan.title': 'the plan title must be text in double quotes, like "Sunday roast".',
  'dish.dish': 'the dish id must be lowercase letters and digits with single hyphens, like gravy.',
  'dish.name': 'the dish name must be text in double quotes, like "Gravy".',
  'serve.serve': 'the serving time must be a 24-hour time like 19:00.',
};

const ADD_KEY_SENTENCE: Record<string, string> = {
  dish: 'Add dish=<dish id>.',
  minutes: 'Add minutes=<number>.',
  appliance: 'Add appliance=burner, appliance=oven or appliance=none.',
  handsOn: 'Add handsOn=true or handsOn=false.',
  hold: 'Add hold=<minutes> or hold=keeps.',
  title: 'Add title="<text>".',
  burners: 'Add burners=<number>.',
  ovens: 'Add ovens=<number>.',
  cooks: 'Add cooks=<number>.',
};

const UNSUPPORTED_SENTENCE: Record<
  Extract<DinnerfileError, { code: 'unsupported_line' }>['reason'],
  string
> = {
  other:
    'Make Dinner reads only comments, rules like "chicken.carve: chicken.rest" and recipe lines. Remove this line or rewrite it as one of those.',
  space_before_colon: 'put the ":" directly after the target name.',
  double_colon: 'use one ":" between the target and its prerequisites.',
  several_targets: 'a rule may have one target. Write one rule per step.',
};

function badValue(
  line: number,
  keyword: MetadataKeyword,
  key: string,
): Extract<DinnerfileError, { code: 'bad_value' }> {
  const sentence = BAD_VALUE_SENTENCE[`${keyword}.${key}`] ?? 'this value is not valid.';
  return { code: 'bad_value', line, keyword, key, message: where(line, sentence) };
}

function badMetadata(line: number, keyword: MetadataKeyword): DinnerfileError {
  return { code: 'bad_metadata', line, keyword, message: where(line, BAD_METADATA_SHAPE[keyword]) };
}

/** Whether `value` has the lexical form the key asks for. `quoted`: it was written as a string. */
function validValue(kind: ValueKind, value: string, quoted: boolean): boolean {
  if (kind === 'string') return quoted;
  if (quoted) return false;
  switch (kind) {
    case 'dishId':
      return isDishId(value);
    case 'nat':
      return isNat(value);
    case 'appliance':
      return value === 'burner' || value === 'oven' || value === 'none';
    case 'bool':
      return value === 'true' || value === 'false';
    case 'hold':
      return value === 'keeps' || isNat(value);
  }
}

interface Fields {
  values: Map<string, string>;
  errors: DinnerfileError[];
}

/**
 * The fields of a `# step` or `# kitchen` line: `key=value` runs separated by white space,
 * a value being a JSON string or a run without white space. Every problem becomes an error;
 * after one that makes the rest unreadable the missing-key check is skipped.
 */
function scanFields(rest: string, line: number, keyword: 'step' | 'kitchen'): Fields {
  const allowed = keyword === 'step' ? STEP_KEYS : KITCHEN_KEYS;
  const required = keyword === 'step' ? STEP_REQUIRED : KITCHEN_KEYS;
  const values = new Map<string, string>();
  const errors: DinnerfileError[] = [];
  const seen = new Set<string>();
  let readable = true;
  let i = 0;

  const check = (key: string, value: string | null, quoted: boolean): void => {
    if (!allowed.includes(key)) {
      errors.push({
        code: 'unknown_key',
        line,
        keyword,
        message: where(
          line,
          `the "# ${keyword}" line has a key this app does not use. The keys are ${
            keyword === 'step'
              ? 'dish, minutes, appliance, handsOn, hold, title and detail'
              : 'burners, ovens and cooks'
          }.`,
        ),
      });
    } else if (seen.has(key)) {
      errors.push({
        code: 'duplicate_key',
        line,
        keyword,
        key,
        message: where(line, `the "# ${keyword}" line gives ${key} twice. Keep one.`),
      });
    } else {
      seen.add(key);
      const kind = keyword === 'step' ? (STEP_KINDS[key] ?? 'string') : 'nat';
      if (value !== null && validValue(kind, value, quoted)) values.set(key, value);
      else errors.push(badValue(line, keyword, key));
    }
  };

  while (readable) {
    while (isWsp(rest[i])) i++;
    if (i >= rest.length) break;
    const keyStart = i;
    while (isKeyChar(rest[i])) i++;
    const key = rest.slice(keyStart, i);
    if (key === '' || rest[i] !== '=') {
      errors.push(badMetadata(line, keyword));
      readable = false;
      break;
    }
    i++;
    if (rest[i] === '"') {
      const scanned = scanString(rest, i);
      if (scanned === null) {
        check(key, null, true);
        readable = false;
        break;
      }
      i = scanned.end;
      if (i < rest.length && !isWsp(rest[i])) {
        errors.push(badMetadata(line, keyword));
        readable = false;
        break;
      }
      check(key, scanned.value, true);
    } else {
      const valueStart = i;
      while (i < rest.length && !isWsp(rest[i])) i++;
      check(key, rest.slice(valueStart, i), false);
    }
  }
  if (readable) {
    for (const key of required) {
      if (!seen.has(key)) {
        errors.push({
          code: 'missing_key',
          line,
          keyword,
          key,
          message: where(
            line,
            `the "# ${keyword}" line has no ${key}. ${ADD_KEY_SENTENCE[key] ?? ''}`.trimEnd(),
          ),
        });
      }
    }
  }
  return { values, errors };
}

/** The target and prerequisite names of a rule line, or null when the line is not one. */
function parseRule(line: string): { target: string; names: string[] } | null {
  let i = 0;
  while (isNameChar(line[i])) i++;
  const target = line.slice(0, i);
  if (target === '' || line[i] !== ':' || line[i + 1] === ':') return null;
  i++;
  const names: string[] = [];
  for (;;) {
    while (isWsp(line[i])) i++;
    if (i >= line.length || line[i] === '#') break;
    const start = i;
    while (isNameChar(line[i])) i++;
    if (i === start) return null;
    names.push(line.slice(start, i));
  }
  return { target, names };
}

/** Why a line that is not a rule is not (checked in this order, as the design says). */
function unsupportedReason(
  line: string,
): Extract<DinnerfileError, { code: 'unsupported_line' }>['reason'] {
  let i = 0;
  while (isNameChar(line[i])) i++;
  if (i > 0) {
    let j = i;
    while (isWsp(line[j])) j++;
    if (j > i && line[j] === ':') return 'space_before_colon';
    if (line[i] === ':' && line[i + 1] === ':') return 'double_colon';
  }
  let names = 0;
  let pos = 0;
  for (;;) {
    const start = pos;
    while (isNameChar(line[pos])) pos++;
    if (pos === start) return 'other';
    names++;
    while (isWsp(line[pos])) pos++;
    if (line[pos] === ':') return names >= 2 ? 'several_targets' : 'other';
    if (pos >= line.length) return 'other';
  }
}

const listOf = (ids: readonly string[]): string => ids.join(' ');

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

interface PendingStep {
  line: number;
  fields: Map<string, string>;
  errors: DinnerfileError[];
}

interface StepRule {
  id: string;
  line: number;
  prerequisites: string[];
  info: PendingStep;
}

interface PrerequisiteRule {
  id: string;
  line: number;
  prerequisites: string[];
}

/** Puts the step id on the errors of a `# step` line that turned out to belong to a step. */
function withStepId(error: DinnerfileError, stepId: string): DinnerfileError {
  switch (error.code) {
    case 'unknown_key':
    case 'duplicate_key':
    case 'missing_key':
    case 'bad_value':
      return { ...error, stepId };
    default:
      return error;
  }
}

const errorOrder = (a: DinnerfileError, b: DinnerfileError): number => {
  if (a.line !== b.line) {
    if (a.line === null) return -1;
    if (b.line === null) return 1;
    return a.line - b.line;
  }
  const byCode = compareIds(a.code, b.code);
  if (byCode !== 0) return byCode;
  const byStep = compareIds(
    'stepId' in a ? (a.stepId ?? '') : '',
    'stepId' in b ? (b.stepId ?? '') : '',
  );
  if (byStep !== 0) return byStep;
  return compareIds('key' in a ? a.key : '', 'key' in b ? b.key : '');
};

/** Drops exact repeats, sorts, and keeps the first 50 with one entry for the rest. */
function finish(errors: readonly DinnerfileError[]): DinnerfileError[] {
  const seen = new Set<string>();
  const distinct: DinnerfileError[] = [];
  for (const error of errors) {
    const key = JSON.stringify(error);
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(error);
  }
  const sorted = distinct.toSorted(errorOrder);
  if (sorted.length <= MAX_ERRORS) return sorted;
  const shown = sorted.slice(0, MAX_ERRORS);
  const count = sorted.length - MAX_ERRORS;
  const line = shown[MAX_ERRORS - 1]?.line ?? 1;
  const more = count === 1 ? '1 more problem was' : `${count} more problems were`;
  shown.push({
    code: 'too_many_errors',
    line,
    count,
    message: where(
      line,
      `${more} found after this point. Fix the problems above and import again.`,
    ),
  });
  return shown;
}

/** Reads a Dinnerfile back. Never throws. */
export function fromDinnerfile(text: string): Result<DinnerfileImport, DinnerfileError[]> {
  const errors: DinnerfileError[] = [];
  const lines = (text.startsWith('\ufeff') ? text.slice(1) : text).split('\n');

  let seenRule = false;
  let pending: PendingStep | null = null;
  let planLine: number | null = null;
  let title: string | null = null;
  let kitchenLine: number | null = null;
  let kitchen: Kitchen | undefined;
  let serveLine: number | null = null;
  let serve: ServeTime | undefined;
  const dishes: { id: string; name: string }[] = [];
  const firstRuleLine = new Map<string, number>();
  const stepRules: StepRule[] = [];
  const dishRules: PrerequisiteRule[] = [];
  let dinnerRule: PrerequisiteRule | null = null;

  /** A `# step` line that no step rule claimed. */
  const dropPending = (): void => {
    if (pending === null) return;
    errors.push(...pending.errors, {
      code: 'step_without_target',
      line: pending.line,
      message: where(
        pending.line,
        'this "# step" line is not followed by a step rule. Put it directly above the rule of its step, or remove it.',
      ),
    });
    pending = null;
  };

  const duplicateMetadata = (
    line: number,
    keyword: 'plan' | 'kitchen' | 'serve',
    firstLine: number,
  ): void => {
    errors.push({
      code: 'duplicate_metadata',
      line,
      keyword,
      firstLine,
      message: where(
        line,
        `a second "# ${keyword}" line (the first is line ${firstLine}). Keep one.`,
      ),
    });
  };

  /** A string value at the start of `rest` that must also end the line. */
  const wholeString = (
    rest: string,
    line: number,
    keyword: 'plan' | 'dish',
    key: string,
  ): string | null => {
    if (rest.charAt(0) !== '"') {
      errors.push(badValue(line, keyword, key));
      return null;
    }
    const scanned = scanString(rest, 0);
    if (scanned === null) {
      errors.push(badValue(line, keyword, key));
      return null;
    }
    if (scanned.end < rest.length) {
      errors.push(badMetadata(line, keyword));
      return null;
    }
    return scanned.value;
  };

  const readMetadata = (keyword: MetadataKeyword, afterWord: string, line: number): void => {
    // Every metadata line is its keyword, white space, then its content.
    const content = afterWord.trimStart();
    const separated = afterWord === '' || isWsp(afterWord.charAt(0));
    if (keyword === 'step') {
      dropPending();
      const fields = scanFields(afterWord, line, 'step');
      pending = { line, fields: fields.values, errors: fields.errors };
      return;
    }
    if (keyword === 'kitchen') {
      if (kitchenLine !== null) return duplicateMetadata(line, 'kitchen', kitchenLine);
      kitchenLine = line;
      const fields = scanFields(afterWord, line, 'kitchen');
      errors.push(...fields.errors);
      const [burners, ovens, cooks] = KITCHEN_KEYS.map((k) => fields.values.get(k));
      if (burners !== undefined && ovens !== undefined && cooks !== undefined) {
        kitchen = { burners: Number(burners), ovens: Number(ovens), cooks: Number(cooks) };
      }
      return;
    }
    if (keyword === 'serve') {
      if (serveLine !== null) return duplicateMetadata(line, 'serve', serveLine);
      serveLine = line;
      const words = content.split(/[ \t]+/).filter((w) => w !== '');
      if (!separated || words.length !== 1) errors.push(badMetadata(line, 'serve'));
      else if (isTime(words[0] ?? '')) serve = words[0];
      else errors.push(badValue(line, 'serve', 'serve'));
      return;
    }
    if (keyword === 'plan') {
      if (planLine !== null) return duplicateMetadata(line, 'plan', planLine);
      planLine = line;
      if (!separated || content === '') {
        errors.push(badMetadata(line, 'plan'));
        return;
      }
      title = wholeString(content, line, 'plan', 'title');
      return;
    }
    // dish
    if (!separated || content === '') {
      errors.push(badMetadata(line, 'dish'));
      return;
    }
    let end = 0;
    while (end < content.length && !isWsp(content.charAt(end))) end++;
    const id = content.slice(0, end);
    const rest = content.slice(end).trimStart();
    if (rest === '') {
      errors.push(badMetadata(line, 'dish'));
      return;
    }
    if (!isDishId(id)) {
      errors.push(badValue(line, 'dish', 'dish'));
      return;
    }
    const name = wholeString(rest, line, 'dish', 'name');
    if (name !== null) dishes.push({ id, name });
  };

  const readRule = (content: string, line: number): void => {
    const rule = parseRule(content);
    if (rule === null) {
      errors.push({
        code: 'unsupported_line',
        line,
        reason: unsupportedReason(content),
        message: where(line, UNSUPPORTED_SENTENCE[unsupportedReason(content)]),
      });
      return;
    }
    seenRule = true;
    const { target } = rule;
    if (target === '.PHONY') {
      dropPending();
      return;
    }
    const kind =
      target === 'dinner' ? 'dinner' : isDishId(target) ? 'dish' : isStepId(target) ? 'step' : null;
    if (kind === null) {
      dropPending();
      errors.push({
        code: 'bad_target',
        line,
        message: where(
          line,
          'the target is not a step id (like chicken.roast), a dish id, dinner or .PHONY. Rename it.',
        ),
      });
      return;
    }
    const prerequisites: string[] = [];
    let badPrerequisite = false;
    for (const name of rule.names) {
      if (isStepId(name)) prerequisites.push(name);
      else badPrerequisite = true;
    }
    if (badPrerequisite) {
      const subject =
        kind === 'step' ? `step ${target}` : kind === 'dish' ? `dish ${target}` : 'dinner';
      errors.push({
        code: 'bad_prerequisite',
        line,
        ...(kind === 'step' ? { stepId: target } : {}),
        ...(kind === 'dish' ? { dishId: target } : {}),
        message: where(
          line,
          `${subject} lists a prerequisite that is not a step id (like chicken.rest). Only steps can be prerequisites.`,
        ),
      });
    }
    const claimed = pending;
    if (kind === 'step') {
      pending = null;
      if (claimed === null) {
        errors.push({
          code: 'target_without_step',
          line,
          stepId: target,
          message: where(
            line,
            `step ${target} has no "# step" line above it. Add one, like: # step dish=${target.slice(0, target.indexOf('.'))} minutes=1 appliance=none handsOn=true hold=keeps title="Describe the step"`,
          ),
        });
      } else {
        errors.push(...claimed.errors.map((e) => withStepId(e, target)));
      }
    } else {
      dropPending();
    }
    const first = firstRuleLine.get(target);
    if (first !== undefined) {
      errors.push({
        code: 'duplicate_target',
        line,
        target,
        firstLine: first,
        ...(kind === 'step' ? { stepId: target } : {}),
        ...(kind === 'dish' ? { dishId: target } : {}),
        message: where(
          line,
          `${target} is the target of a second rule (the first is line ${first}). Make would merge their prerequisites; keep one rule.`,
        ),
      });
      return;
    }
    firstRuleLine.set(target, line);
    if (kind === 'step') {
      if (claimed !== null) stepRules.push({ id: target, line, prerequisites, info: claimed });
    } else if (kind === 'dish') dishRules.push({ id: target, line, prerequisites });
    else dinnerRule = { id: target, line, prerequisites };
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    let content = raw.trimEnd();
    if (content === '') return;
    if (content.endsWith('\\')) {
      errors.push({
        code: 'line_continuation',
        line,
        message: where(
          line,
          'the line ends with "\\", which makes Make join it to the next line. Remove the "\\".',
        ),
      });
      content = content.slice(0, -1).trimEnd();
      if (content === '') return;
    }
    if (content.startsWith('\t')) {
      if (!seenRule) {
        errors.push({
          code: 'recipe_before_rule',
          line,
          message: where(
            line,
            'this line starts with a tab before any rule, so Make stops here. Remove the tab.',
          ),
        });
      }
      return;
    }
    content = content.replace(/^ +/, '');
    if (content.startsWith('#')) {
      let at = 1;
      while (isWsp(content.charAt(at))) at++;
      let end = at;
      while (end < content.length && !isWsp(content.charAt(end))) end++;
      const word = content.slice(at, end);
      const keyword = KEYWORDS.find((k) => k === word);
      if (keyword !== undefined) readMetadata(keyword as MetadataKeyword, content.slice(end), line);
      return;
    }
    readRule(content, line);
  });
  dropPending();
  if (planLine === null) {
    errors.push({
      code: 'missing_plan',
      line: null,
      message: 'The file has no "# plan" line. Add one near the top, like: # plan "Sunday roast"',
    });
  }
  if (errors.length > 0 || title === null) return err(finish(errors));

  const plan = canonicalPlan({
    title,
    dishes,
    steps: stepRules.map((rule): Step => {
      const f = rule.info.fields;
      const hold = f.get('hold');
      const detail = f.get('detail');
      return {
        id: rule.id,
        dish: f.get('dish') ?? '',
        title: f.get('title') ?? '',
        ...(detail === undefined ? {} : { detail }),
        minutes: Number(f.get('minutes')),
        appliance: f.get('appliance') as Appliance,
        handsOn: f.get('handsOn') === 'true',
        after: rule.prerequisites,
        holdMin: hold === 'keeps' ? null : Number(hold),
      };
    }),
  });

  // Mismatch checks (R6.7, R7.9): only when nothing else is wrong.
  for (const rule of dishRules) {
    if (!dishes.some((d) => d.id === rule.id)) {
      errors.push({
        code: 'dish_target_mismatch',
        line: rule.line,
        dishId: rule.id,
        message: where(
          rule.line,
          `there is no "# dish ${rule.id}" line for the rule ${rule.id}. Add the dish or remove the rule.`,
        ),
      });
      continue;
    }
    const expected = lastSteps(plan, rule.id);
    if (!sameSet(rule.prerequisites, expected)) {
      errors.push({
        code: 'dish_target_mismatch',
        line: rule.line,
        dishId: rule.id,
        message: where(
          rule.line,
          expected.length === 0
            ? `the rule for dish ${rule.id} must list no steps, because the dish has none. Fix it or remove the rule.`
            : `the rule for dish ${rule.id} must list the dish's last steps: ${listOf(expected)}. Fix it or remove the rule.`,
        ),
      });
    }
  }
  const dinner = dinnerRule as PrerequisiteRule | null;
  if (dinner !== null) {
    const expected = terminalSteps(plan);
    if (!sameSet(dinner.prerequisites, expected)) {
      errors.push({
        code: 'dinner_mismatch',
        line: dinner.line,
        message: where(
          dinner.line,
          expected.length === 0
            ? 'dinner must list no steps, because the plan has no terminal step. Fix it or remove the rule.'
            : `dinner must list the plan's terminal steps: ${listOf(expected)}. Fix it or remove the rule.`,
        ),
      });
    }
  }
  if (errors.length > 0) return err(finish(errors));

  const options: DinnerfileOptions = {
    ...(kitchen === undefined ? {} : { kitchen }),
    ...(serve === undefined ? {} : { serve }),
  };
  return ok({ plan, options });
}
