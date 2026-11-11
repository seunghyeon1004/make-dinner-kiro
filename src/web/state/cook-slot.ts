import { z } from 'zod';

/*
 * Placeholders that cooking-mode replaces (plan-ui R9.9). The store, the persisted state and
 * the reducer are written against these names and need no other change.
 */
export type CookState = never;
export type CookAction = never;
export const CookStateSchema = z.never();

export function reduceCook<S>(state: S, action: CookAction): S {
  void action;
  return state;
}
