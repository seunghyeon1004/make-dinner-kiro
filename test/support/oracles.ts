import type { Kitchen, Plan, ScheduledStep } from '../../src/core/schema.js';

// Independent recomputations for tests (testing.md). Plain loops, brute force, no import
// from src/core other than types. Every number and word list below is written out here on
// purpose, so that a mistake in src/ cannot hide in a shared constant.

interface Node {
  /** Distinct step ids in plain code-unit order. */
  ids: string[];
  /** Prerequisites of each id: union over duplicates, known ids only, sorted, no repeats. */
  prereqs: Map<string, string[]>;
  /** Largest `minutes` over the occurrences of each id. */
  minutes: Map<string, number>;
}

function sortedUnique(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!out.includes(v)) out.push(v);
  }
  // Array.prototype.sort without a comparator compares UTF-16 code units.
  return out.sort();
}

function nodes(plan: Plan): Node {
  const ids = sortedUnique(plan.steps.map((s) => s.id));
  const prereqs = new Map<string, string[]>();
  const minutes = new Map<string, number>();
  for (const id of ids) {
    const collected: string[] = [];
    let largest = 0;
    for (const step of plan.steps) {
      if (step.id !== id) continue;
      for (const p of step.after) {
        if (ids.includes(p)) collected.push(p);
      }
      if (step.minutes > largest) largest = step.minutes;
    }
    prereqs.set(id, sortedUnique(collected));
    minutes.set(id, largest);
  }
  return { ids, prereqs, minutes };
}

const prereqsOf = (n: Node, id: string): string[] => n.prereqs.get(id) ?? [];

/** For every step id, the ids of the steps that list it in `after`, sorted. */
export function oracleSuccessors(plan: Plan): Record<string, string[]> {
  const n = nodes(plan);
  const result: Record<string, string[]> = {};
  for (const p of n.ids) {
    const found: string[] = [];
    for (const s of n.ids) {
      if (prereqsOf(n, s).includes(p)) found.push(s);
    }
    result[p] = found;
  }
  return result;
}

/** Smallest ready id first; `null` when a cycle or a self-dependency blocks the order. */
export function oracleTopologicalOrder(plan: Plan): string[] | null {
  const n = nodes(plan);
  const placed: string[] = [];
  for (let round = 0; round < n.ids.length; round++) {
    let pick: string | null = null;
    for (const id of n.ids) {
      if (placed.includes(id)) continue;
      if (prereqsOf(n, id).every((p) => placed.includes(p))) {
        pick = id;
        break; // ids are sorted, so the first ready id is the smallest
      }
    }
    if (pick === null) return null;
    placed.push(pick);
  }
  return placed;
}

/** `order` lists every step id exactly once and every prerequisite before its step. */
export function respectsPrecedence(plan: Plan, order: readonly string[]): boolean {
  const n = nodes(plan);
  if (order.length !== n.ids.length) return false;
  for (const id of n.ids) {
    let count = 0;
    for (const o of order) {
      if (o === id) count++;
    }
    if (count !== 1) return false;
  }
  for (const s of n.ids) {
    for (const p of prereqsOf(n, s)) {
      if (order.indexOf(p) >= order.indexOf(s)) return false;
    }
  }
  return true;
}

/** `path` is a cycle of two or more distinct steps, each listed before the step that waits on it. */
export function isCycleIn(plan: Plan, path: readonly string[]): boolean {
  const n = nodes(plan);
  if (path.length < 2) return false;
  for (let i = 0; i < path.length; i++) {
    const id = path[i] ?? '';
    if (!n.ids.includes(id)) return false;
    for (let j = i + 1; j < path.length; j++) {
      if (path[j] === id) return false;
    }
  }
  for (let i = 0; i < path.length; i++) {
    const before = path[i] ?? '';
    const after = path[(i + 1) % path.length] ?? '';
    if (!prereqsOf(n, after).includes(before)) return false;
  }
  return true;
}

