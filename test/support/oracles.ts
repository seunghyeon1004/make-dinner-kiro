import type { Kitchen, Plan, Progress, RebuiltStep, ScheduledStep } from '../../src/core/schema.js';

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
        // An empty interval (end == start, a rebuild step done in zero time) holds no minute.
        const bothHoldAMinute = a.startMin < a.endMin && b.startMin < b.endMin;
        if (bothHoldAMinute && a.startMin < b.endMin && b.startMin < a.endMin) {
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

/**
 * For a rebuilt schedule (R7): where serving is, and the intervals of the pinned steps (done
 * and running), which are the ones `startsOf`-style start maps cannot describe.
 */
export interface LatestPositionContext {
  servingMin: number;
  pinned: Iv;
}

/**
 * G9: the latest start the step can have with everything else fixed (lanes ignored). Tries every
 * delay d in 1..(deadline - end), where the deadline is minute 0 or the earliest start of a
 * user, and keeps the largest d for which the step's resources are free in all its new minutes
 * (G1; G2 and G3 hold by the deadline). Returns the current start when no delay works.
 *
 * R7: with a `context`, the deadline starts at `context.servingMin`, only users that are not
 * pinned bound it (a pinned user has already happened), and a pinned step occupies its pinned
 * interval rather than `[start, start + minutes)`.
 */
export function oracleLatestPosition(
  plan: Plan,
  kitchen: Kitchen,
  starts: Starts,
  stepId: string,
  context?: LatestPositionContext,
): number {
  const step = plan.steps.find((s) => s.id === stepId);
  if (step === undefined) return 0;
  const current = startOf(starts, step);
  const pinnedIv = context?.pinned ?? {};
  const intervalFor = (o: PlanStep): { startMin: number; endMin: number } =>
    pinnedIv[o.id] ?? { startMin: startOf(starts, o), endMin: endOf(starts, o) };
  const users = usersOf(plan, stepId).filter((u) => pinnedIv[u.id] === undefined);
  let deadline = context?.servingMin ?? 0;
  for (const u of users) deadline = Math.min(deadline, startOf(starts, u));
  // Minutes in use by every other step, per resource this step needs (G1 for the new place).
  const used = new Map<string, number>();
  for (const o of plan.steps) {
    if (o.id === stepId) continue;
    const { startMin, endMin } = intervalFor(o);
    for (const resource of RESOURCE_NAMES) {
      if (!usesResource(step, resource) || !usesResource(o, resource)) continue;
      for (let minute = startMin; minute < endMin; minute++) {
        const key = `${resource}:${minute}`;
        used.set(key, (used.get(key) ?? 0) + 1);
      }
    }
  }
  let latest = current;
  for (let d = 1; current + d + step.minutes <= deadline; d++) {
    let fits = true;
    for (let minute = current + d; minute < current + d + step.minutes && fits; minute++) {
      for (const resource of RESOURCE_NAMES) {
        if (!usesResource(step, resource)) continue;
        if ((used.get(`${resource}:${minute}`) ?? 0) + 1 > limitOf(kitchen, resource)) fits = false;
      }
    }
    if (fits) latest = current + d;
  }
  return latest;
}

export function startsOf(steps: readonly ScheduledStep[]): Starts {
  const out: Starts = {};
  for (const s of steps) out[s.id] = s.startMin;
  return out;
}

// ---------------------------------------------------------------------------------------
// Rebuild oracles (rebuild spec). Written from scheduler-guarantees.md (R1 to R6) and the
// rules of the rebuild design, with plain loops over minutes and steps; nothing is shared with
// src/core/rebuild.ts, passes/ or timeline.ts.

/** Intervals `[startMin, endMin)` by step id. */
export type Iv = Record<string, { startMin: number; endMin: number }>;

/** A step is pending when `progress` has no entry for it. */
const isPending = (progress: Progress, id: string): boolean => progress[id] === undefined;

const intervalOf = (iv: Iv, id: string): { startMin: number; endMin: number } =>
  iv[id] ?? { startMin: 0, endMin: 0 };

/** Resource use at one minute over every interval in `iv` except `skip`. */
function useAt(
  plan: Plan,
  iv: Iv,
  resource: ResourceName,
  minute: number,
  skip: string | null,
): number {
  let count = 0;
  for (const s of plan.steps) {
    if (s.id === skip || !usesResource(s, resource)) continue;
    const i = iv[s.id];
    if (i !== undefined && i.startMin <= minute && minute < i.endMin) count++;
  }
  return count;
}

/**
 * RQ2.2: a done step keeps `[startMin, endMin)`; a running step lasts
 * `[startMin, max(startMin + minutes + extraMin, now))`.
 */
export function oraclePinnedIntervals(plan: Plan, progress: Progress, now: number): Iv {
  const out: Iv = {};
  for (const step of byId(plan)) {
    const entry = progress[step.id];
    if (entry === undefined) continue;
    if (entry.state === 'done') {
      out[step.id] = { startMin: entry.startMin, endMin: entry.endMin };
    } else {
      out[step.id] = {
        startMin: entry.startMin,
        endMin: Math.max(entry.startMin + step.minutes + entry.extraMin, now),
      };
    }
  }
  return out;
}

const intervalsOfSteps = (
  steps: readonly { id: string; startMin: number; endMin: number }[],
): Iv => {
  const out: Iv = {};
  for (const s of steps) out[s.id] = { startMin: s.startMin, endMin: s.endMin };
  return out;
};

/**
 * R1 on a rebuilt schedule: `capacity:<resource>:<minute>` for every minute >= now where the
 * use exceeds the kitchen; `precedence:<step>:<prereq>` for every pending step that starts
 * before a prerequisite ends; G3: `missing:`, `duplicate:`, `extra:`, `not_integer:<id>`,
 * `length:<id>` (a pending step not lasting its minutes, or a pinned step differing from its
 * RQ2.2 interval), `after_serving:<id>`; and R2 `before_now:<id>` for a pending step starting
 * before now.
 */
export function oracleRebuildViolations(
  plan: Plan,
  kitchen: Kitchen,
  progress: Progress,
  now: number,
  steps: readonly RebuiltStep[],
  servingMin: number,
): string[] {
  const out: string[] = [];
  const iv = intervalsOfSteps(steps);
  const planIds = byId(plan).map((s) => s.id);
  for (const id of planIds) {
    const count = steps.filter((s) => s.id === id).length;
    if (count === 0) out.push(`missing:${id}`);
    if (count > 1) out.push(`duplicate:${id}`);
  }
  for (const id of [...new Set(steps.map((s) => s.id))]
    .filter((x) => !planIds.includes(x))
    .sort()) {
    out.push(`extra:${id}`);
  }
  const pinned = oraclePinnedIntervals(plan, progress, now);
  for (const step of byId(plan)) {
    const i = iv[step.id];
    if (i === undefined) continue;
    if (!Number.isInteger(i.startMin) || !Number.isInteger(i.endMin))
      out.push(`not_integer:${step.id}`);
    const expected = pinned[step.id];
    if (expected !== undefined) {
      if (i.startMin !== expected.startMin || i.endMin !== expected.endMin)
        out.push(`length:${step.id}`);
    } else {
      if (i.endMin - i.startMin !== step.minutes) out.push(`length:${step.id}`);
      if (i.startMin < now) out.push(`before_now:${step.id}`);
    }
    if (i.endMin > servingMin) out.push(`after_serving:${step.id}`);
  }
  for (const step of byId(plan)) {
    if (!isPending(progress, step.id)) continue;
    const i = iv[step.id];
    if (i === undefined) continue;
    for (const prereq of [...new Set(step.after)].sort()) {
      const p = iv[prereq];
      if (p !== undefined && i.startMin < p.endMin) out.push(`precedence:${step.id}:${prereq}`);
    }
  }
  let first = Infinity;
  let last = -Infinity;
  for (const s of steps) {
    first = Math.min(first, s.startMin);
    last = Math.max(last, s.endMin);
  }
  for (let minute = Math.max(first, now); minute < last; minute++) {
    for (const resource of RESOURCE_NAMES) {
      const count = useAt(plan, iv, resource, minute, null);
      if (count > limitOf(kitchen, resource)) out.push(`capacity:${resource}:${minute}`);
    }
  }
  return out;
}

/**
 * P-RB4: `overfull:<step>:<resource>:<minute>` for every minute where a pending step is active
 * and the use of that resource, the step included, exceeds the kitchen.
 */
export function oraclePendingOverfull(
  plan: Plan,
  kitchen: Kitchen,
  progress: Progress,
  _now: number,
  steps: readonly RebuiltStep[],
): string[] {
  const out: string[] = [];
  const iv = intervalsOfSteps(steps);
  for (const step of byId(plan)) {
    const i = iv[step.id];
    if (!isPending(progress, step.id) || i === undefined) continue;
    for (const resource of RESOURCE_NAMES) {
      if (!usesResource(step, resource)) continue;
      for (let minute = i.startMin; minute < i.endMin; minute++) {
        if (useAt(plan, iv, resource, minute, null) > limitOf(kitchen, resource)) {
          out.push(`overfull:${step.id}:${resource}:${minute}`);
        }
      }
    }
  }
  return out;
}

/**
 * RQ4: the forward-repair intervals. Pinned steps keep their RQ2.2 interval. Pending steps are
 * placed one at a time: among those whose pending prerequisites are all placed, the smallest
 * `(prev start, id)`; it starts at the first minute >= max(prev start, now, end of each
 * prerequisite) from which every resource it uses has a free unit in every minute (each start
 * is tried in turn), counting the pinned steps and the pending steps already placed.
 */
export function oracleForwardRepair(
  plan: Plan,
  kitchen: Kitchen,
  progress: Progress,
  now: number,
  prevStarts: Starts,
): Iv {
  const iv: Iv = oraclePinnedIntervals(plan, progress, now);
  const unplaced = byId(plan).filter((s) => isPending(progress, s.id));
  while (unplaced.length > 0) {
    const ready = unplaced.filter((s) =>
      s.after.every((p) => iv[p] !== undefined || !isPending(progress, p)),
    );
    let pick: PlanStep | undefined;
    for (const s of ready) {
      if (
        pick === undefined ||
        startOf(prevStarts, s) < startOf(prevStarts, pick) ||
        (startOf(prevStarts, s) === startOf(prevStarts, pick) && s.id < pick.id)
      ) {
        pick = s;
      }
    }
    if (pick === undefined) throw new Error('oracleForwardRepair: no ready step (a cycle?)');
    let lower = Math.max(startOf(prevStarts, pick), now);
    for (const p of pick.after) lower = Math.max(lower, intervalOf(iv, p).endMin);
    let start = lower;
    for (;;) {
      let fits = true;
      for (let minute = start; minute < start + pick.minutes && fits; minute++) {
        for (const resource of RESOURCE_NAMES) {
          if (!usesResource(pick, resource)) continue;
          if (useAt(plan, iv, resource, minute, null) + 1 > limitOf(kitchen, resource))
            fits = false;
        }
      }
      if (fits) break;
      start++;
      if (start > 100_000) throw new Error('oracleForwardRepair: no room found');
    }
    iv[pick.id] = { startMin: start, endMin: start + pick.minutes };
    unplaced.splice(unplaced.indexOf(pick), 1);
  }
  return iv;
}

/**
 * RQ8.3: null where the result keeps; a terminal step `servingMin - end`; otherwise
 * `max(0, latest successor start - end)`.
 */
export function oracleRebuildWaits(
  plan: Plan,
  iv: Iv,
  servingMin: number,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const s of byId(plan)) {
    if (s.holdMin === null) {
      out[s.id] = null;
      continue;
    }
    const users = usersOf(plan, s.id);
    const end = intervalOf(iv, s.id).endMin;
    if (users.length === 0) {
      out[s.id] = servingMin - end;
      continue;
    }
    let latest = -Infinity;
    for (const u of users) latest = Math.max(latest, intervalOf(iv, u.id).startMin);
    out[s.id] = Math.max(0, latest - end);
  }
  return out;
}

