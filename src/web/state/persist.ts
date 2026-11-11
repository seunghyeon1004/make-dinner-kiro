import { z } from 'zod';
import { KitchenSchema, ServeTimeSchema, validatePlan } from '../../core/index.js';
import { COPY } from '../copy.js';
import { CookStateSchema } from './cook-slot.js';
import { initialState, reduce } from './store.js';
import type { AppState } from './store.js';

export const STATE_KEY = 'make-dinner:state';

const PlanSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sample'), sampleId: z.string().min(1).max(80) }),
  z.strictObject({ kind: z.literal('recipes') }),
  z.strictObject({ kind: z.literal('dinnerfile') }),
  z.strictObject({ kind: z.literal('share') }),
]);

export const PersistedStateSchema = z.strictObject({
  version: z.literal(1),
  route: z.enum(['menu', 'steps', 'plan', 'cook']),
  theme: z.enum(['system', 'light', 'dark']),
  dinner: z
    .strictObject({
      plan: z.unknown(), // validatePlan must give a plan
      source: PlanSourceSchema,
      kitchen: KitchenSchema,
      serving: z.strictObject({ time: ServeTimeSchema, atMs: z.int() }).nullable(),
    })
    .nullable(),
  recipeText: z.string().max(200_000),
  dinnerfileText: z.string().max(1_048_576),
  cook: CookStateSchema.nullable(),
});

export function toPersisted(state: AppState): z.input<typeof PersistedStateSchema> {
  return {
    version: 1,
    route: state.route,
    theme: state.theme,
    dinner:
      state.dinner === null
        ? null
        : {
            plan: state.dinner.plan,
            source: state.dinner.source,
            kitchen: state.dinner.kitchen,
            serving: state.dinner.serving,
          },
    recipeText: state.recipeText,
    dinnerfileText: state.dinnerfileText,
    cook: state.cook,
  };
}

function fresh(): { state: AppState; notice: string } {
  return { state: initialState(), notice: COPY.savedUnreadable };
}

/**
 * Reads the stored state. Anything unreadable starts fresh with a notice; a missing key starts
 * fresh silently. The stored route goes through `navigate`, so an unreachable one is replaced.
 */
export function loadState(
  storage: Pick<Storage, 'getItem'>,
  cookRegistered: boolean,
): { state: AppState; notice: string | null } {
  let raw: string | null;
  try {
    raw = storage.getItem(STATE_KEY);
  } catch {
    return fresh();
  }
  if (raw === null) return { state: initialState(), notice: null };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fresh();
  }
  const parsed = PersistedStateSchema.safeParse(json);
  if (!parsed.success) return fresh();
  const stored = parsed.data;
  let dinner: AppState['dinner'] = null;
  if (stored.dinner !== null) {
    const check = validatePlan(stored.dinner.plan);
    if (check.plan === null) return fresh();
    dinner = {
      plan: check.plan,
      source: stored.dinner.source,
      kitchen: stored.dinner.kitchen,
      serving: stored.dinner.serving,
    };
  }
  const loaded: AppState = {
    ...initialState(),
    theme: stored.theme,
    dinner,
    recipeText: stored.recipeText,
    dinnerfileText: stored.dinnerfileText,
    cook: stored.cook,
  };
  const state = reduce(loaded, { type: 'navigate', route: stored.route, cookRegistered });
  return { state, notice: null };
}

/** Writes the persisted state; false when the storage refuses (R9.6). */
export function saveState(storage: Pick<Storage, 'setItem'>, state: AppState): boolean {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(toPersisted(state)));
    return true;
  } catch {
    return false;
  }
}