/** Groups of two or more steps that all wait on each other; self-dependencies ignored. */
export function oracleStronglyConnected(plan: Plan): string[][] {
  const n = nodes(plan);
  const size = n.ids.length;
  const reach: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    const row: boolean[] = [];
    for (let j = 0; j < size; j++) {
      const from = n.ids[i] ?? '';
      const to = n.ids[j] ?? '';
      row.push(i !== j && prereqsOf(n, to).includes(from));
    }
    reach.push(row);
  }
  for (let k = 0; k < size; k++) {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const row = reach[i];
        if (row !== undefined && row[k] && reach[k]?.[j]) row[j] = true;
      }
    }
  }
  const groups: string[][] = [];
  const assigned: boolean[] = n.ids.map(() => false);
  for (let i = 0; i < size; i++) {
    if (assigned[i]) continue;
    const group: string[] = [];
    for (let j = 0; j < size; j++) {
      if (j === i || (reach[i]?.[j] && reach[j]?.[i])) {
        group.push(n.ids[j] ?? '');
        assigned[j] = true;
      }
    }
    if (group.length >= 2) groups.push(group);
  }
  return groups;
}

/** Length of the shortest cycle through `id` (two or more steps), or `null`. */
export function oracleShortestCycleLength(plan: Plan, id: string): number | null {
  const n = nodes(plan);
  if (!n.ids.includes(id)) return null;
  const succ = oracleSuccessors(plan);
  const dist = new Map<string, number>([[id, 0]]);
  let frontier = [id];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const v of frontier) {
      for (const s of succ[v] ?? []) {
        if (s === v || dist.has(s)) continue;
        dist.set(s, (dist.get(v) ?? 0) + 1);
        next.push(s);
      }
    }
    frontier = next;
  }
  let best: number | null = null;
  for (const [v, d] of dist) {
    if (v === id) continue;
    if (prereqsOf(n, id).includes(v) && (best === null || d + 1 < best)) best = d + 1;
  }
  return best;
}

/** Largest sum of `minutes` along any dependency path, by repeated relaxation. */
export function oracleLongestChain(plan: Plan): number {
  const n = nodes(plan);
  const best = new Map<string, number>();
  for (const id of n.ids) best.set(id, n.minutes.get(id) ?? 0);
  for (let round = 0; round < n.ids.length; round++) {
    for (const s of n.ids) {
      let longestBefore = 0;
      for (const p of prereqsOf(n, s)) {
        if (p === s) continue;
        longestBefore = Math.max(longestBefore, best.get(p) ?? 0);
      }
      best.set(s, (n.minutes.get(s) ?? 0) + longestBefore);
    }
  }
  let result = 0;
  for (const v of best.values()) result = Math.max(result, v);
  return result;
}

export interface OracleWarning {
  code: 'appliance_mismatch' | 'long_hands_on' | 'short_hands_free';
  stepId: string;
}

// Every word form that makes a step with no appliance look like it needs one (all lower case,
// composed form of sauté).
const APPLIANCE_WORDS: readonly string[] = [
  'oven',
  'ovens',
  'roast',
  'roasts',
  'roasted',
  'roasting',
  'bake',
  'bakes',
  'baked',
  'baking',
  'simmer',
  'simmers',
  'simmered',
  'simmering',
  'boil',
  'boils',
  'boiled',
  'boiling',
  'fry',
  'fries',
  'fried',
  'frying',
  'sear',
  'sears',
  'seared',
  'searing',
  'saut\u00e9',
  'saut\u00e9s',
  'saut\u00e9ed',
  'saut\u00e9ing',
  'saute',
  'sautes',
  'sauteed',
  'sauteing',
];

/** Splits on every character that is not a letter, a mark or a digit. */
function wordsOf(text: string): string[] {
  const words: string[] = [];
  let current = '';
  for (const ch of text.normalize('NFC').toLowerCase()) {
    if (/^[\p{L}\p{M}\p{N}]$/u.test(ch)) {
      current += ch;
    } else {
      if (current !== '') words.push(current);
      current = '';
    }
  }
  if (current !== '') words.push(current);
  return words;
}