/** RQ8.4: every step whose wait is longer than its hold, by id. */
export function oracleRebuildHoldExceeded(
  plan: Plan,
  iv: Iv,
  servingMin: number,
): { stepId: string; waitMin: number; holdMin: number }[] {
  const waits = oracleRebuildWaits(plan, iv, servingMin);
  const out: { stepId: string; waitMin: number; holdMin: number }[] = [];
  for (const s of byId(plan)) {
    const wait = waits[s.id];
    if (wait === null || wait === undefined || s.holdMin === null) continue;
    if (wait > s.holdMin) out.push({ stepId: s.id, waitMin: wait, holdMin: s.holdMin });
  }
  return out;
}

/**
 * RQ8.1 and RQ8.2: 0 for a pinned step. For a pending step, the largest k >= 0 such that
 * delaying it alone by each d in 1..k keeps it ending at or before `servingMin`, before the
 * start of each pending successor, and with a free unit of every resource it uses in every
 * minute of its new window (all other intervals counted). Tries d = 1, 2, ... until one fails.
 */
export function oracleRebuildSlack(
  plan: Plan,
  kitchen: Kitchen,
  progress: Progress,
  _now: number,
  iv: Iv,
  servingMin: number,
  stepId: string,
): number {
  const step = plan.steps.find((s) => s.id === stepId);
  if (step === undefined || !isPending(progress, stepId)) return 0;
  const here = intervalOf(iv, stepId);
  const pendingUsers = usersOf(plan, stepId).filter((u) => isPending(progress, u.id));
  for (let d = 1; ; d++) {
    const newStart = here.startMin + d;
    const newEnd = here.endMin + d;
    if (newEnd > servingMin) return d - 1;
    if (pendingUsers.some((u) => intervalOf(iv, u.id).startMin < newEnd)) return d - 1;
    for (let minute = newStart; minute < newEnd; minute++) {
      for (const resource of RESOURCE_NAMES) {
        if (!usesResource(step, resource)) continue;
        if (useAt(plan, iv, resource, minute, stepId) + 1 > limitOf(kitchen, resource))
          return d - 1;
      }
    }
  }
}

