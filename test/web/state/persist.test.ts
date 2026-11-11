import { describe, expect, it } from 'vitest';
import { loadState, saveState, STATE_KEY, toPersisted } from '../../../src/web/state/persist.js';
import { initialState } from '../../../src/web/state/store.js';
import type { AppState, Dinner } from '../../../src/web/state/store.js';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../../support/fixtures.js';

const UNREADABLE = 'Your saved dinner could not be read, so the app started fresh.';

function storageOf(value: string | null | 'throw'): Pick<Storage, 'getItem'> {
  return {
    getItem: (key) => {
      expect(key).toBe(STATE_KEY);
      if (value === 'throw') throw new Error('blocked');
      return value;
    },
  };
}

const SAVED_DINNER: Dinner = {
  plan: SUNDAY_ROAST,
  source: { kind: 'sample', sampleId: 'sunday-roast' },
  kitchen: HOME_KITCHEN,
  serving: { time: '19:30', atMs: 1_762_889_400_000 },
};

const SAVED: AppState = {
  ...initialState(),
  route: 'plan',
  theme: 'dark',
  recipeText: 'Roast a chicken.',
  dinnerfileText: '# plan "x"',
  dinner: SAVED_DINNER,
};

describe('loadState (R9.5, R9.6)', () => {
  it('R9.5 a missing key starts fresh without a notice', () => {
    expect(loadState(storageOf(null), false)).toEqual({ state: initialState(), notice: null });
  });
  it('R9.6 getItem throwing starts fresh with the notice', () => {
    expect(loadState(storageOf('throw'), false)).toEqual({
      state: initialState(),
      notice: UNREADABLE,
    });
  });
  it('R9.6 bad JSON starts fresh with the notice', () => {
    expect(loadState(storageOf('{not json'), false)).toEqual({
      state: initialState(),
      notice: UNREADABLE,
    });
  });
  it('R9.6 a schema failure starts fresh with the notice', () => {
    const stored = JSON.stringify({ ...toPersisted(SAVED), version: 2 });
    expect(loadState(storageOf(stored), false)).toEqual({
      state: initialState(),
      notice: UNREADABLE,
    });
  });
  it('R9.6 a plan failing validatePlan starts fresh with the notice', () => {
    const persisted = toPersisted(SAVED);
    const stored = JSON.stringify({
      ...persisted,
      dinner: { ...persisted.dinner, plan: { title: 'x', dishes: [], steps: [] } },
    });
    expect(loadState(storageOf(stored), false)).toEqual({
      state: initialState(),
      notice: UNREADABLE,
    });
  });
  it('R9.5 toPersisted then loadState gives the persisted fields back', () => {
    const stored = JSON.stringify(toPersisted(SAVED));
    const loaded = loadState(storageOf(stored), false);
    expect(loaded.notice).toBeNull();
    expect(loaded.state).toEqual(SAVED);
  });
  it('R9.5 a plan with an error is kept and returns to Steps', () => {
    const broken: AppState = {
      ...SAVED,
      dinner: {
        ...SAVED_DINNER,
        plan: {
          ...SUNDAY_ROAST,
          steps: SUNDAY_ROAST.steps.map((s) =>
            s.id === 'gravy.roux' ? { ...s, after: ['chicken.rost'] } : s,
          ),
        },
      },
    };
    const loaded = loadState(storageOf(JSON.stringify(toPersisted(broken))), false);
    expect(loaded.notice).toBeNull();
    expect(loaded.state.route).toBe('steps');
    expect(loaded.state.dinner?.plan.steps.find((s) => s.id === 'gravy.roux')?.after).toEqual([
      'chicken.rost',
    ]);
  });
  it('R9.3 a stored cook route without a cook screen comes back as plan', () => {
    const stored = JSON.stringify({ ...toPersisted(SAVED), route: 'cook' });
    expect(loadState(storageOf(stored), false).state.route).toBe('plan');
  });
});

describe('saveState (R9.6)', () => {
  it('writes the persisted state under the key and returns true', () => {
    const written: Array<[string, string]> = [];
    const ok = saveState({ setItem: (k, v) => void written.push([k, v]) }, SAVED);
    expect(ok).toBe(true);
    expect(written).toEqual([[STATE_KEY, JSON.stringify(toPersisted(SAVED))]]);
  });
  it('returns false when setItem throws', () => {
    const ok = saveState(
      {
        setItem: () => {
          throw new Error('quota');
        },
      },
      SAVED,
    );
    expect(ok).toBe(false);
  });
});