/** The `(code, stepId)` pairs of the plan warnings, sorted by code then step id. */
export function oracleWarnings(plan: Plan): OracleWarning[] {
  const found: OracleWarning[] = [];
  const add = (code: OracleWarning['code'], stepId: string): void => {
    if (!found.some((w) => w.code === code && w.stepId === stepId)) found.push({ code, stepId });
  };
  for (const step of plan.steps) {
    if (step.appliance === 'none') {
      const text = [...wordsOf(step.title), ...wordsOf(step.detail ?? '')];
      if (text.some((w) => APPLIANCE_WORDS.includes(w))) add('appliance_mismatch', step.id);
    }
    if (step.handsOn && step.minutes > 45) add('long_hands_on', step.id);
    if (!step.handsOn && step.appliance === 'none' && step.minutes < 2) {
      add('short_hands_free', step.id);
    }
  }
  return found.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    if (a.stepId !== b.stepId) return a.stepId < b.stepId ? -1 : 1;
    return 0;
  });
}

/** ECMAScript white space and line terminators, written out. */
function isWhiteSpace(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function stripEnd(line: string): string {
  let end = line.length;
  while (end > 0 && isWhiteSpace(line.charAt(end - 1))) end--;
  return line.slice(0, end);
}

/** Recipe text in normal form: NFC, LF line ends, no trailing white space, one blank line at most, trimmed. */
export function oracleNormalise(text: string): string {
  const composed = text.normalize('NFC');
  const lines: string[] = [];
  let current = '';
  for (let i = 0; i < composed.length; i++) {
    const ch = composed.charAt(i);
    if (ch === '\n') {
      lines.push(current);
      current = '';
    } else if (ch === '\r') {
      lines.push(current);
      current = '';
      if (composed.charAt(i + 1) === '\n') i++;
    } else {
      current += ch;
    }
  }
  lines.push(current);

  const kept: string[] = [];
  let blankRun = 0;
  for (const raw of lines) {
    const line = stripEnd(raw);
    if (line === '') {
      blankRun++;
      if (blankRun >= 2) continue; // a second blank line in a row is dropped
    } else {
      blankRun = 0;
    }
    kept.push(line);
  }
  const joined = kept.join('\n');

  let start = 0;
  let end = joined.length;
  while (start < end && isWhiteSpace(joined.charAt(start))) start++;
  while (end > start && isWhiteSpace(joined.charAt(end - 1))) end--;
  return joined.slice(start, end);
}

// ---------------------------------------------------------------------------------------
// Scheduler oracles. Written from scheduler-guarantees.md: plain loops over every minute and
// every step, nothing shared with src/core/schedule.ts, passes/ or timeline.ts.

export type Starts = Record<string, number>;
type ResourceName = 'burner' | 'oven' | 'cook';
const RESOURCE_NAMES: readonly ResourceName[] = ['burner', 'oven', 'cook'];

type PlanStep = Plan['steps'][number];

const startOf = (starts: Starts, step: PlanStep): number => starts[step.id] ?? 0;
const endOf = (starts: Starts, step: PlanStep): number => startOf(starts, step) + step.minutes;
const activeAt = (starts: Starts, step: PlanStep, minute: number): boolean =>
  startOf(starts, step) <= minute && minute < endOf(starts, step);

function usesResource(step: PlanStep, resource: ResourceName): boolean {
  if (resource === 'cook') return step.handsOn;
  return step.appliance === resource;
}

function limitOf(kitchen: Kitchen, resource: ResourceName): number {
  if (resource === 'burner') return kitchen.burners;
  if (resource === 'oven') return kitchen.ovens;
  return kitchen.cooks;
}

/** The steps in plain code-unit order of id. */
function byId(plan: Plan): PlanStep[] {
  return [...plan.steps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The steps that list `id` in `after`. */
function usersOf(plan: Plan, id: string): PlanStep[] {
  return byId(plan).filter((s) => s.after.includes(id));
}

/** G1: every minute and resource where more steps are active than the kitchen has units. */
export function oracleCapacityViolations(
  plan: Plan,
  kitchen: Kitchen,
  starts: Starts,
): { minute: number; resource: ResourceName; count: number; limit: number }[] {
  const out: { minute: number; resource: ResourceName; count: number; limit: number }[] = [];
  if (plan.steps.length === 0) return out;
  let first = Infinity;
  let last = -Infinity;
  for (const s of plan.steps) {
    first = Math.min(first, startOf(starts, s));
    last = Math.max(last, endOf(starts, s));
  }
  for (let minute = first; minute < last; minute++) {
    for (const resource of RESOURCE_NAMES) {
      let count = 0;
      for (const s of plan.steps) {
        if (usesResource(s, resource) && activeAt(starts, s, minute)) count++;
      }
      const limit = limitOf(kitchen, resource);
      if (count > limit) out.push({ minute, resource, count, limit });
    }
  }
  return out;
}

/** G2: every step that starts before one of its prerequisites ends. */
export function oraclePrecedenceViolations(
  plan: Plan,
  starts: Starts,
): { stepId: string; prereq: string }[] {
  const out: { stepId: string; prereq: string }[] = [];
  for (const s of byId(plan)) {
    for (const prereq of [...new Set(s.after)].sort()) {
      const p = plan.steps.find((x) => x.id === prereq);
      if (p === undefined) continue;
      if (startOf(starts, s) < endOf(starts, p)) out.push({ stepId: s.id, prereq });
    }
  }
  return out;
}

/**
 * G3: `missing:<id>`, `duplicate:<id>`, `extra:<id>`, then per scheduled step
 * `not_integer:<id>`, `length:<id>` (end - start differs from minutes), `after_serving:<id>`.
 */
export function oracleCompletenessViolations(
  plan: Plan,
  steps: readonly ScheduledStep[],
): string[] {
  const out: string[] = [];
  const planIds = byId(plan).map((s) => s.id);
  for (const id of planIds) {
    const count = steps.filter((s) => s.id === id).length;
    if (count === 0) out.push(`missing:${id}`);
    if (count > 1) out.push(`duplicate:${id}`);
  }
  const extra = [...new Set(steps.map((s) => s.id))].filter((id) => !planIds.includes(id)).sort();
  for (const id of extra) out.push(`extra:${id}`);
  const entries = [...steps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const e of entries) {
    const step = plan.steps.find((s) => s.id === e.id);
    if (step === undefined) continue;
    if (!Number.isInteger(e.startMin) || !Number.isInteger(e.endMin))
      out.push(`not_integer:${e.id}`);
    if (e.endMin - e.startMin !== step.minutes) out.push(`length:${e.id}`);
    if (e.endMin > 0) out.push(`after_serving:${e.id}`);
  }
  return out;
}

/** G1 to G3 on bare starts: integers, nothing ends after 0, no capacity or precedence violation. */
export function oracleValid(plan: Plan, kitchen: Kitchen, starts: Starts): boolean {
  for (const s of plan.steps) {
    const start = starts[s.id];
    if (start === undefined || !Number.isInteger(start)) return false;
    if (start + s.minutes > 0) return false;
  }
  return (
    oracleCapacityViolations(plan, kitchen, starts).length === 0 &&
    oraclePrecedenceViolations(plan, starts).length === 0
  );
}

/**
 * Notation of scheduler-guarantees.md: null where the result keeps; for a terminal step
 * `0 - end`; otherwise the latest start of its users minus its end.
 */
export function oracleWaits(plan: Plan, starts: Starts): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const s of byId(plan)) {
    if (s.holdMin === null) {
      out[s.id] = null;
      continue;
    }
    const users = usersOf(plan, s.id);
    if (users.length === 0) {
      out[s.id] = 0 - endOf(starts, s);
      continue;
    }
    let latest = -Infinity;
    for (const u of users) latest = Math.max(latest, startOf(starts, u));
    out[s.id] = latest - endOf(starts, s);
  }
  return out;
}

/** G4.3: every step whose wait is longer than its hold, by id. */
export function oracleHoldExceeded(
  plan: Plan,
  starts: Starts,
): { stepId: string; waitMin: number; holdMin: number }[] {
  const waits = oracleWaits(plan, starts);
  const out: { stepId: string; waitMin: number; holdMin: number }[] = [];
  for (const s of byId(plan)) {
    const wait = waits[s.id];
    if (wait === null || wait === undefined || s.holdMin === null) continue;
    if (wait > s.holdMin) out.push({ stepId: s.id, waitMin: wait, holdMin: s.holdMin });
  }
  return out;
}

/**
 * G5.1 and G6: `lane_missing:<id>:<resource>`, `lane_extra:<id>:<resource>`,
 * `lane_range:<id>:<resource>`, then `lane_clash:<resource>:<lane>:<idA>:<idB>` (idA < idB).
 */
export function oracleLaneViolations(
  plan: Plan,
  kitchen: Kitchen,
  steps: readonly ScheduledStep[],
): string[] {
  const out: string[] = [];
  const entryOf = (id: string): ScheduledStep | undefined => steps.find((e) => e.id === id);
  for (const s of byId(plan)) {
    const entry = entryOf(s.id);
    if (entry === undefined) continue;
    for (const resource of RESOURCE_NAMES) {
      const lane = entry.lanes[resource];
      const needed = usesResource(s, resource);
      if (needed && lane === null) out.push(`lane_missing:${s.id}:${resource}`);
      if (!needed && lane !== null) out.push(`lane_extra:${s.id}:${resource}`);
      if (
        lane !== null &&
        !(Number.isInteger(lane) && lane >= 1 && lane <= limitOf(kitchen, resource))
      ) {
        out.push(`lane_range:${s.id}:${resource}`);
      }
    }
  }
  const ids = byId(plan).map((s) => s.id);
  for (const resource of RESOURCE_NAMES) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = entryOf(ids[i] ?? '');
        const b = entryOf(ids[j] ?? '');
        if (a === undefined || b === undefined) continue;
        const lane = a.lanes[resource];
        if (lane === null || lane !== b.lanes[resource]) continue;
        if (a.startMin < b.endMin && b.startMin < a.endMin) {
          out.push(`lane_clash:${resource}:${lane}:${a.id}:${b.id}`);
        }
      }
    }
  }
  return out;
}

