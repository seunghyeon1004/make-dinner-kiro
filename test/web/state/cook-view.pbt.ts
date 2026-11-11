import fc from 'fast-check';
import { expect, it } from 'vitest';
import { applyCook } from '../../../src/web/state/cook-session.js';
import { CookStateSchema } from '../../../src/web/state/cook-slot.js';
import type { CookState } from '../../../src/web/state/cook-slot.js';
import { cookView } from '../../../src/web/state/cook-view.js';
import type { CardStep } from '../../../src/web/state/cook-view.js';
import { loadState, saveState, STATE_KEY } from '../../../src/web/state/persist.js';
import { initialState } from '../../../src/web/state/store.js';
import type { AppState } from '../../../src/web/state/store.js';
import { arbCookBegin, arbCookIntents } from '../../support/arbitraries.js';
import { replayCook } from '../../support/cook-replay.js';
import { fcParams } from '../../support/fc-params.js';
import { oracleCookSections, oracleOverdue } from '../../support/oracles.js';

// Properties P-CM3, P-CM4 and P-CM5 of the cooking-mode design, over replayed sessions.

const TIMEOUT_MS = 60_000;
const MINUTE = 60_000;
const OFFSETS_MIN = [0, 7, 45, 120];

/** Every state of a run with the instant it was reached at. */
function pointsOf(
  begin: Parameters<typeof replayCook>[0],
  intents: Parameters<typeof replayCook>[1],
): { state: CookState; nowMs: number }[] {
  const replay = replayCook(begin, intents);
  if (replay.begun === null) return [];
  return [
    { state: replay.begun, nowMs: begin.beginMs },
    ...replay.trace.map((t) => ({ state: t.after, nowMs: t.nowMs })),
  ];
}

const laneCards = (view: ReturnType<typeof cookView>): CardStep[] =>
  view.lanes.flatMap((lane) => (lane.current === null ? lane.also : [lane.current, ...lane.also]));

it(
  'P-CM3 honest view: due and running match the oracle, each once, up next is its first three, finished iff every terminal step is done',
  () => {
    fc.assert(
      fc.property(arbCookBegin(), arbCookIntents(), (begin, intents) => {
        for (const { state, nowMs } of pointsOf(begin, intents)) {
          const { core } = state;
          const used = new Set(core.schedule.plan.steps.flatMap((s) => s.after));
          const terminalIds = core.schedule.plan.steps
            .filter((s) => !used.has(s.id))
            .map((s) => s.id);
          for (const offset of OFFSETS_MIN) {
            const at = nowMs + offset * MINUTE;
            const view = cookView(state, at);
            const oracle = oracleCookSections(core.schedule, core.facts, core.axisMs, at);
            const cards = [...laneCards(view), ...view.toStart, ...view.running];
            const dueIds = cards.filter((c) => c.state === 'due').map((c) => c.stepId);
            const runningIds = cards.filter((c) => c.state === 'running').map((c) => c.stepId);
            expect([...dueIds].sort()).toEqual(oracle.due);
            expect([...runningIds].sort()).toEqual(oracle.running);
            expect(new Set(dueIds).size).toBe(dueIds.length);
            expect(new Set(runningIds).size).toBe(runningIds.length);
            expect(view.upNext.map((u) => u.stepId)).toEqual(oracle.upNext);
            const shown = [...cards.map((c) => c.stepId), ...view.upNext.map((u) => u.stepId)];
            for (const id of shown) expect(core.facts[id]?.state).not.toBe('done');
            expect(view.phase === 'finished').toBe(
              terminalIds.every((id) => core.facts[id]?.state === 'done'),
            );
          }
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

function storageFor(state: CookState): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  const app: AppState = {
    ...initialState(),
    route: 'cook',
    dinner: {
      plan: state.core.schedule.plan,
      source: { kind: 'sample', sampleId: 'sunday-roast' },
      kitchen: state.core.schedule.kitchen,
      serving: { time: '19:30', atMs: state.core.axisMs },
    },
    cook: state,
  };
  const storage = {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
  };
  expect(saveState(storage, app)).toBe(true);
  expect(values.has(STATE_KEY)).toBe(true);
  return storage;
}

it(
  'P-CM4 reload: the JSON of a session parses back to itself, and through persistence gives the same view',
  () => {
    fc.assert(
      fc.property(arbCookBegin(), arbCookIntents(), (begin, intents) => {
        const points = pointsOf(begin, intents);
        for (const { state } of points) {
          expect(CookStateSchema.parse(JSON.parse(JSON.stringify(state)))).toStrictEqual(state);
        }
        const last = points.at(-1);
        if (last === undefined) return;
        const loaded = loadState(storageFor(last.state), true);
        expect(loaded.notice).toBeNull();
        expect(loaded.state.cook).not.toBeNull();
        if (loaded.state.cook === null) return;
        for (const offset of OFFSETS_MIN) {
          const at = last.nowMs + offset * MINUTE;
          expect(cookView(loaded.state.cook, at)).toStrictEqual(cookView(last.state, at));
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

it(
  'P-CM5 clock: every running card counts down from its recorded start and extra minutes; late steps match the oracle; a tick changes nothing',
  () => {
    fc.assert(
      fc.property(arbCookBegin(), arbCookIntents(), (begin, intents) => {
        for (const { state, nowMs } of pointsOf(begin, intents)) {
          const { core } = state;
          expect(applyCook(state, { type: 'cook/tick', nowMs })).toBe(state);
          for (const offset of OFFSETS_MIN) {
            const at = nowMs + offset * MINUTE;
            const view = cookView(state, at);
            const cards = [...laneCards(view), ...view.toStart, ...view.running];
            for (const card of cards.filter((c) => c.state === 'running')) {
              const fact = core.facts[card.stepId];
              if (fact?.state !== 'running')
                throw new Error('a running card without a running fact');
              expect(card.remainingMs).toBe(
                fact.startedAtMs + (card.minutes + fact.extraMin) * MINUTE - at,
              );
            }
            const late = oracleOverdue(core.schedule, core.facts, core.axisMs, at);
            expect(
              cards
                .filter((c) => c.lateByMin !== null)
                .map((c) => c.stepId)
                .sort(),
            ).toEqual(late);
            expect(view.emphasiseBehind).toBe(view.phase === 'cooking' && late.length > 0);
          }
        }
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);
