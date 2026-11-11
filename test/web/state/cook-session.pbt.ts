import fc from 'fast-check';
import { expect, it } from 'vitest';
import { ProgressSchema } from '../../../src/core/schema.js';
import type {
  Kitchen,
  Plan,
  Progress,
  RebuiltSchedule,
  RebuiltStep,
} from '../../../src/core/schema.js';
import { applyCook, progressOf, STALE_MS, UNDO_MS } from '../../../src/web/state/cook-session.js';
import { CookStateSchema, reduceCook } from '../../../src/web/state/cook-slot.js';
import type { CookCore, CookState, LogEntry } from '../../../src/web/state/cook-slot.js';
import { arbCookBegin, arbCookIntents } from '../../support/arbitraries.js';
import { replayCook } from '../../support/cook-replay.js';
import type { CookReplay, CookTraceEntry } from '../../support/cook-replay.js';
import { fcParams } from '../../support/fc-params.js';
import { H1_SCHEDULE, AXIS_MS, cmAt } from '../../support/fixtures.js';
import { oraclePendingOverfull, oracleRebuildViolations } from '../../support/oracles.js';

// Properties P-CM1, P-CM2, P-CM6 and P-CM7 of the cooking-mode design. A run begins a session
// on a generated schedule and plays up to 60 intents with the reducer.

const TIMEOUT_MS = 60_000;
const MINUTE = 60_000;

/** The minute of an instant on the session's axis, written out here. */
const minuteOf = (axisMs: number, ms: number): number => Math.floor((ms - axisMs) / MINUTE);

/** The facts as core Progress, computed without src/web. */
function progressFrom(core: CookCore): Progress {
  const out: Progress = {};
  for (const [id, fact] of Object.entries(core.facts)) {
    out[id] =
      fact.state === 'done'
        ? {
            state: 'done',
            startMin: minuteOf(core.axisMs, fact.startedAtMs),
            endMin: minuteOf(core.axisMs, fact.endedAtMs),
          }
        : {
            state: 'running',
            startMin: minuteOf(core.axisMs, fact.startedAtMs),
            extraMin: fact.extraMin,
          };
  }
  return out;
}

/** True when the pinned steps alone are within capacity at every minute from `now`. */
function pinnedFit(
  plan: Plan,
  kitchen: Kitchen,
  progress: Progress,
  now: number,
  steps: readonly RebuiltStep[],
): boolean {
  const pinned = steps.filter((s) => progress[s.id] !== undefined);
  const last = Math.max(now, ...pinned.map((s) => s.endMin));
  for (let minute = now; minute < last; minute += 1) {
    let burners = 0;
    let ovens = 0;
    let cooks = 0;
    for (const s of pinned) {
      if (s.startMin > minute || minute >= s.endMin) continue;
      const step = plan.steps.find((x) => x.id === s.id);
      if (step === undefined) continue;
      if (step.appliance === 'burner') burners += 1;
      if (step.appliance === 'oven') ovens += 1;
      if (step.handsOn) cooks += 1;
    }
    if (burners > kitchen.burners || ovens > kitchen.ovens || cooks > kitchen.cooks) return false;
  }
  return true;
}

interface Logged {
  previous: { id: string; startMin: number }[];
  core: CookCore;
  entry: LogEntry;
}

/** Every rebuild an `ok` log entry came from: the begin-late one and those of the actions. */
function loggedRebuilds(
  replay: CookReplay,
  begin: { schedule: { steps: Logged['previous'] } },
): Logged[] {
  const out: Logged[] = [];
  const first = replay.begun?.core.log[0];
  if (replay.begun !== null && first !== undefined) {
    out.push({ previous: begin.schedule.steps, core: replay.begun.core, entry: first });
  }
  for (const step of replay.trace) {
    const type = step.action.type;
    if (!['cook/start', 'cook/done', 'cook/extra', 'cook/behind'].includes(type)) continue;
    const entry = step.after.core.log.at(-1);
    if (entry === undefined || entry === step.before.core.log.at(-1)) continue;
    out.push({ previous: step.before.core.schedule.steps, core: step.after.core, entry });
  }
  return out;
}

