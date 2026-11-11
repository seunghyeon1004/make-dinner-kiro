import { err, ok, type Result } from './result.js';
import { compareIds, type Plan } from './schema.js';

export interface CycleError {
  kind: 'cycle';
  path: string[];
}

/** The graph every helper reads: one node per distinct step id (R3.1). */
interface Graph {
  /** Distinct step ids in `compareIds` order. */
  ids: string[];
  /** Sorted, distinct prerequisites that are step ids. A self-dependency stays in as a self-loop. */
  prereqs: Map<string, string[]>;
  /** Sorted successors, self-loops included. */
  succ: Map<string, string[]>;
  /** Largest `minutes` over the occurrences of the id. */
  minutes: Map<string, number>;
}

function buildGraph(plan: Plan): Graph {
  const minutes = new Map<string, number>();
  const rawAfter = new Map<string, Set<string>>();
  for (const step of plan.steps) {
    minutes.set(step.id, Math.max(minutes.get(step.id) ?? 0, step.minutes));
    const set = rawAfter.get(step.id) ?? new Set<string>();
    for (const p of step.after) set.add(p);
    rawAfter.set(step.id, set);
  }
  const ids = [...minutes.keys()].sort(compareIds);
  const prereqs = new Map<string, string[]>();
  const succSets = new Map<string, Set<string>>();
  for (const id of ids) succSets.set(id, new Set());
  for (const id of ids) {
    const list = [...(rawAfter.get(id) ?? [])].filter((p) => minutes.has(p)).sort(compareIds);
    prereqs.set(id, list);
    for (const p of list) succSets.get(p)?.add(id);
  }
  const succ = new Map<string, string[]>();
  for (const id of ids) succ.set(id, [...(succSets.get(id) ?? [])].sort(compareIds));
  return { ids, prereqs, succ, minutes };
}

const listOf = (map: Map<string, string[]>, id: string): string[] => map.get(id) ?? [];

export function successors(plan: Plan): ReadonlyMap<string, readonly string[]> {
  return buildGraph(plan).succ;
}

export function terminalSteps(plan: Plan): string[] {
  const g = buildGraph(plan);
  return g.ids.filter((id) => listOf(g.succ, id).length === 0);
}

/** Nodes reachable from `start` along prerequisite-to-step edges, self-loops ignored. */
function reachFrom(g: Graph, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head] ?? '';
    for (const s of listOf(g.succ, v)) {
      if (s === v || seen.has(s)) continue;
      seen.add(s);
      queue.push(s);
    }
  }
  return seen;
}

function cyclesOf(g: Graph): string[][] {
  const reach = new Map<string, Set<string>>();
  for (const id of g.ids) reach.set(id, reachFrom(g, id));
  const assigned = new Set<string>();
  const paths: string[][] = [];
  for (const m of g.ids) {
    if (assigned.has(m)) continue;
    const group = new Set<string>([m]);
    for (const y of reach.get(m) ?? []) {
      if (y !== m && reach.get(y)?.has(m) === true) group.add(y);
    }
    for (const id of group) assigned.add(id);
    if (group.size < 2) continue;
    // Shortest cycle through m: BFS inside the group, successors in id order, first parent kept.
    const parent = new Map<string, string>();
    const queue = [m];
    let last: string | undefined;
    for (let head = 0; head < queue.length && last === undefined; head++) {
      const v = queue[head] ?? '';
      if (v !== m && listOf(g.succ, v).includes(m)) {
        last = v;
        break;
      }
      for (const s of listOf(g.succ, v)) {
        if (s === v || !group.has(s) || s === m || parent.has(s)) continue;
        parent.set(s, v);
        queue.push(s);
      }
    }
    const path: string[] = [];
    for (let v = last; v !== undefined; v = parent.get(v)) path.unshift(v);
    paths.push(path); // the parent chain ends at m, so path starts with m
  }
  return paths;
}

export function findCycles(plan: Plan): string[][] {
  return cyclesOf(buildGraph(plan));
}

function orderOf(g: Graph): Result<string[], CycleError> {
  const indegree = new Map<string, number>();
  for (const id of g.ids) indegree.set(id, listOf(g.prereqs, id).length);
  let ready = g.ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const next = ready[0] ?? '';
    ready = ready.slice(1);
    order.push(next);
    for (const s of listOf(g.succ, next)) {
      const left = (indegree.get(s) ?? 0) - 1;
      indegree.set(s, left);
      if (left === 0) ready.push(s);
    }
    ready.sort(compareIds);
  }
  if (order.length === g.ids.length) return ok(order);
  const selfLoop = g.ids.find((id) => listOf(g.prereqs, id).includes(id));
  const first = cyclesOf(g)[0];
  if (selfLoop !== undefined && (first === undefined || compareIds(selfLoop, first[0] ?? '') < 0)) {
    return err({ kind: 'cycle', path: [selfLoop] });
  }
  return err({ kind: 'cycle', path: first ?? [] });
}

export function topologicalOrder(plan: Plan): Result<string[], CycleError> {
  return orderOf(buildGraph(plan));
}

export function longestChainMinutes(plan: Plan): Result<number, CycleError> {
  const g = buildGraph(plan);
  const order = orderOf(g);
  if (!order.ok) return order;
  const chain = new Map<string, number>();
  let longest = 0;
  for (const id of order.value) {
    let before = 0;
    for (const p of listOf(g.prereqs, id)) before = Math.max(before, chain.get(p) ?? 0);
    const total = (g.minutes.get(id) ?? 0) + before;
    chain.set(id, total);
    longest = Math.max(longest, total);
  }
  return ok(longest);
}
