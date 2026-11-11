import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/print.css';
import { App, SCREENS } from './app.js';
import { StoreProvider } from './state/hooks.js';
import { startEffects } from './state/effects.js';
import { loadState } from './state/persist.js';
import { createStore } from './state/store.js';

const root = document.getElementById('app');
if (root === null) {
  throw new Error('Missing #app element in index.html');
}

/** localStorage can throw on access (privacy modes); the shim makes that a failed read and write. */
function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    return window.localStorage;
  } catch {
    const blocked = (): never => {
      throw new Error('Storage is not available');
    };
    return { getItem: blocked, setItem: blocked };
  }
}

const storage = browserStorage();
const cookRegistered = SCREENS.cook !== null;
const loaded = loadState(storage, cookRegistered);
const store = createStore(
  loaded.notice === null ? loaded.state : { ...loaded.state, notice: loaded.notice },
);
startEffects(store, {
  storage,
  window,
  document,
  fetch: (url, init) => window.fetch(url, init),
  cookRegistered,
});

render(
  <StoreProvider store={store}>
    <App />
  </StoreProvider>,
  root,
);
