import { compareIds } from '../../core/index.js';
import { COOK_ANNOUNCE, cookRebuilt, cookUndoWords, cookUndone } from '../copy.js';
import { clockAt, formatClock, MINUTE_MS, minuteAt } from './clock.js';
import { endsAtMs, overdueIds, phaseOf, terminalIdsOf, UP_NEXT_COUNT } from './cook-session.js';
import type { Phase } from './cook-session.js';
import type { CookAction, CookState, LogEntry, UndoLabel } from './cook-slot.js';

export type { Phase } from './cook-session.js';

/** One step as a card. `lateByMin` is set once the step is late by the design's rule (display only). */
export interface CardStep {
  stepId: string;
  title: string;
  detail: string | null;
  dishName: string;
  minutes: number;
  handsOn: boolean;
  plannedStartMs: number;
  state: 'due' | 'running';
  startedAtMs: number | null;
  endsAtMs: number | null;
  /** `endsAtMs - nowMs`, negative when over; running only. */
  remainingMs: number | null;
  /** Titles of prerequisites not done, in plan order; due steps only. */
  waitsFor: string[];
  lateByMin: number | null;
}

export interface LaneCard {
  cookLane: number;
  current: CardStep | null;
  also: CardStep[];
  next: { title: string; startMs: number } | null;
}

export interface UpNextItem {
  stepId: string;
  title: string;
  dishName: string;
  startMs: number;
  inMin: number;
}

export interface DishState {
  dishId: string;
  name: string;
  done: number;
  total: number;
  state:
    { kind: 'done' } | { kind: 'cooking' } | { kind: 'due' } | { kind: 'next'; startMs: number };
}

export interface CookView {
  phase: Phase;
  nowMs: number;
  servingMs: number;
  plannedServingMs: number;
  startMs: number;
  lanes: LaneCard[];
  toStart: CardStep[];
  running: CardStep[];
  upNext: UpNextItem[];
  dishes: DishState[];
  dock: { stepId: string; action: 'start' | 'done' } | null;
  /** True while a step is late: "I'm behind" is emphasised (design review Q4). */
  emphasiseBehind: boolean;
  undo: { label: UndoLabel; untilMs: number } | null;
  finished: { servedMs: number; plannedMs: number } | null;
  /** Newest first. */
  log: LogEntry[];
}

const byStartThenId = <T extends { startMs: number; id: string }>(a: T, b: T): number =>
  a.startMs - b.startMs || compareIds(a.id, b.id);

/**
 * Everything the Cook screen shows, derived from the session and the clock alone (CM2.8).
 * Pure: `nowMs` is an argument and nothing is stored.
 */
