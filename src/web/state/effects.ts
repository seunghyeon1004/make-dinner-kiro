import { fetchSamples } from './api.js';
import type { FetchLike } from './api.js';
import { parseHash, hashOf } from './route.js';
import { saveState } from './persist.js';
import { COPY } from '../copy.js';
import type { AppState, Store } from './store.js';

/** Everything the effects touch outside the store, so they can run against fakes. */
export interface EffectsEnv {
  storage: Pick<Storage, 'setItem'>;
  window: Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>;
  document: Document;
  fetch: FetchLike;
  /** True once cooking-mode has registered its screen (`SCREENS.cook !== null`). */
  cookRegistered: boolean;
}

/** The six fields `PersistedStateSchema` stores, compared by identity. */
function persistedPart(state: AppState): readonly unknown[] {
  return [
    state.route,
    state.theme,
    state.dinner,
    state.recipeText,
    state.dinnerfileText,
    state.cook,
  ];
}

function samePart(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.every((item, index) => Object.is(item, b[index]));
}

/** Starts persistence, hash sync and the theme attribute. Returns a function that stops them. */
export function startEffects(store: Store, env: EffectsEnv): () => void {
  const { window: win, document: doc } = env;

  // Hash: the boot target first, then both directions of the sync (R9.3).
  const target = parseHash(win.location.hash);
  if (target.kind === 'route') {
    store.dispatch({ type: 'navigate', route: target.route, cookRegistered: env.cookRegistered });
  }
  const replaceHash = (): void => {
    const desired = hashOf(store.getState().route);
    if (win.location.hash !== desired) win.history.replaceState(null, '', desired);
  };
  replaceHash();

  const onHashChange = (): void => {
    const next = parseHash(win.location.hash);
    if (next.kind === 'route' && next.route !== store.getState().route) {
      store.dispatch({ type: 'navigate', route: next.route, cookRegistered: env.cookRegistered });
    }
    replaceHash();
  };
  win.addEventListener('hashchange', onHashChange);

  let saveFailedShown = false;
  let lastPersisted = persistedPart(store.getState());
  let lastRoute = store.getState().route;

  const apply = (): void => {
    const state = store.getState();

    // Route changed by the app: a history entry.
    if (state.route !== lastRoute) {
      lastRoute = state.route;
      if (win.location.hash !== hashOf(state.route)) win.location.hash = hashOf(state.route);
    }

    // Theme: System removes the attribute so prefers-color-scheme decides.
    if (state.theme === 'system') doc.documentElement.removeAttribute('data-theme');
    else doc.documentElement.setAttribute('data-theme', state.theme);

    // Persistence: only when a persisted field changed.
    const part = persistedPart(state);
    if (!samePart(part, lastPersisted)) {
      lastPersisted = part;
      if (!saveState(env.storage, state) && !saveFailedShown) {
        saveFailedShown = true;
        store.dispatch({ type: 'notice/set', text: COPY.saveFailed });
      }
    }
  };

  // Samples: fetched once per page load, when the Menu is open (R1.1); "Try again" sets
  // `loading` again, which starts the next fetch.
  let fetching = false;
  const fetchSamplesWhenWanted = (): void => {
    const state = store.getState();
    if (state.route === 'menu' && state.samples.status === 'idle') {
      store.dispatch({ type: 'samples/loading' });
      return;
    }
    if (state.samples.status !== 'loading' || fetching) return;
    fetching = true;
    void fetchSamples(env.fetch).then((result) => {
      fetching = false;
      store.dispatch(
        result.ok ? { type: 'samples/loaded', samples: result.value } : { type: 'samples/failed' },
      );
    });
  };

  const unsubscribe = store.subscribe(() => {
    apply();
    fetchSamplesWhenWanted();
  });
  apply();
  fetchSamplesWhenWanted();
  // Boot save: the state that was loaded (or just fresh) is written once.
  saveState(env.storage, store.getState());

  return () => {
    unsubscribe();
    win.removeEventListener('hashchange', onHashChange);
  };
}
