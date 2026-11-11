import { describe, expect, it } from 'vitest';
import type { Plan, Step } from '../../../src/core/index.js';
import {
  addDish,
  addStep,
  dependentsOf,
  NEW_STEP,
  nextStepId,
  removeDish,
  removeStep,
  renameDish,
  slugify,
  stepOrder,
  uniqueDishId,
  updateStep,
  waitingOn,
} from '../../../src/web/state/plan-edit.js';
import { SUNDAY_ROAST } from '../../support/fixtures.js';

const indexOf = (plan: Plan, id: string): number => plan.steps.findIndex((s) => s.id === id);

function step(id: string, after: string[] = []): Step {
  const dish = id.split('.')[0] ?? 'a';
  return {
    id,
    dish,
    title: `Title ${id}`,
    minutes: 5,
    appliance: 'none',
    handsOn: true,
    after,
    holdMin: null,
  };
}

/** `dishes` dishes named d1.., each with `perDish` steps `dN.s1..`. */
function bigPlan(dishes: number, perDish: number): Plan {
  return {
    title: 'Big',
    dishes: Array.from({ length: dishes }, (_, i) => ({ id: `d${i + 1}`, name: `Dish ${i + 1}` })),
    steps: Array.from({ length: dishes }, (_, d) =>
      Array.from({ length: perDish }, (_, s) => step(`d${d + 1}.s${s + 1}`)),
    ).flat(),
  };
}