/**
 * RQ7: the field and range violations of `oracleLaneViolations`, and the lane clashes that
 * RQ7.2 does not allow. A clash of two overlapping steps on one lane is allowed only when the
 * one that comes later in `(start, id)` order is pinned and the use of that resource at its
 * start exceeds the kitchen.
 */
export function oracleRebuildLaneViolations(
  plan: Plan,
  kitchen: Kitchen,
  iv: Iv,
  pinned: readonly string[],
  steps: readonly RebuiltStep[],
): string[] {
  return oracleLaneViolations(plan, kitchen, steps).filter((v) => {
    const parts = v.split(':');
    if (parts[0] !== 'lane_clash') return true;
    const resource = parts[1] as ResourceName;
    const a = parts[3] ?? '';
    const b = parts[4] ?? '';
    const ia = intervalOf(iv, a);
    const ib = intervalOf(iv, b);
    const bIsLater = ib.startMin > ia.startMin || (ib.startMin === ia.startMin && b > a);
    const later = bIsLater ? b : a;
    const laterStart = bIsLater ? ib.startMin : ia.startMin;
    const allowed =
      pinned.includes(later) &&
      useAt(plan, iv, resource, laterStart, null) > limitOf(kitchen, resource);
    return !allowed;
  });
}

// ---------------------------------------------------------------------------------------
// Dinnerfile oracles (dinnerfile spec). Written from the design's tables, without looking at
// src/core/dinnerfile.ts. Stubs until the T1.4 tests have failed.

