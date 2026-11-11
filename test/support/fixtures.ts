import { canonicalPlan } from '../../src/core/schema.js';
import type {
  Kitchen,
  Plan,
  Progress,
  ProgressEntry,
  Schedule,
  ScheduledStep,
} from '../../src/core/schema.js';

// Hand-written plans for example tests. Steps are written in non-topological order on
// purpose, so that any code that relies on input order shows it. The facts in each comment
// were worked out by hand from the tables in the recipe-graph and scheduler designs, not
// from src/. Expected schedules are the H1 to H6 tables of the scheduler design; columns are
// start, end (minutes before serving, serving is 0), B burner, O oven and C cook lane
// ('-' for none), slack, wait ('-' for a result that keeps).

/**
 * Sunday roast. `gravy.roux` makes a roux in the roasting tin on a burner, so it waits for
 * `chicken.roast`: the tin is free only once the chicken is out.
 *
 * Hand-worked facts:
 * - successors of `chicken.roast`: `['chicken.rest', 'gravy.roux']`
 * - terminal steps: `['chicken.carve', 'gravy.strain', 'greens.toss']`
 * - topological order (smallest ready id first): chicken.prep, chicken.roast, chicken.rest,
 *   chicken.carve, gravy.roux, gravy.simmer, gravy.strain, greens.shred, greens.boil,
 *   greens.toss
 * - longest chain: 10 + 75 + 20 + 5 = 110 (chicken.prep, roast, rest, carve);
 *   the gravy chain is 10 + 75 + 2 + 10 + 2 = 99
 * - checkPlan: no issues (no `none` step names an appliance word)
 * - checkKitchen with `burners: 0`: missing_appliance for gravy.roux, gravy.simmer, greens.boil
 *
 * Expected schedule, H1: with HOME_KITCHEN (4 burners, 1 oven, 1 cook). span 110, chain 110,
 * no warnings. Steps in id order:
 *   id             start  end    B  O  C  slack  wait
 *   chicken.carve     -5    0    -  -  1      0     0
 *   chicken.prep    -110 -100    -  -  1      0     -
 *   chicken.rest     -25   -5    -  -  -      0     0
 *   chicken.roast   -100  -25    -  1  -      0     0
 *   gravy.roux       -20  -18    1  -  1      0     0
 *   gravy.simmer     -18   -8    1  -  -      0     0
 *   gravy.strain      -8   -6    -  -  1      0     6
 *   greens.boil      -10   -6    2  -  -      0     0
 *   greens.shred    -100  -95    -  -  1     75     -   (pass 1 start -15)
 *   greens.toss       -6   -5    -  -  1      0     5
 *
 * Expected schedule, H2: with ONE_BURNER_KITCHEN (1 burner, 1 oven, 1 cook). span 110,
 * chain 110, no warnings. Differs from H1 only in:
 *   chicken.roast   -100  -25    -  1  -      0     0
 *   gravy.roux       -22  -20    1  -  1      0     0
 *   gravy.simmer     -20  -10    1  -  -      0     2
 *   greens.boil      -10   -6    1  -  -      0     0
 *   greens.shred    -100  -95    -  -  1     73     -   (pass 1 start -15)
 */