describe('slugify (R4.8)', () => {
  it('strips accents and lowercases', () => {
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
  });
  it('turns runs of other characters into one hyphen and trims it', () => {
    expect(slugify('  Pan gravy!! ')).toBe('pan-gravy');
  });
  it('gives "dish" when nothing is left', () => {
    expect(slugify('汁')).toBe('dish');
  });
  it('cuts to 40 characters and trims a trailing hyphen', () => {
    expect(slugify('a'.repeat(50))).toBe('a'.repeat(40));
    expect(slugify(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
  });
});

describe('ids (R4.8)', () => {
  it('uniqueDishId keeps a free base and numbers a taken one from 2', () => {
    expect(uniqueDishId(SUNDAY_ROAST, 'pudding')).toBe('pudding');
    expect(uniqueDishId(SUNDAY_ROAST, 'chicken')).toBe('chicken-2');
    const plan: Plan = {
      ...SUNDAY_ROAST,
      dishes: [...SUNDAY_ROAST.dishes, { id: 'chicken-2', name: 'Another' }],
    };
    expect(uniqueDishId(plan, 'chicken')).toBe('chicken-3');
  });
  it('uniqueDishId cuts the base so the id stays within 40 characters', () => {
    const long = 'a'.repeat(40);
    const plan: Plan = { ...SUNDAY_ROAST, dishes: [{ id: long, name: 'Long' }] };
    expect(uniqueDishId(plan, long)).toBe(`${'a'.repeat(38)}-2`);
  });
  it('nextStepId takes the smallest unused n from 1', () => {
    expect(nextStepId(SUNDAY_ROAST, 'gravy')).toBe('gravy.step-1');
    const plan: Plan = {
      ...SUNDAY_ROAST,
      steps: [...SUNDAY_ROAST.steps, step('gravy.step-1'), step('gravy.step-3')],
    };
    expect(nextStepId(plan, 'gravy')).toBe('gravy.step-2');
  });
});

describe('stepOrder (R4.1)', () => {
  it('lists indices in dependency order for SUNDAY_ROAST', () => {
    // Worked by hand with Kahn's algorithm, ready steps taken in id order:
    // prep, roast, rest, carve, roux, simmer, strain, shred, boil, toss.
    expect(stepOrder(SUNDAY_ROAST)).toEqual([9, 7, 5, 2, 6, 4, 1, 8, 3, 0]);
  });
  it('falls back to plan order when there is a cycle', () => {
    const plan: Plan = {
      ...SUNDAY_ROAST,
      steps: SUNDAY_ROAST.steps.map((s) =>
        s.id === 'chicken.prep' ? { ...s, after: ['chicken.carve'] } : s,
      ),
    };
    expect(stepOrder(plan)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('waitingOn and dependentsOf (R4.5, R4.7)', () => {
  it('waitingOn lists every step that waits for chicken.prep, directly or not', () => {
    expect([...waitingOn(SUNDAY_ROAST, 'chicken.prep')].sort()).toEqual([
      'chicken.carve',
      'chicken.rest',
      'chicken.roast',
      'gravy.roux',
      'gravy.simmer',
      'gravy.strain',
    ]);
  });
  it('waitingOn is empty for a terminal step', () => {
    expect([...waitingOn(SUNDAY_ROAST, 'chicken.carve')]).toEqual([]);
  });
  it('dependentsOf gives steps outside the ids that list one of them', () => {
    expect(dependentsOf(SUNDAY_ROAST, ['chicken.roast', 'chicken.rest'])).toEqual([
      indexOf(SUNDAY_ROAST, 'chicken.carve'),
      indexOf(SUNDAY_ROAST, 'gravy.roux'),
    ]);
  });
});

describe('removeStep (R4.6, R4.7)', () => {
  it('removes chicken.roast; chicken.rest and gravy.roux lose it and the notice names both', () => {
    const result = removeStep(SUNDAY_ROAST, indexOf(SUNDAY_ROAST, 'chicken.roast'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan, notice } = result.value;
    expect(plan.steps.map((s) => s.id)).not.toContain('chicken.roast');
    expect(plan.steps).toHaveLength(9);
    expect(plan.steps.find((s) => s.id === 'chicken.rest')?.after).toEqual([]);
    expect(plan.steps.find((s) => s.id === 'gravy.roux')?.after).toEqual([]);
    expect(plan.steps.find((s) => s.id === 'chicken.carve')?.after).toEqual(['chicken.rest']);
    expect(notice).toBe(
      'Removed \u201cRoast the chicken\u201d. Rest the chicken under foil, Make a roux in the roasting tin no longer wait for it.',
    );
  });
  it('says only what was removed when nothing waited for the step', () => {
    const result = removeStep(SUNDAY_ROAST, indexOf(SUNDAY_ROAST, 'chicken.carve'));
    expect(result.ok && result.value.notice).toBe('Removed \u201cCarve the chicken\u201d.');
  });
  it('keeps an id in after while another step still has that id', () => {
    const plan: Plan = {
      title: 'Dup',
      dishes: [{ id: 'a', name: 'A' }],
      steps: [step('a.x'), step('a.x'), step('a.y', ['a.x'])],
    };
    const result = removeStep(plan, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.steps.map((s) => s.id)).toEqual(['a.x', 'a.y']);
    expect(result.value.plan.steps[1]?.after).toEqual(['a.x']);
    expect(result.value.notice).toBe('Removed \u201cTitle a.x\u201d.');
  });
  it('refuses to remove the last step', () => {
    const plan = bigPlan(1, 1);
    expect(removeStep(plan, 0)).toEqual({ ok: false, error: 'last_step' });
  });
});

describe('removeDish (R4.6, R4.8)', () => {
  it('removes the dish with its steps and cleans after lists', () => {
    const result = removeDish(SUNDAY_ROAST, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan, notice } = result.value;
    expect(plan.dishes.map((d) => d.id)).toEqual(['gravy', 'greens']);
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps.find((s) => s.id === 'gravy.roux')?.after).toEqual([]);
    expect(notice).toBe(
      'Removed the dish Roast chicken. Make a roux in the roasting tin no longer wait for it.',
    );
  });
  it('refuses to remove the last dish', () => {
    expect(removeDish(bigPlan(1, 2), 0)).toEqual({ ok: false, error: 'last_dish' });
  });
  it('refuses when no step would be left', () => {
    const plan: Plan = {
      title: 'Empty second dish',
      dishes: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      steps: [step('a.x')],
    };
    expect(removeDish(plan, 0)).toEqual({ ok: false, error: 'last_step' });
  });
});

describe('addDish, renameDish and addStep (R4.6, R4.8)', () => {
  it('addDish appends the dish and one new step, focused', () => {
    const result = addDish(SUNDAY_ROAST, '  Crème brûlée ');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { plan, focus } = result.value;
    expect(plan.dishes.at(-1)).toEqual({ id: 'creme-brulee', name: 'Crème brûlée' });
    expect(plan.steps).toHaveLength(11);
    expect(plan.steps.at(-1)).toEqual({
      id: 'creme-brulee.step-1',
      dish: 'creme-brulee',
      title: NEW_STEP.title,
      minutes: 10,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    });
    expect(focus).toBe(10);
  });
  it('addDish gives a taken slug a numbered id', () => {
    const result = addDish(SUNDAY_ROAST, 'Chicken');
    expect(result.ok && result.value.plan.dishes.at(-1)?.id).toBe('chicken-2');
  });
  it('addDish rejects a blank name and a name over 80 characters', () => {
    expect(addDish(SUNDAY_ROAST, '   ')).toEqual({ ok: false, error: 'invalid_name' });
    expect(addDish(SUNDAY_ROAST, 'x'.repeat(81))).toEqual({ ok: false, error: 'invalid_name' });
  });
  it('addDish refuses a 13th dish and a step past 80', () => {
    expect(addDish(bigPlan(12, 1), 'More')).toEqual({ ok: false, error: 'too_many_dishes' });
    expect(addDish(bigPlan(8, 10), 'More')).toEqual({ ok: false, error: 'too_many_steps' });
  });
  it('renameDish changes the name and never the id', () => {
    const result = renameDish(SUNDAY_ROAST, 1, 'Pan gravy');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.dishes[1]).toEqual({ id: 'gravy', name: 'Pan gravy' });
    expect(result.value.plan.steps).toEqual(SUNDAY_ROAST.steps);
    expect(renameDish(SUNDAY_ROAST, 1, ' ')).toEqual({ ok: false, error: 'invalid_name' });
  });
  it('addStep appends a new step to the dish, focused', () => {
    const result = addStep(SUNDAY_ROAST, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.steps.at(-1)?.id).toBe('gravy.step-1');
    expect(result.value.plan.steps.at(-1)?.dish).toBe('gravy');
    expect(result.value.focus).toBe(10);
  });
  it('addStep refuses an 81st step', () => {
    expect(addStep(bigPlan(8, 10), 0)).toEqual({ ok: false, error: 'too_many_steps' });
  });
});

describe('updateStep (R4.4)', () => {
  it('changes only the patched fields of that step', () => {
    const index = indexOf(SUNDAY_ROAST, 'chicken.roast');
    const result = updateStep(SUNDAY_ROAST, index, { minutes: 85 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plan.steps[index]).toEqual({ ...SUNDAY_ROAST.steps[index], minutes: 85 });
    expect(result.value.plan.steps.filter((_, i) => i !== index)).toEqual(
      SUNDAY_ROAST.steps.filter((_, i) => i !== index),
    );
  });
  it('rejects a blank title', () => {
    expect(updateStep(SUNDAY_ROAST, 0, { title: '   ' })).toEqual({
      ok: false,
      error: 'invalid_step',
    });
  });
  it('rejects minutes outside 1 to 480', () => {
    expect(updateStep(SUNDAY_ROAST, 0, { minutes: 0 })).toEqual({
      ok: false,
      error: 'invalid_step',
    });
    expect(updateStep(SUNDAY_ROAST, 0, { minutes: 481 })).toEqual({
      ok: false,
      error: 'invalid_step',
    });
  });
});