it(
  'P-CM1 rebuild guarantees: every logged rebuild keeps R1 (capacity, precedence, completeness), R2 (pinned kept, pending not before now) and R3 (never earlier)',
  () => {
    fc.assert(
      fc.property(arbCookBegin(), arbCookIntents(), (begin, intents) => {
        const replay = replayCook(begin, intents);
        for (const { previous, core, entry } of loggedRebuilds(replay, begin)) {
          if (!entry.result.ok) continue;
          const now = minuteOf(core.axisMs, entry.atMs);
          const progress = progressFrom(core);
          const { plan, kitchen, steps, servingMin } = core.schedule;
          expect(oraclePendingOverfull(plan, kitchen, progress, now, steps)).toEqual([]);
          const violations = oracleRebuildViolations(
            plan,
            kitchen,
            progress,
            now,
            steps,
            servingMin,
          );
          if (pinnedFit(plan, kitchen, progress, now, steps)) expect(violations).toEqual([]);
          else expect(violations.filter((v) => !v.startsWith('capacity:'))).toEqual([]);
          for (const row of steps) {
            const fact = progress[row.id];
            if (fact !== undefined) {
              expect(row.startMin).toBe(fact.startMin);
              if (fact.state === 'done') expect(row.endMin).toBe(fact.endMin);
            } else {
              expect(row.startMin).toBeGreaterThanOrEqual(now);
              const was = previous.find((p) => p.id === row.id);
              expect(row.startMin).toBeGreaterThanOrEqual(
                was?.startMin ?? Number.NEGATIVE_INFINITY,
              );
            }
          }
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

const UNDOABLE = ['cook/start', 'cook/done', 'cook/extra', 'cook/behind', 'cook/start-now'];

it(
  'P-CM2 undo: within the window undo restores the core before the action; after it, undo returns the state itself',
  () => {
    fc.assert(
      fc.property(arbCookBegin(), arbCookIntents(), (begin, intents) => {
        const { trace } = replayCook(begin, intents);
        for (const step of trace) {
          if (!UNDOABLE.includes(step.action.type) || step.after === step.before) continue;
          expect(step.after.undo).not.toBeNull();
          for (const delayMs of [0, UNDO_MS - 1]) {
            const undone = applyCook(step.after, {
              type: 'cook/undo',
              nowMs: step.nowMs + delayMs,
            });
            expect(undone.core).toEqual(step.before.core);
            expect(undone.alertsWanted).toBe(step.after.alertsWanted);
            expect(undone.undo).toBeNull();
          }
          const late = applyCook(step.after, {
            type: 'cook/undo',
            nowMs: Math.max(step.nowMs, step.after.lastActiveMs) + UNDO_MS,
          });
          expect(late).toBe(step.after);
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

const secondsOf = (core: CookCore): number[] =>
  Object.values(core.facts).flatMap((f) =>
    f.state === 'done' ? [f.startedAtMs, f.endedAtMs] : [f.startedAtMs],
  );

/** Whether `behind` could apply: not finished, not stale, not still counting down. */
function independentlyCooking(state: CookState, nowMs: number): boolean {
  const { core } = state;
  const used = new Set(core.schedule.plan.steps.flatMap((s) => s.after));
  const terminals = core.schedule.plan.steps.filter((s) => !used.has(s.id));
  if (terminals.every((s) => core.facts[s.id]?.state === 'done')) return false;
  const t = Math.max(nowMs, core.beganAtMs, ...secondsOf(core));
  if (t - state.lastActiveMs > STALE_MS) return false;
  const first = Math.min(...core.schedule.steps.map((s) => s.startMin));
  const countdown = Object.keys(core.facts).length === 0 && t < core.axisMs + first * MINUTE;
  return !countdown;
}

function checkTrigger(step: CookTraceEntry): void {
  const { action, before, after } = step;
  const grew = after.core.log.at(-1) !== before.core.log.at(-1);
  const t = after.lastActiveMs;
  const n = minuteOf(before.core.axisMs, t);
  const row = (id: string): RebuiltSchedule['steps'][number] | undefined =>
    before.core.schedule.steps.find((r) => r.id === id);
  switch (action.type) {
    case 'cook/start': {
      const planned = row(action.stepId);
      if (after === before || planned === undefined) {
        expect(grew).toBe(false);
        return;
      }
      expect(grew).toBe(Math.abs(n - planned.startMin) > 2);
      return;
    }
    case 'cook/done': {
      const planned = row(action.stepId);
      if (after === before || planned === undefined) {
        expect(grew).toBe(false);
        return;
      }
      expect(grew).toBe(Math.abs(n - planned.endMin) > 2);
      return;
    }
    case 'cook/extra':
      expect(grew).toBe(after !== before);
      return;
    case 'cook/behind':
      expect(after !== before).toBe(independentlyCooking(before, step.nowMs));
      expect(grew).toBe(after !== before);
      return;
    case 'cook/tick':
      // Overdue steps are shown late, never rebuilt by a tick (design review Q4).
      expect(after).toBe(before);
      return;
    case 'cook/undo':
      return;
    default:
      expect(grew).toBe(false);
  }
}

it(
  'P-CM6 triggers: a start or done adds an entry iff it is more than 2 min from plan, an extra or "I\'m behind" always, a tick never',
  () => {
    fc.assert(
      fc.property(arbCookBegin(), arbCookIntents(), (begin, intents) => {
        for (const step of replayCook(begin, intents).trace) checkTrigger(step);
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

const OUT_OF_RANGE = ['serving_out_of_range', 'invalid_now'];

it(
  'P-CM7 total: progressOf passes ProgressSchema, every state passes CookStateSchema, and no rebuild fails except out of range',
  () => {
    fc.assert(
      fc.property(arbCookBegin(), arbCookIntents(), (begin, intents) => {
        const replay = replayCook(begin, intents);
        const states =
          replay.begun === null ? [] : [replay.begun, ...replay.trace.map((t) => t.after)];
        for (const state of states) {
          expect(ProgressSchema.safeParse(progressOf(state.core)).success).toBe(true);
          expect(CookStateSchema.safeParse(JSON.parse(JSON.stringify(state))).success).toBe(true);
          for (const entry of state.core.log) {
            if (entry.result.ok) continue;
            // The design's list allows serving_out_of_range; invalid_now is the same case: the
            // session has run past the 24 h window core accepts, which the generator can reach.
            expect(OUT_OF_RANGE).toContain(entry.result.error);
            if (entry.result.error === 'invalid_now') {
              expect(minuteOf(state.core.axisMs, entry.atMs)).toBeGreaterThan(1440);
            }
          }
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

const WILD_TYPES = [
  'cook/begin',
  'cook/start-now',
  'cook/behind',
  'cook/undo',
  'cook/tick',
  'cook/resume',
  'cook/start',
  'cook/done',
  'cook/extra',
  'cook/alerts',
  'cook/stop',
  'cook/nonsense',
] as const;

const H1_IDS = H1_SCHEDULE.steps.map((s) => s.id);

const arbWildAction = fc.record({
  type: fc.constantFrom(...WILD_TYPES),
  stepId: fc.oneof(fc.constantFrom(...H1_IDS), fc.anything()),
  minutes: fc.oneof(fc.constantFrom(5, 10, 15), fc.anything()),
  wanted: fc.anything(),
  schedule: fc.oneof(fc.constant(H1_SCHEDULE), fc.anything()),
  axisMs: fc.oneof(fc.constant(AXIS_MS), fc.anything()),
  nowMs: fc.oneof(fc.integer({ min: cmAt(17, 0), max: cmAt(21, 0) }), fc.anything()),
});

it(
  'P-CM7 total: reduceCook with any ids, minutes, times and types never throws and keeps a valid session',
  () => {
    fc.assert(
      fc.property(fc.array(arbWildAction, { maxLength: 40 }), (actions) => {
        let state: { cook: CookState | null } = { cook: null };
        state = reduceCook(state, {
          type: 'cook/begin',
          schedule: H1_SCHEDULE,
          axisMs: AXIS_MS,
          nowMs: cmAt(17, 30),
        });
        for (const wild of actions) {
          // Wild input is the point: the reducer is typed, the world is not.
          state = reduceCook(state, wild as unknown as Parameters<typeof reduceCook>[1]);
          if (state.cook !== null) {
            expect(CookStateSchema.safeParse(JSON.parse(JSON.stringify(state.cook))).success).toBe(
              true,
            );
          }
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);