export function cookView(state: CookState, nowMs: number): CookView {
  const { core } = state;
  const { schedule } = core;
  const phase = phaseOf(state, nowMs);
  const n = minuteAt(core.axisMs, nowMs);
  const rows = new Map(schedule.steps.map((row) => [row.id, row]));
  const steps = new Map(schedule.plan.steps.map((step) => [step.id, step]));
  const dishNames = new Map(schedule.plan.dishes.map((dish) => [dish.id, dish.name]));
  const late = new Set(overdueIds(core, nowMs));
  const startMsOf = (id: string): number => clockAt(core.axisMs, rows.get(id)?.startMin ?? 0);

  const isDone = (id: string): boolean => core.facts[id]?.state === 'done';
  const pending = schedule.plan.steps.filter((step) => core.facts[step.id] === undefined);
  const due = pending.filter((step) => startMsOf(step.id) <= nowMs);
  const waiting = pending.filter((step) => startMsOf(step.id) > nowMs);
  const runningSteps = schedule.plan.steps.filter(
    (step) => core.facts[step.id]?.state === 'running',
  );

  function card(id: string): CardStep {
    const step = steps.get(id);
    const row = rows.get(id);
    const fact = core.facts[id];
    if (step === undefined || row === undefined) throw new Error(`cookView: no step ${id}`);
    const isRunning = fact?.state === 'running';
    const endsAt = isRunning ? endsAtMs(step, fact) : null;
    const lateBy = late.has(id) ? n - (isRunning ? row.endMin : row.startMin) : null;
    return {
      stepId: id,
      title: step.title,
      detail: step.detail ?? null,
      dishName: dishNames.get(step.dish) ?? step.dish,
      minutes: step.minutes,
      handsOn: step.handsOn,
      plannedStartMs: startMsOf(id),
      state: isRunning ? 'running' : 'due',
      startedAtMs: isRunning ? fact.startedAtMs : null,
      endsAtMs: endsAt,
      remainingMs: endsAt === null ? null : endsAt - nowMs,
      waitsFor: isRunning
        ? []
        : schedule.plan.steps
            .filter((p) => step.after.includes(p.id) && !isDone(p.id))
            .map((p) => p.title),
      lateByMin: lateBy,
    };
  }

  const startedAt = (id: string): number => {
    const fact = core.facts[id];
    return fact === undefined ? 0 : fact.startedAtMs;
  };
  const lanes: LaneCard[] = [];
  for (let lane = 1; lane <= schedule.kitchen.cooks; lane += 1) {
    const inLane = (step: { id: string; handsOn: boolean }): boolean =>
      step.handsOn && rows.get(step.id)?.lanes.cook === lane;
    const runningHere = runningSteps
      .filter(inLane)
      .sort((a, b) => startedAt(a.id) - startedAt(b.id) || compareIds(a.id, b.id));
    const dueHere = due
      .filter(inLane)
      .sort((a, b) => startMsOf(a.id) - startMsOf(b.id) || compareIds(a.id, b.id));
    const cards = [...runningHere, ...dueHere].map((step) => card(step.id));
    const nextStep = waiting
      .filter(inLane)
      .sort((a, b) => startMsOf(a.id) - startMsOf(b.id) || compareIds(a.id, b.id))[0];
    lanes.push({
      cookLane: lane,
      current: cards[0] ?? null,
      also: cards.slice(1),
      next:
        cards.length === 0 && nextStep !== undefined
          ? { title: nextStep.title, startMs: startMsOf(nextStep.id) }
          : null,
    });
  }

  const toStart = due
    .filter((step) => !step.handsOn)
    .sort((a, b) => startMsOf(a.id) - startMsOf(b.id) || compareIds(a.id, b.id))
    .map((step) => card(step.id));
  const running = runningSteps
    .filter((step) => !step.handsOn)
    .map((step) => card(step.id))
    .sort((a, b) => (a.endsAtMs ?? 0) - (b.endsAtMs ?? 0) || compareIds(a.stepId, b.stepId));
  const upNext = waiting
    .map((step) => ({ id: step.id, startMs: startMsOf(step.id) }))
    .sort(byStartThenId)
    .slice(0, UP_NEXT_COUNT)
    .map(({ id, startMs }): UpNextItem => {
      const step = steps.get(id);
      return {
        stepId: id,
        title: step?.title ?? id,
        dishName: dishNames.get(step?.dish ?? '') ?? '',
        startMs,
        inMin: Math.ceil((startMs - nowMs) / MINUTE_MS),
      };
    });

  const dishes = schedule.plan.dishes.map((dish): DishState => {
    const own = schedule.plan.steps.filter((step) => step.dish === dish.id);
    const doneCount = own.filter((step) => isDone(step.id)).length;
    let kind: DishState['state'];
    if (doneCount === own.length) kind = { kind: 'done' };
    else if (own.some((step) => core.facts[step.id]?.state === 'running'))
      kind = { kind: 'cooking' };
    else if (own.some((step) => due.includes(step))) kind = { kind: 'due' };
    else {
      const starts = own.filter((step) => waiting.includes(step)).map((step) => startMsOf(step.id));
      kind = { kind: 'next', startMs: Math.min(...starts) };
    }
    return { dishId: dish.id, name: dish.name, done: doneCount, total: own.length, state: kind };
  });

  const first = lanes[0]?.current ?? null;
  const overrun = running.find((c) => (c.remainingMs ?? 1) <= 0);
  let dock: CookView['dock'] = null;
  if (first !== null)
    dock = { stepId: first.stepId, action: first.state === 'due' ? 'start' : 'done' };
  else if (overrun !== undefined) dock = { stepId: overrun.stepId, action: 'done' };

  let finished: CookView['finished'] = null;
  if (phase === 'finished') {
    const ends = terminalIdsOf(schedule).flatMap((id) => {
      const fact = core.facts[id];
      return fact?.state === 'done' ? [fact.endedAtMs] : [];
    });
    finished = { servedMs: Math.max(...ends), plannedMs: core.plannedServingMs };
  }

  return {
    phase,
    nowMs,
    servingMs: clockAt(core.axisMs, schedule.servingMin),
    plannedServingMs: core.plannedServingMs,
    startMs: clockAt(core.axisMs, Math.min(...schedule.steps.map((row) => row.startMin))),
    lanes,
    toStart,
    running,
    upNext,
    dishes,
    dock,
    emphasiseBehind: phase === 'cooking' && late.size > 0,
    undo:
      state.undo !== null && nowMs < state.undo.untilMs
        ? { label: state.undo.label, untilMs: state.undo.untilMs }
        : null,
    finished,
    log: [...core.log].reverse(),
  };
}

