import { DishSchema, err, LIMITS, ok, StepSchema, topologicalOrder } from '../../core/index.js';
import type { Dish, Plan, Result, Step } from '../../core/index.js';
import { removedDish, removedStep } from '../copy.js';

export type StepPatch = Partial<
  Pick<Step, 'title' | 'minutes' | 'appliance' | 'handsOn' | 'dish' | 'holdMin' | 'after'>
>;
export type EditResult<E> = Result<{ plan: Plan; focus: number | null; notice: string | null }, E>;

export const NEW_STEP = {
  title: 'New step',
  minutes: 10,
  appliance: 'none',
  handsOn: true,
  after: [],
  holdMin: null,
} as const;
/** The hold given to a step when "Keeps" is unchecked (decided here). */
export const DEFAULT_HOLD_MIN = 10;

const done = (plan: Plan, focus: number | null = null, notice: string | null = null) =>
  ok({ plan, focus, notice });

function trimHyphens(text: string): string {
  return text.replace(/^-+|-+$/g, '');
}

/** A dish id from a name: `"Crème brûlée"` gives `creme-brulee`; nothing usable gives `dish`. */
export function slugify(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  const cut = trimHyphens(trimHyphens(base).slice(0, LIMITS.dishIdMax));
  return cut === '' ? 'dish' : cut;
}

/** `base`, else `base-2`, `base-3`, ..., cut so the id stays within 40 characters. */
export function uniqueDishId(plan: Plan, base: string): string {
  const taken = new Set(plan.dishes.map((d) => d.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const id = trimHyphens(base.slice(0, LIMITS.dishIdMax - suffix.length)) + suffix;
    if (!taken.has(id)) return id;
  }
}

/** `<dishId>.step-<n>` with the smallest `n >= 1` no step of the plan uses. */
export function nextStepId(plan: Plan, dishId: string): string {
  const taken = new Set(plan.steps.map((s) => s.id));
  let n = 1;
  while (taken.has(`${dishId}.step-${n}`)) n++;
  return `${dishId}.step-${n}`;
}

/** Step indices in dependency order, or in plan order when the plan has a cycle (R4.1). */
export function stepOrder(plan: Plan): number[] {
  const all = plan.steps.map((_, i) => i);
  const order = topologicalOrder(plan);
  if (!order.ok) return all;
  const result: number[] = [];
  const used = new Set<number>();
  for (const id of order.value) {
    const index = plan.steps.findIndex((s) => s.id === id);
    if (index >= 0 && !used.has(index)) {
      used.add(index);
      result.push(index);
    }
  }
  for (const i of all) if (!used.has(i)) result.push(i);
  return result;
}

/** Ids of the steps that wait for `stepId`, directly or through others (R4.5). */
export function waitingOn(plan: Plan, stepId: string): Set<string> {
  const found = new Set<string>();
  const queue = [stepId];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const s of plan.steps) {
      if (current !== undefined && s.after.includes(current) && !found.has(s.id)) {
        found.add(s.id);
        queue.push(s.id);
      }
    }
  }
  return found;
}

/** Indices of the steps outside `ids` that list one of `ids` in `after`. */
export function dependentsOf(plan: Plan, ids: readonly string[]): number[] {
  const set = new Set(ids);
  const result: number[] = [];
  plan.steps.forEach((s, i) => {
    if (!set.has(s.id) && s.after.some((a) => set.has(a))) result.push(i);
  });
  return result;
}

function validName(name: string): string | null {
  const trimmed = name.trim();
  return DishSchema.shape.name.safeParse(trimmed).success ? trimmed : null;
}

export function addDish(
  plan: Plan,
  name: string,
): EditResult<'too_many_dishes' | 'too_many_steps' | 'invalid_name'> {
  const trimmed = validName(name);
  if (trimmed === null) return err('invalid_name');
  if (plan.dishes.length >= LIMITS.dishesMax) return err('too_many_dishes');
  if (plan.steps.length >= LIMITS.stepsMax) return err('too_many_steps');
  const dish: Dish = { id: uniqueDishId(plan, slugify(trimmed)), name: trimmed };
  const withDish: Plan = { ...plan, dishes: [...plan.dishes, dish] };
  const created: Step = {
    id: nextStepId(withDish, dish.id),
    dish: dish.id,
    ...NEW_STEP,
    after: [],
  };
  return done({ ...withDish, steps: [...plan.steps, created] }, plan.steps.length);
}

export function renameDish(plan: Plan, index: number, name: string): EditResult<'invalid_name'> {
  const trimmed = validName(name);
  if (trimmed === null) return err('invalid_name');
  const dish = plan.dishes[index];
  if (dish === undefined || dish.name === trimmed) return done(plan);
  const dishes = plan.dishes.map((d, i) => (i === index ? { ...d, name: trimmed } : d));
  return done({ ...plan, dishes });
}

/** Removes steps and their ids from remaining `after` lists, unless a remaining step has that id. */
function withoutSteps(
  plan: Plan,
  removed: ReadonlySet<number>,
): { steps: Step[]; changed: string[] } {
  const kept = plan.steps.filter((_, i) => !removed.has(i));
  const keptIds = new Set(kept.map((s) => s.id));
  const gone = new Set(plan.steps.filter((_, i) => removed.has(i)).map((s) => s.id));
  for (const id of keptIds) gone.delete(id);
  const changed: string[] = [];
  const steps = kept.map((s) => {
    if (!s.after.some((a) => gone.has(a))) return s;
    changed.push(s.title);
    return { ...s, after: s.after.filter((a) => !gone.has(a)) };
  });
  return { steps, changed };
}

export function removeDish(plan: Plan, index: number): EditResult<'last_dish' | 'last_step'> {
  const dish = plan.dishes[index];
  if (dish === undefined) return done(plan);
  if (plan.dishes.length === 1) return err('last_dish');
  const removed = new Set<number>();
  plan.steps.forEach((s, i) => {
    if (s.dish === dish.id) removed.add(i);
  });
  if (removed.size === plan.steps.length) return err('last_step');
  const { steps, changed } = withoutSteps(plan, removed);
  const dishes = plan.dishes.filter((_, i) => i !== index);
  return done({ ...plan, dishes, steps }, null, removedDish(dish.name, changed));
}

export function addStep(plan: Plan, dishIndex: number): EditResult<'too_many_steps'> {
  const dish = plan.dishes[dishIndex];
  if (dish === undefined) return done(plan);
  if (plan.steps.length >= LIMITS.stepsMax) return err('too_many_steps');
  const created: Step = { id: nextStepId(plan, dish.id), dish: dish.id, ...NEW_STEP, after: [] };
  return done({ ...plan, steps: [...plan.steps, created] }, plan.steps.length);
}

export function updateStep(
  plan: Plan,
  index: number,
  patch: StepPatch,
): EditResult<'invalid_step'> {
  const current = plan.steps[index];
  if (current === undefined) return done(plan);
  const merged = { ...current, ...patch };
  const parsed = StepSchema.safeParse(merged);
  if (!parsed.success) return err('invalid_step');
  if (JSON.stringify(parsed.data) === JSON.stringify(current)) return done(plan);
  return done({ ...plan, steps: plan.steps.map((s, i) => (i === index ? parsed.data : s)) });
}

export function removeStep(plan: Plan, index: number): EditResult<'last_step'> {
  const target = plan.steps[index];
  if (target === undefined) return done(plan);
  if (plan.steps.length === 1) return err('last_step');
  const { steps, changed } = withoutSteps(plan, new Set([index]));
  return done({ ...plan, steps }, null, removedStep(target.title, changed));
}
