import type { Kitchen, Plan } from '../../src/core/schema.js';

// Hand-written plans for example tests. Steps are written in non-topological order on
// purpose, so that any code that relies on input order shows it. The facts in each comment
// were worked out by hand from the tables in the recipe-graph design, not from src/.
// Expected schedules are not worked out here (see the scheduler spec).

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
