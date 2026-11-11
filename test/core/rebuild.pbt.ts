import fc from 'fast-check';
import { expect, it } from 'vitest';
import { rebuild } from '../../src/core/rebuild.js';
import { AXIS_MIN, RebuiltSchema, compareIds } from '../../src/core/schema.js';
import type { Progress, Rebuilt, RebuiltSchedule, Schedule } from '../../src/core/schema.js';
import {
  arbOnPlan,
  arbProgress,
  arbScheduled,
  arbShuffledPlan,
  followPlan,
} from '../support/arbitraries.js';
import type { AnySchedule, RunOpts } from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import { resourcesOf } from '../../src/core/timeline.js';
import {
  oracleForwardRepair,
  oracleLongestChain,
  oraclePendingOverfull,
  oraclePinnedIntervals,
  oracleRebuildHoldExceeded,
  oracleRebuildLaneViolations,
  oracleRebuildSlack,
  oracleRebuildViolations,
  oracleRebuildWaits,
  startsOf,
} from '../support/oracles.js';

// Rebuild guarantees R1 to R6 (scheduler-guarantees.md) and the P-RB properties of the rebuild
// design. Titles start with the id and a space. A run is a schedule from `arbScheduled`, then
// what the cook did from `arbProgress`; both default-sized and large (80 steps) plans are used.

const TIMEOUT_MS = 60_000;
const SERVING_MAX = 1440;

interface Case {
  s: AnySchedule;
  progress: Progress;
  now: number;
}

const arbCase = (large: boolean, runOpts: RunOpts = {}): fc.Arbitrary<Case> =>
  arbScheduled(large ? { large: true } : {}).chain((s) =>
    arbProgress(s, runOpts).map(({ progress, now }): Case => ({ s, progress, now })),
  );

/** The run options a property is checked with: in order, then with steps done out of order. */
const IN_ORDER: RunOpts[] = [{}, { outOfOrder: true }];

/** The latest end that forward repair gives, by the oracle, or the previous serving minute. */
const oracleServing = (c: Case, prevServing: number): number => {
  const prevStarts = startsOf(c.s.steps);
  const iv = oracleForwardRepair(c.s.plan, c.s.kitchen, c.progress, c.now, prevStarts);
  return Math.max(prevServing, ...Object.values(iv).map((i) => i.endMin));
};

/**
 * Runs `rebuild`. The only error a property accepts is `serving_out_of_range`, and then only
 * when the oracle's latest end is past a day; that case returns null and the property stops.
 */
const rebuildOrNull = (
  input: Schedule | RebuiltSchedule,
  c: Case,
  prevServing: number,
): Rebuilt | null => {
  const r = rebuild(input, c.progress, c.now);
  if (r.ok) return r.value;
  expect(r.error.kind).toBe('serving_out_of_range');
  expect(oracleServing(c, prevServing)).toBeGreaterThan(SERVING_MAX);
  return null;
};

/** Runs `check` on every size and run option, given the case and its rebuild. */
const forEveryRun = (check: (c: Case, r: Rebuilt) => void, options = IN_ORDER): void => {
  for (const large of [false, true]) {
    for (const runOpts of options) {
      fc.assert(
        fc.property(arbCase(large, runOpts), (c) => {
          const r = rebuildOrNull(c.s, c, 0);
          if (r !== null) check(c, r);
        }),
        fcParams(),
      );
    }
  }
};

it(
  'R1 valid: capacity from now, precedence for pending successors and completeness hold',
  () => {
    forEveryRun((c, r) => {
      expect(
        oracleRebuildViolations(
          c.s.plan,
          c.s.kitchen,
          c.progress,
          c.now,
          r.schedule.steps,
          r.schedule.servingMin,
        ),
      ).toEqual([]);
    });
  },
  TIMEOUT_MS,
);