/**
 * The options of an export, spelled out here so that this file imports only from
 * `schema.js` (the meta test on oracle imports); structurally `DinnerfileOptions`.
 */
export interface DinnerfileOptions {
  kitchen?: Kitchen;
  serve?: string;
}

/** Every way of writing the same plan that the import accepts (requirements R6.6). */
export interface DinnerfileStyle {
  eol: 'lf' | 'crlf';
  bom: boolean;
  header: boolean;
  phony: 'one' | 'none' | 'per-rule';
  dinnerRule: boolean;
  dishRules: boolean;
  /** `echo` the exported line, `none` no recipe line, `true` `\t@true`, `fail` `\techo "$@" ; exit 1`. */
  recipes: 'echo' | 'none' | 'true' | 'fail';
  /** Appended to every line (white space at line ends). */
  lineEndSpace: string;
  /** A blank line after every nth line; 0 for none. */
  blankEvery: number;
  /** Unknown comments, cycled through and inserted after every `commentEvery` lines; 0 for none. */
  comments: readonly string[];
  commentEvery: number;
  /** Spaces before every comment and rule line. */
  indent: string;
  /** Write ` # note` after every rule line. */
  ruleNote: boolean;
  /** The order of the keys of a `# step` line, and of a `# kitchen` line. */
  stepKeys: readonly string[];
  kitchenKeys: readonly string[];
  /** Runs of SP and HTAB between fields and between prerequisites. */
  separator: string;
  spaceAfterColon: boolean;
  stepOrder: 'canonical' | 'reversed' | 'rotated';
  dishOrder: 'canonical' | 'reversed' | 'rotated';
  optionOrder: 'canonical' | 'reversed';
  /** The `# plan`, `# dish`, `# kitchen` and `# serve` lines after the step blocks. */
  metadataAtBottom: boolean;
  /** `\uXXXX` for every non-ASCII code point and `\/` for `/` in strings. */
  escapes: boolean;
  /** Repeat the first prerequisite of every rule that has one. */
  repeatPrerequisite: boolean;
}

