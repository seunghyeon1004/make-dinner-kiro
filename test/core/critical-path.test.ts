import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { criticalPath } from '../../src/core/critical-path.js';
import { schedule } from '../../src/core/schedule.js';
import type { Kitchen, Plan, Schedule } from '../../src/core/schema.js';
import {
  BARE_KITCHEN,
  BIG_KITCHEN,
  H1_SCHEDULE,
  HANDS_FREE,
  TWO_CHOPS,
} from '../support/fixtures.js';

const mustSchedule = (plan: Plan, kitchen: Kitchen): Schedule => {
  const result = schedule(plan, kitchen);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

// The critical path is worked by hand from the tables in fixtures.ts (scheduler design H1,
// H6), not from src/. The walk starts at the step that ends at the serving minute and goes
// to the step that ends exactly when the current one starts.

describe('criticalPath (plan-ui design, "The critical path")', () => {
  it('CP1 H1: carve <- rest <- roast <- prep is the chain; toss, which also ends at -5, loses to the prerequisite', () => {
    // carve [-5,0) is the only step ending at 0. Ending at -5: rest (prerequisite of carve)
    // and toss (holds cook 1, which carve uses): the prerequisite is preferred. rest starts
    // at -25: roast ends there. roast starts at -100: prep ends there. prep starts at -110:
    // nothing ends there. The chain is 110 minutes, the span.
    expect(criticalPath(H1_SCHEDULE)).toEqual([
      'chicken.prep',
      'chicken.roast',
      'chicken.rest',
      'chicken.carve',
    ]);
  });

  it('CP2 a gap ends the chain: with prep ending at -102 nothing ends where roast starts', () => {
    const gap: Schedule = {
      ...H1_SCHEDULE,
      steps: H1_SCHEDULE.steps.map((s) =>
        s.id === 'chicken.prep' ? { ...s, startMin: -112, endMin: -102 } : s,
      ),
    };
    expect(criticalPath(gap)).toEqual(['chicken.roast', 'chicken.rest', 'chicken.carve']);
  });

  it('CP3 a rebuilt schedule starts from its servingMin and gives the same chain shifted', () => {
    const shifted = {
      ...H1_SCHEDULE,
      servingMin: 15,
      steps: H1_SCHEDULE.steps.map((s) => ({
        ...s,
        startMin: s.startMin + 15,
        endMin: s.endMin + 15,
      })),
    };
    expect(criticalPath(shifted)).toEqual([
      'chicken.prep',
      'chicken.roast',
      'chicken.rest',
      'chicken.carve',
    ]);
  });

  it('CP4 two hot chops with one cook: b.chop [-20,-10) binds a.chop [-10,0) through cook 1', () => {
    // H6: both slack 0. Nothing lists the other in `after`; b.chop ends when a.chop starts
    // and holds cook 1, the only cook. The chain is b.chop, a.chop.
    expect(criticalPath(mustSchedule(TWO_CHOPS, BARE_KITCHEN))).toEqual(['b.chop', 'a.chop']);
  });

  it('CP5 two steps end at serving: the longer one starts the walk (jelly.set 120 over stock.simmer 60)', () => {
    expect(criticalPath(mustSchedule(HANDS_FREE, BIG_KITCHEN))).toEqual(['jelly.set']);
  });

  it('CP6 two steps with the same minutes both end at serving: the smaller id wins', () => {
    // Both chops last 10 minutes and end at 0 with 6 cooks (H6): a.chop, b.chop. Smaller id.
    expect(criticalPath(mustSchedule(TWO_CHOPS, BIG_KITCHEN))).toEqual(['a.chop']);
  });

  it('CP7 nothing ends at serving: the chain is empty', () => {
    const early: Schedule = {
      ...H1_SCHEDULE,
      steps: H1_SCHEDULE.steps.map((s) => ({
        ...s,
        startMin: s.startMin - 3,
        endMin: s.endMin - 3,
      })),
    };
    expect(criticalPath(early)).toEqual([]);
  });

  it('CP8 a shared lane binds only when the resource is full (counterexample, fast-check seed -1350807787)', () => {
    // Two ovens. p [-3,-2) and q [-2,-1) both sit on oven 1, but at minute -2 only q is in an
    // oven (1 of 2), so delaying p by a minute breaks nothing: slack of p is 1, p is not on
    // the path. r [-1,0) waits for q. Path: q, r. (The first draft of the rule took p too.)
    const step = (id: string, after: string[]): Plan['steps'][number] => ({
      id,
      dish: 'x',
      title: id,
      minutes: 1,
      appliance: 'oven',
      handsOn: false,
      after,
      holdMin: id === 'x.p' ? null : 0,
    });
    const row = (id: string, startMin: number, slackMin: number): Schedule['steps'][number] => ({
      id,
      startMin,
      endMin: startMin + 1,
      lanes: { burner: null, oven: 1, cook: null },
      slackMin,
      critical: slackMin === 0,
      waitMin: id === 'x.p' ? null : 0,
    });
    const twoOvens: Schedule = {
      plan: {
        title: 'Two ovens',
        dishes: [{ id: 'x', name: 'X' }],
        steps: [step('x.p', []), step('x.q', []), step('x.r', ['x.q'])],
      },
      kitchen: { burners: 0, ovens: 2, cooks: 1 },
      steps: [row('x.p', -3, 1), row('x.q', -2, 0), row('x.r', -1, 0)],
      spanMin: 3,
      chainMin: 2,
      warnings: [],
    };
    expect(criticalPath(twoOvens)).toEqual(['x.q', 'x.r']);
  });
});

describe('criticalPath reaches back to the start (added by hand)', () => {
  // The recorded Sunday roast in its suggested kitchen: two steps end at serving time, the
  // 50-minute potatoes and the 5-minute carving. The potatoes' chain stops at 65 minutes
  // before serving (nothing ends when their oven starts heating); the carving's chain runs
  // rest, roast, then the oven heating, back to minute -115, the start of the whole dinner.
  it('prefers the chain that reaches the earliest start over the longer last step', () => {
    const recording = JSON.parse(
      readFileSync(new URL('../../recordings/sunday-roast.json', import.meta.url), 'utf8'),
    ) as { raw: Plan };
    const roast = mustSchedule(recording.raw, { burners: 4, ovens: 2, cooks: 1 });
    const path = criticalPath(roast);
    const start = (id: string): number => roast.steps.find((s) => s.id === id)?.startMin ?? NaN;
    expect(path.at(-1)).toBe('chicken.carve');
    expect(path).toContain('chicken.roast');
    expect(path).not.toContain('roast-potatoes.roast');
    expect(start(path[0] ?? '')).toBe(-roast.spanMin);
  });
});