it(
  'R2 pinned: done and running steps keep their start (done also their end); pending start at or after now',
  () => {
    forEveryRun((c, r) => {
      const pinned = oraclePinnedIntervals(c.s.plan, c.progress, c.now);
      for (const step of r.schedule.steps) {
        const expected = pinned[step.id];
        if (expected === undefined) {
          expect(step.startMin).toBeGreaterThanOrEqual(c.now);
        } else {
          expect([step.startMin, step.endMin]).toEqual([expected.startMin, expected.endMin]);
        }
      }
    });
  },
  TIMEOUT_MS,
);

it(
  'R3 never earlier: every pending step starts at or after its previous start',
  () => {
    forEveryRun((c, r) => {
      const prev = startsOf(c.s.steps);
      for (const step of r.schedule.steps) {
        if (c.progress[step.id] !== undefined) continue;
        expect(step.startMin).toBeGreaterThanOrEqual(prev[step.id] ?? Number.NaN);
      }
    });
  },
  TIMEOUT_MS,
);

it(
  'R4 no slip, no change: a cook who follows the schedule gets the same starts, serving 0 and no moves',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(
          arbScheduled(large ? { large: true } : {}).chain((s) =>
            arbOnPlan(s).map(({ progress, now }): Case => ({ s, progress, now })),
          ),
          (c) => {
            const r = rebuild(c.s, c.progress, c.now);
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            const prev = startsOf(c.s.steps);
            expect(
              Object.fromEntries(r.value.schedule.steps.map((x) => [x.id, x.startMin])),
            ).toEqual(prev);
            expect(r.value.schedule.servingMin).toBe(0);
            expect(r.value.diff.moved).toEqual([]);
            expect(r.value.diff.servingShiftMin).toBe(0);
          },
        ),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'R5 serving time: servingMin is the larger of 0 and the latest end after forward repair, never earlier',
  () => {
    forEveryRun((c, r) => {
      expect(r.schedule.servingMin).toBe(oracleServing(c, 0));
      expect(r.schedule.servingMin).toBe(Math.max(0, ...r.schedule.steps.map((x) => x.endMin)));
    });
    // In order, every edge is respected, so the latest end is that of a terminal step.
    for (const large of [false, true]) {
      fc.assert(
        fc.property(arbCase(large), (c) => {
          const r = rebuildOrNull(c.s, c, 0);
          if (r === null) return;
          const used = new Set(c.s.plan.steps.flatMap((x) => x.after));
          const terminalEnds = r.schedule.steps.filter((x) => !used.has(x.id)).map((x) => x.endMin);
          expect(r.schedule.servingMin).toBe(Math.max(0, ...terminalEnds));
        }),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'R6 honest diff: moved lists exactly the steps whose start changed, unchanged the rest, shift is the serving minute',
  () => {
    forEveryRun((c, r) => {
      const prev = startsOf(c.s.steps);
      const ids = c.s.steps.map((x) => x.id).sort();
      const expectedMoved = r.schedule.steps
        .filter((x) => x.startMin !== prev[x.id])
        .map((x) => ({
          stepId: x.id,
          fromStartMin: prev[x.id],
          toStartMin: x.startMin,
        }))
        .sort((a, b) => (a.stepId < b.stepId ? -1 : 1));
      expect(r.diff.moved).toEqual(expectedMoved);
      expect(r.diff.unchanged).toEqual(
        ids.filter((id) => !expectedMoved.some((m) => m.stepId === id)),
      );
      expect(r.diff.servingShiftMin).toBe(r.schedule.servingMin);
    });
  },
  TIMEOUT_MS,
);

/** The ids of a rebuilt schedule, sorted. */
const idsOf = (r: Rebuilt): string[] => r.schedule.steps.map((x) => x.id).sort();

it(
  'P-RB1 idempotent: rebuilding the output with the same progress and now returns it with an empty diff',
  () => {
    forEveryRun((c, r) => {
      const again = rebuild(r.schedule, c.progress, c.now);
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.value.schedule).toStrictEqual(r.schedule);
      expect(again.value.diff).toStrictEqual({
        moved: [],
        unchanged: idsOf(r),
        servingShiftMin: 0,
      });
    });
  },
  TIMEOUT_MS,
);

it(
  'P-RB2 no slip twice: following the rebuilt schedule to a later now changes no start and not the serving minute',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(arbCase(large), fc.integer({ min: 0, max: 90 }), (c, later) => {
          const r = rebuildOrNull(c.s, c, 0);
          if (r === null) return;
          const now2 = Math.min(SERVING_MAX, c.now + later);
          const progress2 = followPlan(r.schedule, c.progress, now2);
          const again = rebuild(r.schedule, progress2, now2);
          expect(again.ok).toBe(true);
          if (!again.ok) return;
          expect(again.value.schedule.servingMin).toBe(r.schedule.servingMin);
          expect(again.value.schedule.steps.map((x) => [x.id, x.startMin])).toEqual(
            r.schedule.steps.map((x) => [x.id, x.startMin]),
          );
          expect(again.value.diff.moved).toEqual([]);
        }),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'P-RB3 slips twice: a second rebuild is valid, pinned, never earlier and never serves earlier than the first',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(
          arbCase(large).chain((c) => {
            const first = rebuild(c.s, c.progress, c.now);
            if (!first.ok) return fc.constant(null);
            return arbProgress(first.value.schedule, {
              base: { progress: c.progress, now: c.now },
            }).map((run) => ({ first: first.value, run }));
          }),
          (drawn) => {
            if (drawn === null) return;
            const { first, run } = drawn;
            const base = first.schedule;
            const c2: Case = {
              s: base,
              progress: run.progress,
              now: run.now,
            };
            const second = rebuild(base, run.progress, run.now);
            if (!second.ok) {
              expect(second.error.kind).toBe('serving_out_of_range');
              expect(oracleServing(c2, base.servingMin)).toBeGreaterThan(SERVING_MAX);
              return;
            }
            const out = second.value;
            expect(
              oracleRebuildViolations(
                base.plan,
                base.kitchen,
                run.progress,
                run.now,
                out.schedule.steps,
                out.schedule.servingMin,
              ),
            ).toEqual([]);
            const pinned = oraclePinnedIntervals(base.plan, run.progress, run.now);
            const prev = startsOf(base.steps);
            for (const step of out.schedule.steps) {
              const p = pinned[step.id];
              if (p === undefined) {
                expect(step.startMin).toBeGreaterThanOrEqual(prev[step.id] ?? Number.NaN);
              } else {
                expect([step.startMin, step.endMin]).toEqual([p.startMin, p.endMin]);
              }
            }
            expect(out.schedule.servingMin).toBe(oracleServing(c2, base.servingMin));
            expect(out.schedule.servingMin).toBeGreaterThanOrEqual(base.servingMin);
            expect(out.diff.servingShiftMin).toBe(out.schedule.servingMin - base.servingMin);
            expect(out.diff.moved.map((m) => [m.stepId, m.fromStartMin, m.toStartMin])).toEqual(
              out.schedule.steps
                .filter((x) => x.startMin !== prev[x.id])
                .map((x) => [x.id, prev[x.id], x.startMin]),
            );
          },
        ),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

/** Runs where the cook's facts can break capacity and precedence. */
const REALITY: RunOpts[] = [
  { overCapacity: true },
  { outOfOrder: true },
  { outOfOrder: true, overCapacity: true },
];

it(
  'P-RB4 reality first: any facts give ok; no pending step sits where use is over capacity; pending successors and serving hold',
  () => {
    forEveryRun((c, r) => {
      const steps = r.schedule.steps;
      expect(oraclePendingOverfull(c.s.plan, c.s.kitchen, c.progress, c.now, steps)).toEqual([]);
      const violations = oracleRebuildViolations(
        c.s.plan,
        c.s.kitchen,
        c.progress,
        c.now,
        steps,
        r.schedule.servingMin,
      );
      // Capacity at minutes where pinned steps alone break it is not the rebuild's to fix (C2).
      expect(violations.filter((v) => !v.startsWith('capacity:'))).toEqual([]);
    }, REALITY);
  },
  TIMEOUT_MS,
);

it(
  'P-RB5 lanes: fields and ranges are right, shares only where pinned steps overfill, and a free input lane is kept',
  () => {
    forEveryRun(
      (c, r) => {
        const steps = r.schedule.steps;
        const iv = Object.fromEntries(
          steps.map((x) => [x.id, { startMin: x.startMin, endMin: x.endMin }]),
        );
        expect(
          oracleRebuildLaneViolations(c.s.plan, c.s.kitchen, iv, Object.keys(c.progress), steps),
        ).toEqual([]);
        const caps = {
          burner: c.s.kitchen.burners,
          oven: c.s.kitchen.ovens,
          cook: c.s.kitchen.cooks,
        };
        const inputLanes = new Map(c.s.steps.map((x) => [x.id, x.lanes]));
        const outputLanes = new Map(steps.map((x) => [x.id, x.lanes]));
        const stepOf = new Map(c.s.plan.steps.map((x) => [x.id, x]));
        const order = [...steps].sort(
          (a, b) => a.startMin - b.startMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
        order.forEach((x, index) => {
          const plan = stepOf.get(x.id);
          if (plan === undefined || x.startMin >= x.endMin) return;
          for (const resource of resourcesOf(plan)) {
            const wanted = inputLanes.get(x.id)?.[resource] ?? null;
            if (wanted === null || wanted < 1 || wanted > caps[resource]) continue;
            const heldEarlier = order.slice(0, index).some((u) => {
              const other = stepOf.get(u.id);
              return (
                other !== undefined &&
                resourcesOf(other).includes(resource) &&
                u.startMin < u.endMin &&
                u.startMin < x.endMin &&
                x.startMin < u.endMin &&
                outputLanes.get(u.id)?.[resource] === wanted
              );
            });
            if (!heldEarlier) expect(outputLanes.get(x.id)?.[resource]).toBe(wanted);
          }
        });
      },
      [...IN_ORDER, ...REALITY],
    );
  },
  TIMEOUT_MS,
);

it(
  'P-RB6 readout: slack, critical, waits, warnings, span and chain equal the oracles',
  () => {
    forEveryRun(
      (c, r) => {
        const { plan, kitchen } = c.s;
        const steps = r.schedule.steps;
        const serving = r.schedule.servingMin;
        const iv = Object.fromEntries(
          steps.map((x) => [x.id, { startMin: x.startMin, endMin: x.endMin }]),
        );
        const waits = oracleRebuildWaits(plan, iv, serving);
        for (const x of steps) {
          const pending = c.progress[x.id] === undefined;
          const slack = oracleRebuildSlack(plan, kitchen, c.progress, c.now, iv, serving, x.id);
          expect([x.id, x.slackMin, x.critical, x.waitMin]).toEqual([
            x.id,
            pending ? slack : 0,
            pending && slack === 0,
            waits[x.id],
          ]);
        }
        expect(
          r.schedule.warnings.map((w) => ({
            stepId: w.stepId,
            waitMin: w.waitMin,
            holdMin: w.holdMin,
          })),
        ).toEqual(oracleRebuildHoldExceeded(plan, iv, serving));
        expect(r.schedule.spanMin).toBe(serving - Math.min(...steps.map((x) => x.startMin)));
        expect(r.schedule.chainMin).toBe(oracleLongestChain(plan));
      },
      [...IN_ORDER, ...REALITY],
    );
  },
  TIMEOUT_MS,
);

/** One broken input per error kind, built from a good case. */
type Breaker = (c: Case) => { schedule: unknown; progress: unknown; now: unknown } | null;
const BREAKERS: Record<string, [Breaker, (c: Case) => object]> = {
  invalid_now: [
    (c) => ({ schedule: c.s, progress: {}, now: 0.5 }),
    () => ({ kind: 'invalid_now' }),
  ],
  invalid_progress: [
    (c) => ({
      schedule: c.s,
      progress: { [c.s.plan.steps[0]?.id ?? '']: { state: 'done', startMin: c.now } },
      now: c.now,
    }),
    () => ({ kind: 'invalid_progress' }),
  ],
  unknown_step: [
    (c) => ({
      schedule: c.s,
      progress: { 'zz.nope': { state: 'done', startMin: c.now, endMin: c.now } },
      now: c.now,
    }),
    () => ({ kind: 'unknown_step', stepId: 'zz.nope' }),
  ],
  done_ends_before_start: [
    (c) =>
      c.now <= AXIS_MIN
        ? null
        : {
            schedule: c.s,
            progress: {
              [firstId(c)]: { state: 'done', startMin: c.now, endMin: c.now - 1 },
            },
            now: c.now,
          },
    (c) => ({ kind: 'done_ends_before_start', stepId: firstId(c) }),
  ],
  done_after_now: [
    (c) =>
      c.now >= SERVING_MAX
        ? null
        : {
            schedule: c.s,
            progress: { [firstId(c)]: { state: 'done', startMin: c.now, endMin: c.now + 1 } },
            now: c.now,
          },
    (c) => ({ kind: 'done_after_now', stepId: firstId(c) }),
  ],
  running_starts_after_now: [
    (c) =>
      c.now >= SERVING_MAX
        ? null
        : {
            schedule: c.s,
            progress: { [firstId(c)]: { state: 'running', startMin: c.now + 1, extraMin: 0 } },
            now: c.now,
          },
    (c) => ({ kind: 'running_starts_after_now', stepId: firstId(c) }),
  ],
  invalid_schedule_shape: [
    (c) => ({
      schedule: { ...c.s, steps: c.s.steps.map((x, i) => (i === 0 ? { ...x, endMin: 1 } : x)) },
      progress: {},
      now: c.now,
    }),
    () => ({ kind: 'invalid_schedule', reason: 'shape', issues: [] }),
  ],
  invalid_schedule_step_ids: [
    (c) =>
      c.s.steps.length < 2
        ? null
        : { schedule: { ...c.s, steps: c.s.steps.slice(1) }, progress: {}, now: c.now },
    () => ({ kind: 'invalid_schedule', reason: 'step_ids', issues: [] }),
  ],
};
function firstId(c: Case): string {
  return c.s.plan.steps.map((x) => x.id).sort(compareIds)[0] ?? '';
}

it(
  'P-RB7 errors: each broken input gives its exact error, any value gives ok or err without throwing, arguments stay equal',
  () => {
    for (const [name, [breakIt, expected]] of Object.entries(BREAKERS)) {
      fc.assert(
        fc.property(arbCase(false), (c) => {
          const input = breakIt(c);
          fc.pre(input !== null);
          if (input === null) return;
          const before = structuredClone(input);
          const r = rebuild(
            input.schedule as Schedule,
            input.progress as Progress,
            input.now as number,
          );
          expect([name, r]).toEqual([name, { ok: false, error: expected(c) }]);
          expect(input).toEqual(before);
        }),
        fcParams(),
      );
    }
    // plan and kitchen errors carry the sanity issues
    fc.assert(
      fc.property(arbCase(false), (c) => {
        const first = c.s.plan.steps[0];
        fc.pre(first !== undefined);
        if (first === undefined) return;
        const looped = {
          ...c.s,
          plan: {
            ...c.s.plan,
            steps: c.s.plan.steps.map((x) =>
              x.id === first.id ? { ...x, after: [...x.after, x.id] } : x,
            ),
          },
        };
        const r = rebuild(looped, {}, c.now);
        expect(!r.ok && r.error.kind === 'invalid_schedule' && r.error.reason).toBe('plan');
        expect(
          !r.ok && r.error.kind === 'invalid_schedule' && r.error.issues.map((i) => i.code),
        ).toContain('self_dependency');
        fc.pre(c.s.plan.steps.some((x) => x.appliance !== 'none'));
        const bare = { ...c.s, kitchen: { burners: 0, ovens: 0, cooks: c.s.kitchen.cooks } };
        const k = rebuild(bare, {}, c.now);
        expect(!k.ok && k.error.kind === 'invalid_schedule' && k.error.reason).toBe('kitchen');
        expect(
          !k.ok &&
            k.error.kind === 'invalid_schedule' &&
            k.error.issues.every((i) => i.code === 'missing_appliance'),
        ).toBe(true);
      }),
      fcParams(),
    );
    // now 1440 with nothing done runs past a day
    fc.assert(
      fc.property(arbCase(false), (c) => {
        const r = rebuild(c.s, {}, SERVING_MAX);
        const expected = oracleServing({ s: c.s, progress: {}, now: SERVING_MAX }, 0);
        expect(expected).toBeGreaterThan(SERVING_MAX);
        expect(r).toEqual({
          ok: false,
          error: { kind: 'serving_out_of_range', servingMin: expected },
        });
      }),
      fcParams(),
    );
    // any value at all
    fc.assert(
      fc.property(fc.anything(), fc.anything(), fc.anything(), (a, b, n) => {
        const before = [structuredClone(a), structuredClone(b), structuredClone(n)];
        const r = rebuild(a as Schedule, b as Progress, n as number);
        expect(typeof r.ok).toBe('boolean');
        expect([a, b, n]).toEqual(before);
      }),
      fcParams(),
    );
    // a plausible schedule with a nonsense progress or now
    fc.assert(
      fc.property(arbCase(false), fc.anything(), fc.anything(), (c, progress, now) => {
        const before = structuredClone(c.s);
        const r = rebuild(c.s, progress as Progress, now as number);
        expect(typeof r.ok).toBe('boolean');
        expect(c.s).toEqual(before);
      }),
      fcParams(),
    );
  },
  TIMEOUT_MS,
);

it(
  'P-RB8 order-free: permuting progress keys, schedule rows and the arrays of the plan gives a deep-equal result',
  () => {
    for (const large of [false, true]) {
      fc.assert(
        fc.property(
          arbCase(large).chain((c) =>
            fc
              .tuple(
                arbShuffledPlan(c.s.plan),
                fc.shuffledSubarray(c.s.steps, { minLength: c.s.steps.length }),
                fc.shuffledSubarray(Object.entries(c.progress), {
                  minLength: Object.keys(c.progress).length,
                }),
              )
              .map(([plan, steps, entries]) => ({ c, plan, steps, entries })),
          ),
          ({ c, plan, steps, entries }) => {
            const same = rebuild(c.s, c.progress, c.now);
            const shuffled = rebuild(
              { ...c.s, plan, steps } as Schedule,
              Object.fromEntries(entries),
              c.now,
            );
            expect(shuffled).toStrictEqual(same);
          },
        ),
        fcParams(),
      );
    }
  },
  TIMEOUT_MS,
);

it(
  'P-RB9 schema: the result parses as RebuiltSchema and survives a JSON round trip unchanged',
  () => {
    forEveryRun(
      (_c, r) => {
        expect(RebuiltSchema.parse(r)).toStrictEqual(r);
        expect(RebuiltSchema.parse(JSON.parse(JSON.stringify(r)))).toStrictEqual(r);
      },
      [...IN_ORDER, ...REALITY],
    );
  },
  TIMEOUT_MS,
);