/**
 * G8, by the definition: the largest k >= 0 such that delaying the step alone by each d in
 * 1..k keeps G1 to G3 true (lanes ignored, holds not considered). Tries d = 1, 2, ... and
 * stops at the first failure.
 */
export function oracleSlack(plan: Plan, kitchen: Kitchen, starts: Starts, stepId: string): number {
  const step = plan.steps.find((s) => s.id === stepId);
  if (step === undefined) return 0;
  const users = usersOf(plan, stepId);
  const others = plan.steps.filter((s) => s.id !== stepId);
  for (let d = 1; ; d++) {
    const newStart = startOf(starts, step) + d;
    const newEnd = newStart + step.minutes;
    if (newEnd > 0) return d - 1;
    if (users.some((u) => startOf(starts, u) < newEnd)) return d - 1;
    for (let minute = newStart; minute < newEnd; minute++) {
      for (const resource of RESOURCE_NAMES) {
        if (!usesResource(step, resource)) continue;
        let count = 1;
        for (const o of others) {
          if (usesResource(o, resource) && activeAt(starts, o, minute)) count++;
        }
        if (count > limitOf(kitchen, resource)) return d - 1;
      }
    }
  }
}

export function startsOf(steps: readonly ScheduledStep[]): Starts {
  const out: Starts = {};
  for (const s of steps) out[s.id] = s.startMin;
  return out;
}