export const CANONICAL_STYLE: DinnerfileStyle = {
  eol: 'lf',
  bom: false,
  header: true,
  phony: 'one',
  dinnerRule: true,
  dishRules: true,
  recipes: 'echo',
  lineEndSpace: '',
  blankEvery: 0,
  comments: [],
  commentEvery: 0,
  indent: '',
  ruleNote: false,
  stepKeys: ['dish', 'minutes', 'appliance', 'handsOn', 'hold', 'title', 'detail'],
  kitchenKeys: ['burners', 'ovens', 'cooks'],
  separator: ' ',
  spaceAfterColon: true,
  stepOrder: 'canonical',
  dishOrder: 'canonical',
  optionOrder: 'canonical',
  metadataAtBottom: false,
  escapes: false,
  repeatPrerequisite: false,
};

const STEP_ID_ORACLE = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** A lone surrogate is a one-unit string in a code point iteration. */
const isLoneSurrogate = (cp: number): boolean => cp >= 0xd800 && cp <= 0xdfff;
const isControl = (cp: number): boolean => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
const isBidi = (cp: number): boolean =>
  cp === 0x61c ||
  cp === 0x200e ||
  cp === 0x200f ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069);
const hex4 = (n: number): string => `\\u${n.toString(16).padStart(4, '0')}`;

/** The text of a metadata string, as the design's table writes it (with the quotes). */
function encode(text: string, escapes: boolean): string {
  let out = '"';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (cp === 8) out += '\\b';
    else if (cp === 12) out += '\\f';
    else if (cp === 10) out += '\\n';
    else if (cp === 13) out += '\\r';
    else if (cp === 9) out += '\\t';
    else if (
      isControl(cp) ||
      cp === 0x2028 ||
      cp === 0x2029 ||
      isBidi(cp) ||
      cp === 0xfeff ||
      isLoneSurrogate(cp)
    ) {
      out += hex4(cp);
    } else if (escapes && ch === '/') out += '\\/';
    else if (escapes && cp > 0x7f) {
      if (cp > 0xffff) {
        const offset = cp - 0x10000;
        out += hex4(0xd800 + Math.floor(offset / 0x400)) + hex4(0xdc00 + (offset % 0x400));
      } else out += hex4(cp);
    } else out += ch;
  }
  return out + '"';
}

export function oracleEncodeText(text: string): string {
  return encode(text, false);
}

/** R3.2: the title as one line of text, before shell and Make quoting. */
function displayForm(title: string): string {
  let out = '';
  for (const ch of title) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isControl(cp) || cp === 0x2028 || cp === 0x2029) out += ' ';
    else if (isBidi(cp) || cp === 0xfeff || isLoneSurrogate(cp)) out += '\ufffd';
    else out += ch;
  }
  return out;
}

export function oracleEchoText(title: string): string {
  return displayForm(title);
}

/** R3.3: the single-quoted shell word's content, with Make's `$` doubled. */
function echoArgument(title: string): string {
  const points = [...displayForm(title)];
  let out = '';
  points.forEach((ch, i) => {
    if (ch === "'") out += "'\\''";
    else if (ch === '$') {
      out += '$$';
      const next = points[i + 1];
      if (next === '(' || next === '{') out += "''";
    } else out += ch;
  });
  return out;
}