export type FocusTarget =
  | { kind: 'action'; stepId: string; action: 'start' | 'done' }
  | { kind: 'heading'; id: string }
  | null;

/**
 * Where focus goes after an action (CM9.3). Heading ids: `do-now` is the "Do now" h2,
 * `card-<stepId>` a card's h3, `card-lane-<n>` the h3 of a free lane card.
 */
export function focusAfter(action: CookAction, before: CookView, after: CookView): FocusTarget {
  const primaryOf = (stepId: string): FocusTarget => {
    const current = after.lanes.flatMap((lane) => [lane.current, ...lane.also]);
    const due = [...current, ...after.toStart].find(
      (card) => card?.stepId === stepId && card.state === 'due',
    );
    if (due !== undefined) return { kind: 'action', stepId, action: 'start' };
    const running = [...current, ...after.running].find(
      (card) => card?.stepId === stepId && card.state === 'running',
    );
    return running === undefined ? null : { kind: 'action', stepId, action: 'done' };
  };
  const firstCard = (): FocusTarget => {
    const next = after.toStart[0] ?? after.running[0];
    return { kind: 'heading', id: next === undefined ? 'do-now' : `card-${next.stepId}` };
  };
  switch (action.type) {
    case 'cook/start':
      return { kind: 'action', stepId: action.stepId, action: 'done' };
    case 'cook/done': {
      const laneIndex = before.lanes.findIndex((lane) =>
        [lane.current, ...lane.also].some((card) => card?.stepId === action.stepId),
      );
      const held = after.lanes[laneIndex]?.current;
      if (held !== null && held !== undefined)
        return { kind: 'heading', id: `card-${held.stepId}` };
      return firstCard();
    }
    case 'cook/undo': {
      const label = before.undo?.label;
      if (label === undefined || label.kind === 'behind' || label.kind === 'start-now') {
        return { kind: 'heading', id: 'do-now' };
      }
      return primaryOf(label.stepId) ?? { kind: 'heading', id: 'do-now' };
    }
    case 'cook/start-now': {
      const first = after.lanes[0];
      return {
        kind: 'heading',
        id: first?.current == null ? 'card-lane-1' : `card-${first.current.stepId}`,
      };
    }
    default:
      return null;
  }
}

/**
 * Ids of the hands-free steps that are running and whose time came up in `(fromMs, toMs]`,
 * by end time then id (CM4.2).
 */
export function finishedBetween(state: CookState, fromMs: number, toMs: number): string[] {
  const { core } = state;
  const ended: { id: string; at: number }[] = [];
  for (const step of core.schedule.plan.steps) {
    const fact = core.facts[step.id];
    if (step.handsOn || fact?.state !== 'running') continue;
    const at = endsAtMs(step, fact);
    if (at > fromMs && at <= toMs) ended.push({ id: step.id, at });
  }
  return ended.sort((a, b) => a.at - b.at || compareIds(a.id, b.id)).map((e) => e.id);
}

export type Announcement = string | null;

function undoWords(after: CookState, label: UndoLabel): string {
  const id =
    label.kind === 'start' || label.kind === 'done' || label.kind === 'extra' ? label.stepId : '';
  const title = after.core.schedule.plan.steps.find((step) => step.id === id)?.title ?? id;
  return cookUndoWords(label, title);
}

/**
 * What the polite live region says when `before` becomes `after`: an undo (named by `label`),
 * dinner served, or a rebuild. Anything else, such as an on-plan start, says nothing.
 */
export function announcementFor(
  before: CookState | null,
  after: CookState | null,
  label?: UndoLabel,
  locale?: string,
): Announcement {
  if (after === null) return null;
  if (label !== undefined) return cookUndone(undoWords(after, label));
  const wasServed = before !== null && servedIn(before);
  if (servedIn(after) && !wasServed) return COOK_ANNOUNCE.finished;
  const entry = after.core.log.at(-1);
  if (entry === undefined || entry === before?.core.log.at(-1)) return null;
  if (!entry.result.ok) return COOK_ANNOUNCE.rebuildFailed;
  const { moved, servingFromMin, servingToMin, newWarnings } = entry.result;
  return cookRebuilt(
    moved.length,
    servingToMin !== servingFromMin,
    formatClock(clockAt(after.core.axisMs, servingToMin), locale),
    newWarnings.length,
  );
}

function servedIn(state: CookState): boolean {
  return terminalIdsOf(state.core.schedule).every((id) => state.core.facts[id]?.state === 'done');
}
