import { fetchSamples, postParse } from './api.js';
import type { FetchLike } from './api.js';
import { parseHash, hashOf } from './route.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import { saveState } from './persist.js';
import { COPY, PASTE_COPY, SHARE_COPY } from '../copy.js';
import { decodeShare } from './share-link.js';
import type { AppState, Store } from './store.js';

/** Everything the effects touch outside the store, so they can run against fakes. */
export interface EffectsEnv {
  storage: Pick<Storage, 'setItem'>;
  window: Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>;
  document: Document;
  fetch: FetchLike;
  clock?: Clock;
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

  // A share link is decoded in the browser (R8.5). The fragment is replaced before the state
  // changes, so the app's own hash sync adds no history entry and the payload leaves the bar.
  const clock = env.clock ?? systemClock;
  const openShare = async (version: number, payload: string): Promise<void> => {
    const decoded = await decodeShare(version, payload);
    if (!decoded.ok) {
      const { error } = decoded;
      const text =
        error.kind === 'unknown_version'
          ? SHARE_COPY.version
          : error.kind === 'invalid_plan'
            ? SHARE_COPY.invalidPlan
            : SHARE_COPY.damaged;
      win.history.replaceState(null, '', hashOf('menu'));
      store.dispatch({ type: 'navigate', route: 'menu', cookRegistered: env.cookRegistered });
      store.dispatch({ type: 'notice/set', text });
      return;
    }
    // With a dinner stored the cook is asked on the Menu; without one the shared plan opens.
    const asks = store.getState().dinner !== null;
    win.history.replaceState(null, '', hashOf(asks ? 'menu' : 'plan'));
    if (asks) {
      store.dispatch({ type: 'navigate', route: 'menu', cookRegistered: env.cookRegistered });
    }
    store.dispatch({
      type: 'dinner/load',
      nowMs: clock.nowMs(),
      load: {
        plan: decoded.value.plan,
        source: { kind: 'share' },
        kitchen: decoded.value.kitchen,
        serve: decoded.value.serve,
        suggested: null,
        route: 'plan',
        notice: SHARE_COPY.opened,
      },
    });
  };
  if (target.kind === 'share') void openShare(target.version, target.payload);
  else replaceHash();

  const onHashChange = (): void => {
    const next = parseHash(win.location.hash);
    if (next.kind === 'share') {
      void openShare(next.version, next.payload);
      return;
    }
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

  // Parse: one request at a time, owned here. The store says `busy`; leaving `busy` aborts it.
  let inFlight: { requestId: number; controller: AbortController } | null = null;
  const syncParse = (): void => {
    const { parse, recipeText } = store.getState();
    if (parse.status !== 'busy') {
      if (inFlight !== null) {
        const stopped = inFlight;
        inFlight = null;
        stopped.controller.abort();
      }
      return;
    }
    if (inFlight?.requestId === parse.requestId) return;
    inFlight?.controller.abort();
    const { requestId } = parse;
    const controller = new AbortController();
    inFlight = { requestId, controller };
    void postParse(env.fetch, recipeText, controller.signal, clock.nowMs()).then((result) => {
      if (inFlight?.requestId === requestId) inFlight = null;
      if (result.ok) {
        store.dispatch({ type: 'parse/done', requestId, plan: result.value, nowMs: clock.nowMs() });
      } else if (result.error.kind === 'cancelled') {
        store.dispatch({ type: 'notice/set', text: PASTE_COPY.stopped });
      } else {
        store.dispatch({ type: 'parse/failed', requestId, failure: result.error });
      }
    });
  };

  const unsubscribe = store.subscribe(() => {
    apply();
    fetchSamplesWhenWanted();
    syncParse();
  });
  apply();
  fetchSamplesWhenWanted();
  syncParse();
  // Boot save: the state that was loaded (or just fresh) is written once.
  saveState(env.storage, store.getState());

  return () => {
    unsubscribe();
    win.removeEventListener('hashchange', onHashChange);
  };
}