const lessThan = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Distinct values in first-seen order. */
const distinct = (values: readonly string[]): string[] => {
  const out: string[] = [];
  for (const v of values) if (!out.includes(v)) out.push(v);
  return out;
};

/** The oracle's own canonical plan: dishes and steps by id, each `after` sorted and distinct. */
function canonical(plan: Plan): Plan {
  return {
    title: plan.title,
    dishes: [...plan.dishes].sort((a, b) => lessThan(a.id, b.id)),
    steps: [...plan.steps]
      .map((step) => ({ ...step, after: distinct([...step.after].sort(lessThan)) }))
      .sort((a, b) => lessThan(a.id, b.id)),
  };
}

function terminalIds(plan: Plan): string[] {
  const used: string[] = [];
  for (const step of plan.steps) used.push(...step.after);
  return plan.steps.filter((s) => !used.includes(s.id)).map((s) => s.id);
}

function lastStepIds(plan: Plan, dishId: string): string[] {
  const mine = plan.steps.filter((s) => s.dish === dishId);
  return mine
    .filter((s) => !mine.some((u) => u.after.includes(s.id)))
    .map((s) => s.id)
    .sort(lessThan);
}

/** R1.7: for every declared dish, the steps of the dish that no other step of it waits on. */
export function oracleDishLastSteps(plan: Plan): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const dish of canonical(plan).dishes) out[dish.id] = lastStepIds(canonical(plan), dish.id);
  return out;
}

/**
 * R9.2: the steps of the dish and, again and again, the prerequisites of steps already in the
 * set, until nothing is added. Sorted.
 */
export function oracleNeededSteps(plan: Plan, dishId: string): string[] {
  const needed = plan.steps.filter((s) => s.dish === dishId).map((s) => s.id);
  for (let changed = true; changed;) {
    changed = false;
    for (const step of plan.steps) {
      if (!needed.includes(step.id)) continue;
      for (const p of step.after) {
        if (!needed.includes(p) && plan.steps.some((s) => s.id === p)) {
          needed.push(p);
          changed = true;
        }
      }
    }
  }
  return needed.sort(lessThan);
}

const HEADER_LINES: readonly string[] = [
  '# Dinnerfile written by Make Dinner. GNU Make reads it:',
  '#   make -n -f Dinnerfile dinner    prints every step in an order that works',
  '#   make -n -f Dinnerfile <dish>    prints the steps one dish needs',
  '# The "# plan", "# dish", "# step", "# kitchen" and "# serve" lines hold the plan.',
];

type LineType = 'comment' | 'rule' | 'recipe' | 'blank';
interface OutLine {
  type: LineType;
  text: string;
}

const reorder = <T>(items: readonly T[], how: 'canonical' | 'reversed' | 'rotated'): T[] => {
  if (how === 'reversed') return [...items].reverse();
  if (how === 'rotated') return [...items.slice(1), ...items.slice(0, 1)];
  return [...items];
};

/**
 * R1: the text of `toDinnerfile(plan, options)` when the style is `CANONICAL_STYLE`; in
 * another style, the same plan written in one of the ways R6.6 says the import accepts.
 */
