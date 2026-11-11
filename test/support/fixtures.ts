import type { Kitchen, Plan } from '../../src/core/schema.js';

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
 *   chicken.roast   -100  -25    -  1  -      0     5
 *   gravy.roux       -20  -18    1  -  1      0     0
 *   gravy.simmer     -18   -8    1  -  -      0     0
 *   gravy.strain      -8   -6    -  -  1      0     6
 *   greens.boil      -10   -6    2  -  -      0     0
 *   greens.shred    -100  -95    -  -  1     75     -   (pass 1 start -15)
 *   greens.toss       -6   -5    -  -  1      0     5
 *
 * Expected schedule, H2: with ONE_BURNER_KITCHEN (1 burner, 1 oven, 1 cook). span 110,
 * chain 110, no warnings. Differs from H1 only in:
 *   chicken.roast   -100  -25    -  1  -      0     3
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
