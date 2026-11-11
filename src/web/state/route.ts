import type { Route } from './store.js';

export type HashTarget =
  | { kind: 'none' }
  | { kind: 'route'; route: Route }
  | { kind: 'share'; version: number; payload: string }
  | { kind: 'unknown' };

const ROUTES: readonly Route[] = ['menu', 'steps', 'plan', 'cook'];
const SHARE_PATTERN = /^#\/share\/([0-9]{1,3})\.([A-Za-z0-9_-]{1,65536})$/;

/** Reads `location.hash`: '', '#', '#/' are none; '#/plan' a route; '#/share/1.<b64url>' a share. */
export function parseHash(hash: string): HashTarget {
  if (hash === '' || hash === '#' || hash === '#/') return { kind: 'none' };
  const route = ROUTES.find((r) => hash === `#/${r}`);
  if (route !== undefined) return { kind: 'route', route };
  const share = SHARE_PATTERN.exec(hash);
  if (share !== null) {
    return { kind: 'share', version: Number(share[1]), payload: share[2] ?? '' };
  }
  return { kind: 'unknown' };
}

export function hashOf(route: Route): string {
  return `#/${route}`;
}