export function oracleDinnerfile(
  plan: Plan,
  options: DinnerfileOptions,
  style: DinnerfileStyle = CANONICAL_STYLE,
): string {
  const p = canonical(plan);
  const sep = style.separator;
  const str = (text: string): string => encode(text, style.escapes);
  const lines: OutLine[] = [];
  const add = (type: LineType, text: string): void => {
    lines.push({ type, text });
  };
  const rule = (target: string, prereqs: readonly string[]): string => {
    const names =
      style.repeatPrerequisite && prereqs.length > 0 ? [prereqs[0] ?? '', ...prereqs] : prereqs;
    return `${target}:${names.length > 0 ? (style.spaceAfterColon ? sep : '') + names.join(sep) : ''}`;
  };

  const metadata = (): void => {
    add('comment', `#${sep}plan${sep}${str(p.title)}`);
    const optionLines: [string, string][] = [];
    const k = options.kitchen;
    if (k !== undefined) {
      const values: Record<string, number> = { burners: k.burners, ovens: k.ovens, cooks: k.cooks };
      optionLines.push([
        'kitchen',
        `#${sep}kitchen${style.kitchenKeys.map((key) => `${sep}${key}=${values[key] ?? 0}`).join('')}`,
      ]);
    }
    if (options.serve !== undefined) {
      optionLines.push(['serve', `#${sep}serve${sep}${options.serve}`]);
    }
    for (const [, text] of reorder(optionLines, style.optionOrder)) add('comment', text);
    for (const dish of reorder(p.dishes, style.dishOrder)) {
      add('comment', `#${sep}dish${sep}${dish.id}${sep}${str(dish.name)}`);
    }
  };

  if (style.header) {
    for (const text of HEADER_LINES) add('comment', text);
    add('blank', '');
  }
  if (!style.metadataAtBottom) {
    metadata();
    add('blank', '');
  }
  const dishIds = distinct(p.dishes.map((d) => d.id));
  const phonyNames = [
    'dinner',
    ...dishIds.filter((id) => id !== 'dinner'),
    ...p.steps.map((s) => s.id),
  ];
  if (style.phony === 'one') add('rule', `.PHONY:${sep}${phonyNames.join(sep)}`);
  const phonyFor = (target: string): void => {
    if (style.phony === 'per-rule') add('rule', `.PHONY:${sep}${target}`);
  };
  if (style.dinnerRule) {
    phonyFor('dinner');
    add('rule', rule('dinner', terminalIds(p)));
  }
  add('blank', '');
  if (style.dishRules) {
    for (const id of dishIds) {
      if (id === 'dinner') {
        add('comment', '# No target for dish dinner: "dinner" makes the whole plan.');
      } else {
        phonyFor(id);
        add('rule', rule(id, lastStepIds(p, id)));
      }
    }
  }
  for (const step of reorder(p.steps, style.stepOrder)) {
    add('blank', '');
    phonyFor(step.id);
    const values: Record<string, string | undefined> = {
      dish: step.dish,
      minutes: String(step.minutes),
      appliance: step.appliance,
      handsOn: String(step.handsOn),
      hold: step.holdMin === null ? 'keeps' : String(step.holdMin),
      title: str(step.title),
      detail: step.detail === undefined ? undefined : str(step.detail),
    };
    const fields = style.stepKeys
      .filter((key) => values[key] !== undefined)
      .map((key) => `${sep}${key}=${values[key] ?? ''}`)
      .join('');
    add('comment', `#${sep}step${fields}`);
    add('rule', rule(step.id, step.after));
    if (style.recipes === 'echo') {
      add('recipe', `\t@echo '${echoArgument(step.title)}' # ${step.id}`);
    } else if (style.recipes === 'true') add('recipe', '\t@true');
    else if (style.recipes === 'fail') add('recipe', '\techo "$@" ; exit 1');
  }
  if (style.metadataAtBottom) {
    add('blank', '');
    metadata();
  }

  const out: string[] = [];
  let commentIndex = 0;
  lines.forEach((line, i) => {
    let text = line.text;
    if (line.type === 'comment' || line.type === 'rule') text = style.indent + text;
    if (line.type === 'rule' && style.ruleNote) text += ' # note';
    out.push(text + style.lineEndSpace);
    if (style.blankEvery > 0 && (i + 1) % style.blankEvery === 0) out.push(style.lineEndSpace);
    if (style.commentEvery > 0 && (i + 1) % style.commentEvery === 0 && style.comments.length > 0) {
      const note = style.comments[commentIndex % style.comments.length] ?? '';
      commentIndex++;
      out.push(style.indent + note + style.lineEndSpace);
    }
  });
  const eol = style.eol === 'crlf' ? '\r\n' : '\n';
  return (style.bom ? '\ufeff' : '') + out.join(eol) + eol;
}

export type MakeLineKind = 'blank' | 'comment' | 'rule' | 'recipe' | 'other';

const RULE_LINE = /^(?:\.PHONY|[a-z0-9.-]+):(?: [a-z0-9.-]+)*$/;
const RECIPE_PREFIX = "\t@echo '";

function hasControl(text: string): boolean {
  for (const ch of text) if (isControl(ch.codePointAt(0) ?? 0)) return true;
  return false;
}