export const SUNDAY_ROAST: Plan = {
  title: 'Sunday roast',
  dishes: [
    { id: 'chicken', name: 'Roast chicken' },
    { id: 'gravy', name: 'Gravy' },
    { id: 'greens', name: 'Spring greens' },
  ],
  steps: [
    {
      id: 'greens.toss',
      dish: 'greens',
      title: 'Toss the greens with butter',
      minutes: 1,
      appliance: 'none',
      handsOn: true,
      after: ['greens.boil'],
      holdMin: 5,
    },
    {
      id: 'gravy.strain',
      dish: 'gravy',
      title: 'Strain the gravy into a jug',
      minutes: 2,
      appliance: 'none',
      handsOn: true,
      after: ['gravy.simmer'],
      holdMin: 15,
    },
    {
      id: 'chicken.carve',
      dish: 'chicken',
      title: 'Carve the chicken',
      minutes: 5,
      appliance: 'none',
      handsOn: true,
      after: ['chicken.rest'],
      holdMin: 5,
    },
    {
      id: 'greens.boil',
      dish: 'greens',
      title: 'Cook the greens in salted water',
      minutes: 4,
      appliance: 'burner',
      handsOn: false,
      after: ['greens.shred'],
      holdMin: 0,
    },
    {
      id: 'gravy.simmer',
      dish: 'gravy',
      title: 'Add stock and let the gravy thicken',
      minutes: 10,
      appliance: 'burner',
      handsOn: false,
      after: ['gravy.roux'],
      holdMin: 5,
    },
    {
      id: 'chicken.rest',
      dish: 'chicken',
      title: 'Rest the chicken under foil',
      minutes: 20,
      appliance: 'none',
      handsOn: false,
      after: ['chicken.roast'],
      holdMin: 30,
    },
    {
      id: 'gravy.roux',
      dish: 'gravy',
      title: 'Make a roux in the roasting tin',
      detail: 'Use the juices left in the tin once the chicken is out.',
      minutes: 2,
      appliance: 'burner',
      handsOn: true,
      after: ['chicken.roast'],
      holdMin: 5,
    },
    {
      id: 'chicken.roast',
      dish: 'chicken',
      title: 'Roast the chicken',
      minutes: 75,
      appliance: 'oven',
      handsOn: false,
      after: ['chicken.prep'],
      holdMin: 5,
    },
    {
      id: 'greens.shred',
      dish: 'greens',
      title: 'Shred the greens',
      minutes: 5,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
    {
      id: 'chicken.prep',
      dish: 'chicken',
      title: 'Season and truss the chicken',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
  ],
};

/**
 * Mezze. Three dishes whose terminal steps keep or hold briefly; `hummus.blend` and
 * `flatbread.mix` have no prerequisites.
 *
 * Hand-worked facts:
 * - terminal steps: `['flatbread.cook', 'hummus.blend', 'salad.toss']`
 * - topological order: flatbread.mix, flatbread.rise, flatbread.cook, hummus.blend,
 *   salad.chop, salad.dressing, salad.toss
 * - longest chain: 10 + 60 + 12 = 82 (flatbread.mix, rise, cook)
 * - checkPlan: no issues
 *
 * Expected schedule, H4: with HOME_KITCHEN. span 84, chain 82, no warnings.
 *   id              start  end    B  O  C  slack  wait
 *   flatbread.cook    -14   -2    1  -  1      0     2
 *   flatbread.mix     -84  -74    -  -  1      0     -
 *   flatbread.rise    -74  -14    -  -  -      0     0
 *   hummus.blend      -74  -64    -  -  1      0     -   (pass 1 start -24)
 *   salad.chop        -64  -54    -  -  1      0     -   (pass 1 start -34)
 *   salad.dressing    -54  -49    -  -  1     35     -   (pass 1 start -39)
 *   salad.toss         -2    0    -  -  1      0     0
 */
export const MEZZE: Plan = {
  title: 'Mezze',
  dishes: [
    { id: 'flatbread', name: 'Flatbread' },
    { id: 'hummus', name: 'Hummus' },
    { id: 'salad', name: 'Chopped salad' },
  ],
  steps: [
    {
      id: 'salad.toss',
      dish: 'salad',
      title: 'Toss the salad with the dressing',
      minutes: 2,
      appliance: 'none',
      handsOn: true,
      after: ['salad.chop', 'salad.dressing'],
      holdMin: 5,
    },
    {
      id: 'flatbread.cook',
      dish: 'flatbread',
      title: 'Cook the flatbreads one by one',
      minutes: 12,
      appliance: 'burner',
      handsOn: true,
      after: ['flatbread.rise'],
      holdMin: 10,
    },
    {
      id: 'salad.dressing',
      dish: 'salad',
      title: 'Whisk the dressing',
      minutes: 5,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
    {
      id: 'flatbread.rise',
      dish: 'flatbread',
      title: 'Let the dough rise',
      minutes: 60,
      appliance: 'none',
      handsOn: false,
      after: ['flatbread.mix'],
      holdMin: 30,
    },
    {
      id: 'hummus.blend',
      dish: 'hummus',
      title: 'Blend the hummus',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
    {
      id: 'salad.chop',
      dish: 'salad',
      title: 'Chop the salad vegetables',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
    {
      id: 'flatbread.mix',
      dish: 'flatbread',
      title: 'Mix the dough',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
  ],
};

/**
 * Pie and potatoes. Two oven steps compete for one oven.
 *
 * Hand-worked facts:
 * - terminal steps: `['pie.bake', 'potatoes.roast']`
 * - topological order: pie.assemble, pie.bake, potatoes.peel, potatoes.roast
 * - longest chain: 55 (pie: 15 + 40; potatoes: 10 + 45)
 * - checkPlan: no issues
 * - checkKitchen with `ovens: 0`: missing_appliance for pie.bake and potatoes.roast
 *
 * Expected schedule, H3: with HOME_KITCHEN. span 95, chain 55. One warning: hold_exceeded
 * for potatoes.roast, waitMin 40, holdMin 10.
 *   id               start  end    B  O  C  slack  wait
 *   pie.assemble       -85  -70    -  -  1     30     -   (pass 1 start -55)
 *   pie.bake           -40    0    -  1  -      0     0
 *   potatoes.peel      -95  -85    -  -  1      0     -
 *   potatoes.roast     -85  -40    -  1  -      0    40
 */
export const TIGHT_OVEN: Plan = {
  title: 'Pie and potatoes',
  dishes: [
    { id: 'pie', name: 'Apple pie' },
    { id: 'potatoes', name: 'Roast potatoes' },
  ],
  steps: [
    {
      id: 'potatoes.roast',
      dish: 'potatoes',
      title: 'Roast the potatoes',
      minutes: 45,
      appliance: 'oven',
      handsOn: false,
      after: ['potatoes.peel'],
      holdMin: 10,
    },
    {
      id: 'pie.bake',
      dish: 'pie',
      title: 'Bake the pie',
      minutes: 40,
      appliance: 'oven',
      handsOn: false,
      after: ['pie.assemble'],
      holdMin: 10,
    },
    {
      id: 'potatoes.peel',
      dish: 'potatoes',
      title: 'Peel and cut the potatoes',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
    {
      id: 'pie.assemble',
      dish: 'pie',
      title: 'Assemble the pie',
      minutes: 15,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
  ],
};

/** Four burners, one oven, one cook: a normal domestic kitchen. */
export const HOME_KITCHEN: Kitchen = { burners: 4, ovens: 1, cooks: 1 };

/** The same kitchen with a second cook. */
export const TWO_COOK_KITCHEN: Kitchen = { burners: 4, ovens: 1, cooks: 2 };

/** One burner, one oven, one cook. */
export const ONE_BURNER_KITCHEN: Kitchen = { burners: 1, ovens: 1, cooks: 1 };

/** No burner, one oven, one cook. */
export const NO_BURNER_KITCHEN: Kitchen = { burners: 0, ovens: 1, cooks: 1 };

/** One burner, no oven, one cook. */
export const BURNER_ONLY_KITCHEN: Kitchen = { burners: 1, ovens: 0, cooks: 1 };

/** No burner, no oven, one cook. */
export const BARE_KITCHEN: Kitchen = { burners: 0, ovens: 0, cooks: 1 };

/** The largest kitchen the schema allows. */
export const BIG_KITCHEN: Kitchen = { burners: 8, ovens: 4, cooks: 6 };

/**
 * Bread, jelly and salad: right-justify at work (design H5). Steps in non-topological order.
 *
 * Expected schedule, H5: with NO_BURNER_KITCHEN (0 burners, 1 oven, 1 cook; no step needs a
 * burner, so no burner lane). span 60, chain 60, no warnings.
 *   id           start  end    B  O  C  slack  wait
 *   bread.bake      -8    0    -  1  -      0     0
 *   bread.shape    -13   -8    -  -  1      0     0   (pass 1 start -17, wait 4 > hold 2)
 *   jelly.set      -60    0    -  -  -      0     -
 *   salad.chop     -60  -50    -  -  1     37     -   (pass 1 start -12)
 *   salad.toss      -2    0    -  -  1      0     0
 * Pass 2 moves only salad.chop (keeps) to -60; pass 3 moves only bread.shape (hot) to -13.
 */
export const PREP_AHEAD: Plan = {
  title: 'Bread, jelly and salad',
  dishes: [
    { id: 'bread', name: 'Flatbreads' },
    { id: 'jelly', name: 'Jelly' },
    { id: 'salad', name: 'Chopped salad' },
  ],
  steps: [
    {
      id: 'salad.toss',
      dish: 'salad',
      title: 'Toss the salad',
      minutes: 2,
      appliance: 'none',
      handsOn: true,
      after: ['salad.chop'],
      holdMin: 5,
    },
    {
      id: 'bread.bake',
      dish: 'bread',
      title: 'Bake the flatbreads',
      minutes: 8,
      appliance: 'oven',
      handsOn: false,
      after: ['bread.shape'],
      holdMin: 15,
    },
    {
      id: 'jelly.set',
      dish: 'jelly',
      title: 'Leave the jelly to set',
      minutes: 60,
      appliance: 'none',
      handsOn: false,
      after: [],
      holdMin: null,
    },
    {
      id: 'salad.chop',
      dish: 'salad',
      title: 'Chop the salad',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
    {
      id: 'bread.shape',
      dish: 'bread',
      title: 'Shape the flatbreads',
      minutes: 5,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: 2,
    },
  ],
};

/**
 * One hot step on a burner (design H6) with BURNER_ONLY_KITCHEN: `solo.sear` at [-30, 0),
 * burner 1, cook 1, slack 0, critical, wait 0. span 30, chain 30, no warnings.
 */
export const SOLO_BURNER: Plan = {
  title: 'One pan',
  dishes: [{ id: 'solo', name: 'Seared steak' }],
  steps: [
    {
      id: 'solo.sear',
      dish: 'solo',
      title: 'Sear the steak',
      minutes: 30,
      appliance: 'burner',
      handsOn: true,
      after: [],
      holdMin: 5,
    },
  ],
};

/**
 * One step whose result keeps (design H6) with BURNER_ONLY_KITCHEN: `solo.chill` at [-30, 0),
 * no lanes, slack 0, critical, wait null. span 30, chain 30, no warnings.
 */
export const SOLO_KEEPS: Plan = {
  title: 'One dessert',
  dishes: [{ id: 'solo', name: 'Panna cotta' }],
  steps: [
    {
      id: 'solo.chill',
      dish: 'solo',
      title: 'Chill the panna cotta',
      minutes: 30,
      appliance: 'none',
      handsOn: false,
      after: [],
      holdMin: null,
    },
  ],
};

/**
 * Only hands-free steps (design H6) with BURNER_ONLY_KITCHEN, and again with `cooks: 6`:
 * `stock.simmer` [-60, 0) burner 1, wait 0; `jelly.set` [-120, 0), no lanes, wait null; both
 * slack 0, critical; span 120, chain 120, no warnings. The two schedules differ only in
 * `kitchen`.
 */
export const HANDS_FREE: Plan = {
  title: 'Stock and jelly',
  dishes: [
    { id: 'stock', name: 'Beef stock' },
    { id: 'jelly', name: 'Jelly' },
  ],
  steps: [
    {
      id: 'stock.simmer',
      dish: 'stock',
      title: 'Simmer the stock',
      minutes: 60,
      appliance: 'burner',
      handsOn: false,
      after: [],
      holdMin: 30,
    },
    {
      id: 'jelly.set',
      dish: 'jelly',
      title: 'Leave the jelly to set',
      minutes: 120,
      appliance: 'none',
      handsOn: false,
      after: [],
      holdMin: null,
    },
  ],
};

/**
 * Two hot hands-on steps competing for the cook (design H6).
 *
 * With BARE_KITCHEN (1 cook): `a.chop` [-10, 0) cook 1, wait 0; `b.chop` [-20, -10) cook 1,
 * wait 10; both slack 0; span 20, chain 10; one hold_exceeded for `b.chop` (waitMin 10,
 * holdMin 5); G4.2 is tight.
 *
 * With BIG_KITCHEN (6 cooks): both [-10, 0), `a.chop` cook 1, `b.chop` cook 2, waits 0,
 * span 10, no warnings.
 */
export const TWO_CHOPS: Plan = {
  title: 'Two chops',
  dishes: [
    { id: 'a', name: 'Dish a' },
    { id: 'b', name: 'Dish b' },
  ],
  steps: [
    {
      id: 'b.chop',
      dish: 'b',
      title: 'Chop the second pile',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: 5,
    },
    {
      id: 'a.chop',
      dish: 'a',
      title: 'Chop the first pile',
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: 5,
    },
  ],
};

/**
 * Eighty 480-minute hands-on steps for one cook (design H6, R9.4), written from `s80` down to
 * `s01`. With BARE_KITCHEN: `feast.sNN` at [-480*N, -480*(N-1)), cook 1, slack 0, wait
 * 480*(N-1); span 38400, chain 480; 79 hold_exceeded warnings (s02 to s80). The plan itself
 * has 80 long_hands_on warnings, which do not block.
 */
export const LONG_DAY: Plan = {
  title: 'A very long day',
  dishes: [{ id: 'feast', name: 'The feast' }],
  steps: Array.from({ length: 80 }, (_unused, i) => {
    const n = String(80 - i).padStart(2, '0');
    return {
      id: `feast.s${n}`,
      dish: 'feast',
      title: `Prepare batch ${n}`,
      minutes: 480,
      appliance: 'none' as const,
      handsOn: true,
      after: [],
      holdMin: 0,
    };
  }),
};

/**
 * A keeps step after a hot step (design H6, R9.5) with BURNER_ONLY_KITCHEN: `fish.fry`
 * [-8, 0) burner 1 cook 1; `sauce.whisk` [-13, -8) cook 1, wait null; `sauce.reduce`
 * [-23, -13) burner 1, wait 0; all slack 0; span 23, chain 15; no warnings. Pass 2 leaves
 * `sauce.whisk` at -13: it starts at its hot prerequisite's end.
 */
export const COLD_SAUCE: Plan = {
  title: 'Fish with a cold sauce',
  dishes: [
    { id: 'fish', name: 'Fried fish' },
    { id: 'sauce', name: 'Butter sauce' },
  ],
  steps: [
    {
      id: 'sauce.whisk',
      dish: 'sauce',
      title: 'Whisk in the butter',
      minutes: 5,
      appliance: 'none',
      handsOn: true,
      after: ['sauce.reduce'],
      holdMin: null,
    },
    {
      id: 'fish.fry',
      dish: 'fish',
      title: 'Fry the fish',
      minutes: 8,
      appliance: 'burner',
      handsOn: true,
      after: [],
      holdMin: 2,
    },
    {
      id: 'sauce.reduce',
      dish: 'sauce',
      title: 'Reduce the wine',
      minutes: 10,
      appliance: 'burner',
      handsOn: false,
      after: [],
      holdMin: 5,
    },
  ],
};

// ---------------------------------------------------------------------------------------
// Rebuild spec: the scheduler's hand-worked tables written out as Schedule values.

type LaneTriple = readonly [burner: number | null, oven: number | null, cook: number | null];

/** One row of a design table: id, start, end, lanes, slack, wait; critical is slack 0. */
const row = (
  id: string,
  startMin: number,
  endMin: number,
  lanes: LaneTriple,
  slackMin: number,
  waitMin: number | null,
): ScheduledStep => ({
  id,
  startMin,
  endMin,
  lanes: { burner: lanes[0], oven: lanes[1], cook: lanes[2] },
  slackMin,
  critical: slackMin === 0,
  waitMin,
});

/**
 * Scheduler table H1 as a `Schedule` (SUNDAY_ROAST x HOME_KITCHEN), written without
 * `servingMin`, so it parses as a `RebuiltSchedule` with `servingMin` 0. Span 110, chain 110,
 * no warnings; the columns are the H1 table above.
 */
export const H1_SCHEDULE: Schedule = {
  plan: canonicalPlan(SUNDAY_ROAST),
  kitchen: HOME_KITCHEN,
  steps: [
    row('chicken.carve', -5, 0, [null, null, 1], 0, 0),
    row('chicken.prep', -110, -100, [null, null, 1], 0, null),
    row('chicken.rest', -25, -5, [null, null, null], 0, 0),
    row('chicken.roast', -100, -25, [null, 1, null], 0, 0),
    row('gravy.roux', -20, -18, [1, null, 1], 0, 0),
    row('gravy.simmer', -18, -8, [1, null, null], 0, 0),
    row('gravy.strain', -8, -6, [null, null, 1], 0, 6),
    row('greens.boil', -10, -6, [2, null, null], 0, 0),
    row('greens.shred', -100, -95, [null, null, 1], 75, null),
    row('greens.toss', -6, -5, [null, null, 1], 0, 5),
  ],
  spanMin: 110,
  chainMin: 110,
  warnings: [],
};

/**
 * Scheduler table H3 as a `Schedule` (TIGHT_OVEN x HOME_KITCHEN), written without
 * `servingMin`. Span 95, chain 55, one hold_exceeded warning for potatoes.roast.
 */
export const H3_SCHEDULE: Schedule = {
  plan: canonicalPlan(TIGHT_OVEN),
  kitchen: HOME_KITCHEN,
  steps: [
    row('pie.assemble', -85, -70, [null, null, 1], 30, null),
    row('pie.bake', -40, 0, [null, 1, null], 0, 0),
    row('potatoes.peel', -95, -85, [null, null, 1], 0, null),
    row('potatoes.roast', -85, -40, [null, 1, null], 0, 40),
  ],
  spanMin: 95,
  chainMin: 55,
  warnings: [
    {
      severity: 'warning',
      code: 'hold_exceeded',
      message:
        'Step potatoes.roast will be ready 40 minutes before serving and can wait only 10 minutes. More ovens, burners or cooks may help.',
      stepId: 'potatoes.roast',
      waitMin: 40,
      holdMin: 10,
    },
  ],
};

const done = (startMin: number, endMin: number): ProgressEntry => ({
  state: 'done',
  startMin,
  endMin,
});
const running = (startMin: number, extraMin: number): ProgressEntry => ({
  state: 'running',
  startMin,
  extraMin,
});

/** The cook did the steps at their H1 times: every id in `ids`, done at its H1 interval. */
const doneAsH1 = (ids: readonly string[]): Progress =>
  Object.fromEntries(
    ids.map((id): [string, ProgressEntry] => {
      const step = H1_SCHEDULE.steps.find((s) => s.id === id);
      if (step === undefined) throw new Error(`no H1 step ${id}`);
      return [id, done(step.startMin, step.endMin)];
    }),
  );

const H1_IDS = H1_SCHEDULE.steps.map((s) => s.id);
const H1_EXCEPT = (...skip: string[]): string[] => H1_IDS.filter((id) => !skip.includes(id));

// The rebuilds below start from H1_SCHEDULE (servingMin 0) unless said otherwise. Each comment
// gives the expected rebuild, worked by hand in the rebuild design ("Hand-worked rebuilds").

/**
 * RB-a. The roast needs 15 more minutes, now -60. Expected: roast stays `[-100,-10)`; carve
 * `[10,15)`, rest `[-10,10)`, roux `[-4,-2)`, simmer `[-2,8)`, strain `[8,10)`, boil `[3,7)`,
 * toss `[7,8)`; servingMin 15, spanMin 125; warning toss (7 > 5) (the roast ends at -10, when rest starts: wait 0);
 * moved carve, rest, roux, simmer, strain, boil, toss; shift 15.
 */
export const RB_A_PROGRESS: Progress = {
  'chicken.prep': done(-110, -100),
  'greens.shred': done(-100, -95),
  'chicken.roast': running(-100, 15),
};
export const RB_A_NOW = -60;

/**
 * RB-b. The cook is 8 minutes behind on gravy.roux, now -12. Expected: roux `[-12,-10)`, simmer
 * `[-10,0)`, strain `[0,2)`, everything else as H1; servingMin 2, spanMin 112; warning toss
 * (7 > 5), the roast waits 0 for rest, its first user; moved roux, simmer, strain; shift 2.
 */
export const RB_B_PROGRESS: Progress = {
  ...doneAsH1(['chicken.prep', 'greens.shred']),
  'chicken.roast': done(-100, -25),
  'chicken.rest': running(-25, 0),
};
export const RB_B_NOW = -12;

/**
 * RB-b2. Behind on a step with slack, now -92. Expected: only greens.shred moves, to
 * `[-92,-87)`, slack 67; servingMin 0; no warnings; moved shred only; shift 0.
 */
export const RB_B2_PROGRESS: Progress = {
  'chicken.prep': done(-110, -100),
  'chicken.roast': running(-100, 0),
};
export const RB_B2_NOW = -92;

/**
 * RB-c. No slip (R4), now -60. Expected: starts, ends, lanes and waits equal H1; pinned rows
 * slack 0, not critical; servingMin 0, spanMin 110; no warnings; moved []; shift 0.
 */
export const RB_C_PROGRESS: Progress = {
  ...doneAsH1(['chicken.prep', 'greens.shred']),
  'chicken.roast': running(-100, 0),
};
export const RB_C_NOW = -60;

/** E1. Finished early, now -35. Expected: nothing moves, servingMin 0; roast wait 10 > 5 warned (rest starts at -25). */
export const E1_PROGRESS: Progress = {
  ...doneAsH1(['chicken.prep', 'greens.shred']),
  'chicken.roast': done(-100, -35),
};
export const E1_NOW = -35;

/**
 * E2. Started early, now -100. Expected: roast `[-102,-27)`; moved only chicken.roast
 * `-100 -> -102`; roast wait 2, no warning (rest starts at -25); servingMin 0.
 */
export const E2_PROGRESS: Progress = {
  'chicken.prep': done(-110, -102),
  'chicken.roast': running(-102, 0),
};
export const E2_NOW = -100;

/**
 * E3. Overrun, no taps, now -20. Expected: roast `[-100,-20)` (ends now); rest `[-20,0)`, carve
 * `[0,5)`, servingMin 5; after re-align toss -1, strain -3, boil -5, simmer -13, roux -15
 * (starts); no warnings.
 */
export const E3_PROGRESS: Progress = {
  ...doneAsH1(['chicken.prep', 'greens.shred']),
  'chicken.roast': running(-100, 0),
};
export const E3_NOW = -20;

/** E4. Done long, now -88. Expected: nothing moves, servingMin 0, no warnings. */
export const E4_PROGRESS: Progress = {
  'chicken.prep': done(-110, -100),
  'greens.shred': done(-100, -88),
  'chicken.roast': running(-100, 0),
};
export const E4_NOW = -88;

/**
 * E5. All done, carve late, now 3. Expected: nothing planned; servingMin 3, shift 3; all slack 0,
 * not critical; strain wait 9 and toss wait 8 warned.
 */
export const E5_PROGRESS: Progress = {
  ...doneAsH1(H1_EXCEPT('chicken.carve')),
  'chicken.carve': done(-5, 3),
};
export const E5_NOW = 3;

/** E5'. All done, carve early, now -2. Expected: servingMin 0 (R5); carve wait 2; no warnings. */
export const E5_EARLY_PROGRESS: Progress = {
  ...doneAsH1(H1_EXCEPT('chicken.carve')),
  'chicken.carve': done(-5, -2),
};
export const E5_EARLY_NOW = -2;

/**
 * E6. Out of order: everything as H1 but boil absent and carve running, now -2. Expected: boil
 * `[-2,2)` on burner 2, wait 0 (clamped); servingMin 2; toss wait 7 warned; moved only
 * greens.boil `-10 -> -2`.
 */
export const E6_PROGRESS: Progress = {
  ...doneAsH1(H1_EXCEPT('greens.boil', 'chicken.carve')),
  'chicken.carve': running(-5, 0),
};
export const E6_NOW = -2;

/**
 * E7. One oven, two pans, from H3_SCHEDULE, now -50. Expected: ok; both oven steps on oven lane
 * 1; servingMin 0; moved only pie.bake `-40 -> -60`; warnings bake 20 > 10 and roast 40 > 10.
 */
export const E7_PROGRESS: Progress = {
  'potatoes.peel': done(-95, -85),
  'pie.assemble': done(-85, -70),
  'potatoes.roast': running(-85, 0),
  'pie.bake': running(-60, 0),
};
export const E7_NOW = -50;

/**
 * E8. Untap: the input is E6's output, the progress is E6's without greens.toss, now 0.
 * Expected: boil `[0,4)`, toss `[4,5)` (ready order), servingMin 5, shift 3.
 */
export const E8_PROGRESS: Progress = Object.fromEntries(
  Object.entries(E6_PROGRESS).filter(([id]) => id !== 'greens.toss'),
);
export const E8_NOW = 0;

// ---------------------------------------------------------------------------------------
// Cooking-mode spec (T1.1). Written by hand from `.kiro/specs/cooking-mode/design.md`,
// "Hand-worked sessions"; nothing here is produced by src/. Minute `m` of the session axis is
// 19:30 + m on Wed 2026-11-11 (London is on GMT, so local time equals UTC).

/** Minute 0 of the cooking-mode examples: Wed 2026-11-11 19:30 London (19:30Z). */
export const AXIS_MS: number = Date.UTC(2026, 10, 11, 19, 30);

/** The instant at a London clock time on Wed 2026-11-11 (`h` may be 24 or more for later days). */
export function cmAt(hours: number, minutes: number, seconds = 0): number {
  return AXIS_MS + (hours * 60 + minutes - (19 * 60 + 30)) * 60_000 + seconds * 1000;
}

/**
 * CM-c before the +15 (also CM-f's facts and CM-d's, plus the shred): prep 17:40 to 17:50 (axis
 * minutes -110 to -100), the roast started 17:50 (-100), the shred 17:50 to 17:55 (-100 to -95).
 * On the axis 19:30 these give `progressOf`:
 *   chicken.prep   done    [-110, -100)
 *   greens.shred   done    [-100, -95)
 *   chicken.roast  running { startMin -100, extraMin 0 }
 * The roast ends 17:50 + 75 min = 19:05, or 19:20 with 15 extra minutes.
 */
type CmFact =
  | { state: 'running'; startedAtMs: number; extraMin: number }
  | { state: 'done'; startedAtMs: number; endedAtMs: number };

const CM_PREP: CmFact = { state: 'done', startedAtMs: cmAt(17, 40), endedAtMs: cmAt(17, 50) };
const CM_SHRED: CmFact = { state: 'done', startedAtMs: cmAt(17, 50), endedAtMs: cmAt(17, 55) };
const CM_ROAST: CmFact = { state: 'running', startedAtMs: cmAt(17, 50), extraMin: 0 };

export const CM_C_FACTS: Record<string, CmFact> = {
  'chicken.prep': CM_PREP,
  'greens.shred': CM_SHRED,
  'chicken.roast': CM_ROAST,
};

/** CM-d: prep done 17:40 to 17:50, the roast started 17:50, the shred not started. */
export const CM_D_FACTS: Record<string, CmFact> = {
  'chicken.prep': CM_PREP,
  'chicken.roast': CM_ROAST,
};

/** CM-f at 17:56: the same facts as CM-c before the +15. Expected view in the design, CM-f. */
export const CM_F_FACTS: Record<string, CmFact> = CM_C_FACTS;

// ---------------------------------------------------------------------------------------
// Dinnerfile spec (T1.3). Written by hand from `.kiro/specs/dinnerfile/design.md`, sections
// "Worst case" and "Sunday roast"; nothing here is produced by src/. A tab is written `\t`.

/**
 * The worst case of the dinnerfile design: free text holding every character that could turn a
 * title into Make or shell syntax, a dish called `dinner`, directive-word dish ids, a step id
 * that starts with `-`, a lone surrogate and a title that is just `-n`. It passes `PlanSchema`
 * and `checkPlan` gives it no issue. Steps and dishes are in non-canonical order on purpose.
 */
export const WORST_CASE: Plan = {
  title: 'Worst "case" \\ #',
  dishes: [
    { id: 'export', name: 'Export  ' },
    { id: 'dinner', name: 'Dinner itself' },
    { id: 'define', name: 'D\u00e9finir' },
  ],
  steps: [
    {
      id: 'define.y',
      dish: 'define',
      title: 'Line\r\nbreak\u0000 and \u2028end',
      minutes: 480,
      appliance: 'oven',
      handsOn: false,
      after: ['export.x'],
      holdMin: 480,
    },
    {
      id: 'export.x',
      dish: 'export',
      title:
        " It's $(MAKE) ${HOME} $$ `touch canary` $(shell touch canary) ; touch canary #1 \\ 50% a:=b\tc\nd\u202ee\ud800 \\",
      detail: 'Line one\nLine two "quoted" \\c',
      minutes: 5,
      appliance: 'burner',
      handsOn: false,
      after: ['--.--'],
      holdMin: 0,
    },
    {
      id: '--.--',
      dish: 'dinner',
      title: '-n',
      minutes: 1,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
  ],
};

export const DINNERFILE_HEADER: readonly string[] = [
  '# Dinnerfile written by Make Dinner. GNU Make reads it:',
  '#   make -n -f Dinnerfile dinner    prints every step in an order that works',
  '#   make -n -f Dinnerfile <dish>    prints the steps one dish needs',
  '# The "# plan", "# dish", "# step", "# kitchen" and "# serve" lines hold the plan.',
];

/**
 * `toDinnerfile(SUNDAY_ROAST)`, the complete text. Worked out by hand in the dinnerfile
 * design, "Sunday roast": canonical step order puts chicken.carve before chicken.prep and
 * chicken.rest before chicken.roast; terminal steps are chicken.carve, gravy.strain and
 * greens.toss, which are also the one last step of each dish.
 */
export const SUNDAY_ROAST_DINNERFILE: string =
  [
    ...DINNERFILE_HEADER,
    '',
    '# plan "Sunday roast"',
    '# dish chicken "Roast chicken"',
    '# dish gravy "Gravy"',
    '# dish greens "Spring greens"',
    '',
    '.PHONY: dinner chicken gravy greens chicken.carve chicken.prep chicken.rest chicken.roast gravy.roux gravy.simmer gravy.strain greens.boil greens.shred greens.toss',
    'dinner: chicken.carve gravy.strain greens.toss',
    '',
    'chicken: chicken.carve',
    'gravy: gravy.strain',
    'greens: greens.toss',
    '',
    '# step dish=chicken minutes=5 appliance=none handsOn=true hold=5 title="Carve the chicken"',
    'chicken.carve: chicken.rest',
    "\t@echo 'Carve the chicken' # chicken.carve",
    '',
    '# step dish=chicken minutes=10 appliance=none handsOn=true hold=keeps title="Season and truss the chicken"',
    'chicken.prep:',
    "\t@echo 'Season and truss the chicken' # chicken.prep",
    '',
    '# step dish=chicken minutes=20 appliance=none handsOn=false hold=30 title="Rest the chicken under foil"',
    'chicken.rest: chicken.roast',
    "\t@echo 'Rest the chicken under foil' # chicken.rest",
    '',
    '# step dish=chicken minutes=75 appliance=oven handsOn=false hold=5 title="Roast the chicken"',
    'chicken.roast: chicken.prep',
    "\t@echo 'Roast the chicken' # chicken.roast",
    '',
    '# step dish=gravy minutes=2 appliance=burner handsOn=true hold=5 title="Make a roux in the roasting tin" detail="Use the juices left in the tin once the chicken is out."',
    'gravy.roux: chicken.roast',
    "\t@echo 'Make a roux in the roasting tin' # gravy.roux",
    '',
    '# step dish=gravy minutes=10 appliance=burner handsOn=false hold=5 title="Add stock and let the gravy thicken"',
    'gravy.simmer: gravy.roux',
    "\t@echo 'Add stock and let the gravy thicken' # gravy.simmer",
    '',
    '# step dish=gravy minutes=2 appliance=none handsOn=true hold=15 title="Strain the gravy into a jug"',
    'gravy.strain: gravy.simmer',
    "\t@echo 'Strain the gravy into a jug' # gravy.strain",
    '',
    '# step dish=greens minutes=4 appliance=burner handsOn=false hold=0 title="Cook the greens in salted water"',
    'greens.boil: greens.shred',
    "\t@echo 'Cook the greens in salted water' # greens.boil",
    '',
    '# step dish=greens minutes=5 appliance=none handsOn=true hold=keeps title="Shred the greens"',
    'greens.shred:',
    "\t@echo 'Shred the greens' # greens.shred",
    '',
    '# step dish=greens minutes=1 appliance=none handsOn=true hold=5 title="Toss the greens with butter"',
    'greens.toss: greens.boil',
    "\t@echo 'Toss the greens with butter' # greens.toss",
  ].join('\n') + '\n';

/**
 * `make -n -f Dinnerfile dinner` on `SUNDAY_ROAST_DINNERFILE`. Worked out by hand from the
 * design: GNU Make visits prerequisites left to right, depth first, and (measured in the
 * design session) prints each step once.
 */
export const SUNDAY_ROAST_MAKE_DINNER: readonly string[] = [
  "echo 'Season and truss the chicken' # chicken.prep",
  "echo 'Roast the chicken' # chicken.roast",
  "echo 'Rest the chicken under foil' # chicken.rest",
  "echo 'Carve the chicken' # chicken.carve",
  "echo 'Make a roux in the roasting tin' # gravy.roux",
  "echo 'Add stock and let the gravy thicken' # gravy.simmer",
  "echo 'Strain the gravy into a jug' # gravy.strain",
  "echo 'Shred the greens' # greens.shred",
  "echo 'Cook the greens in salted water' # greens.boil",
  "echo 'Toss the greens with butter' # greens.toss",
];

/**
 * `make -n -f Dinnerfile gravy` on `SUNDAY_ROAST_DINNERFILE`: the gravy needs the roasting tin,
 * so the chicken's first two steps come first (dinnerfile design, "Sunday roast").
 */
export const SUNDAY_ROAST_MAKE_GRAVY: readonly string[] = [
  "echo 'Season and truss the chicken' # chicken.prep",
  "echo 'Roast the chicken' # chicken.roast",
  "echo 'Make a roux in the roasting tin' # gravy.roux",
  "echo 'Add stock and let the gravy thicken' # gravy.simmer",
  "echo 'Strain the gravy into a jug' # gravy.strain",
];

/**
 * `toDinnerfile(WORST_CASE)`, the complete text, from the design's "Worst case". Canonical step
 * order is `--.--`, `define.y`, `export.x` (`-` sorts before `d`); the dish `dinner` gets the
 * fixed comment line and no rule; the only terminal step is `define.y`. The echo argument of
 * `export.x` is its title's display form (tab and newline as spaces, U+202E and the lone
 * U+D800 as U+FFFD) with every `'` as `'\''` and every `$` as `$$` plus `''` before `(` or `{`.
 */
export const WORST_CASE_DINNERFILE: string =
  [
    ...DINNERFILE_HEADER,
    '',
    '# plan "Worst \\"case\\" \\\\ #"',
    '# dish define "D\u00e9finir"',
    '# dish dinner "Dinner itself"',
    '# dish export "Export  "',
    '',
    '.PHONY: dinner define export --.-- define.y export.x',
    'dinner: define.y',
    '',
    'define: define.y',
    '# No target for dish dinner: "dinner" makes the whole plan.',
    'export: export.x',
    '',
    '# step dish=dinner minutes=1 appliance=none handsOn=true hold=keeps title="-n"',
    '--.--:',
    "\t@echo '-n' # --.--",
    '',
    '# step dish=define minutes=480 appliance=oven handsOn=false hold=480 title="Line\\r\\nbreak\\u0000 and \\u2028end"',
    'define.y: export.x',
    "\t@echo 'Line  break  and  end' # define.y",
    '',
    '# step dish=export minutes=5 appliance=burner handsOn=false hold=0 title=" It\'s $(MAKE) ${HOME} $$ `touch canary` $(shell touch canary) ; touch canary #1 \\\\ 50% a:=b\\tc\\nd\\u202ee\\ud800 \\\\" detail="Line one\\nLine two \\"quoted\\" \\\\c"',
    'export.x: --.--',
    "\t@echo ' It'\\''s $$''(MAKE) $$''{HOME} $$$$ `touch canary` $$''(shell touch canary) ; touch canary #1 \\ 50% a:=b c d\ufffde\ufffd \\' # export.x",
  ].join('\n') + '\n';

/**
 * `make -n -f Dinnerfile dinner` on `WORST_CASE_DINNERFILE` (measured in the design session,
 * GNU Make 3.81): Make expands each `$$` to `$` and prints the recipe line without the `@`.
 */
export const WORST_CASE_MAKE_DINNER: readonly string[] = [
  "echo '-n' # --.--",
  "echo ' It'\\''s $''(MAKE) $''{HOME} $$ `touch canary` $''(shell touch canary) ; touch canary #1 \\ 50% a:=b c d\ufffde\ufffd \\' # export.x",
  "echo 'Line  break  and  end' # define.y",
];
