/**
 * Guarantee families each spec proves, as the leading letter of the ids in
 * `.kiro/steering/scheduler-guarantees.md`. A family is claimed whole: every id of it needs a
 * property (see `guarantees.test.ts`). Later specs add an entry; none is removed.
 */
export const CLAIMS: Readonly<Record<string, readonly ('G' | 'R' | 'S' | 'D')[]>> = {
  'recipe-graph': ['S'],
  scheduler: ['G'],
};