/** Whether `line` is a recipe line in the form export writes: the argument's tokens only. */
function isEchoRecipe(line: string): boolean {
  if (!line.startsWith(RECIPE_PREFIX)) return false;
  let i = RECIPE_PREFIX.length;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === "'") {
      if (line.startsWith("'\\''", i)) {
        i += 4;
        continue;
      }
      const rest = line.slice(i + 1);
      return rest.startsWith(' # ') && STEP_ID_ORACLE.test(rest.slice(3));
    }
    if (ch === '$') {
      if (line.startsWith("$$''(", i) || line.startsWith("$$''{", i)) {
        i += 4;
        continue;
      }
      const after = line.charAt(i + 2);
      if (line.startsWith('$$', i) && after !== '(' && after !== '{') {
        i += 2;
        continue;
      }
      return false;
    }
    if (isControl(ch.charCodeAt(0))) return false;
    i += 1;
  }
  return false;
}

/** The kind of each LF-separated line, by the forms export may write and nothing looser. */
export function oracleMakeLines(text: string): MakeLineKind[] {
  return text.split('\n').map((line): MakeLineKind => {
    if (line === '') return 'blank';
    if (/[ \t]$/.test(line)) return 'other';
    if (line.startsWith('#')) {
      return hasControl(line) || line.endsWith('\\') ? 'other' : 'comment';
    }
    if (RULE_LINE.test(line)) return 'rule';
    if (isEchoRecipe(line)) return 'recipe';
    return 'other';
  });
}

/**
 * The text and step id of an echo line, or null when it is not one. The `file` stage takes a
 * recipe line as written (HTAB, `@`, and Make's `$$` meaning `$`); `printed` takes what
 * `make -n` prints (`echo '...' # id`).
 */
export function decodeEchoLine(
  line: string,
  stage: 'file' | 'printed',
): { text: string; stepId: string } | null {
  let rest = line;
  if (stage === 'file') {
    if (!rest.startsWith('\t@')) return null;
    rest = rest.slice(2).split('$$').join('$');
  }
  if (!rest.startsWith("echo '")) return null;
  let i = "echo '".length;
  let text = '';
  while (i < rest.length) {
    const ch = rest.charAt(i);
    if (ch !== "'") {
      text += ch;
      i += 1;
      continue;
    }
    if (rest.startsWith("'\\''", i)) {
      text += "'";
      i += 4;
    } else if (rest.charAt(i + 1) === "'") {
      i += 2;
    } else {
      const tail = rest.slice(i + 1);
      if (!tail.startsWith(' # ')) return null;
      const stepId = tail.slice(3);
      return STEP_ID_ORACLE.test(stepId) ? { text, stepId } : null;
    }
  }
  return null;
}

// --- recipe-reader oracles (limits) ---

/**
 * The most calls inside any window of `windowMs`: for each time `a`, the number of times `b`
 * with `a <= b < a + windowMs`. Plain loops; the limiter's own bookkeeping is not used.
 */
export function oracleMaxInWindow(times: readonly number[], windowMs: number): number {
  let best = 0;
  for (const a of times) {
    let inside = 0;
    for (const b of times) {
      if (a <= b && b < a + windowMs) inside += 1;
    }
    if (inside > best) best = inside;
  }
  return best;
}

/** The UTC calendar day of a millisecond time, as `YYYY-MM-DD`; independent of day arithmetic. */
export function oracleUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Replaces every `<recipes>` or `</recipes>` tag (case-insensitive, white space allowed
 * around the slash and the name) with `[recipes]` or `[/recipes]`, by scanning character
 * by character. Written without the regular expression the prompt module uses.
 */
export function oracleNeutraliseTags(text: string): string {
  const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<') {
      let j = i + 1;
      while (isSpace(text[j])) j += 1;
      let slash = false;
      if (text[j] === '/') {
        slash = true;
        j += 1;
        while (isSpace(text[j])) j += 1;
      }
      if (text.slice(j, j + 7).toLowerCase() === 'recipes') {
        j += 7;
        while (isSpace(text[j])) j += 1;
        if (text[j] === '>') {
          out += slash ? '[/recipes]' : '[recipes]';
          i = j + 1;
          continue;
        }
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}
