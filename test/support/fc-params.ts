import type { Parameters } from 'fast-check';

const DEFAULT_NUM_RUNS = 200;
const DEFAULT_MAKE_RUNS = 50;

/**
 * The shared fast-check parameters: 200 runs, or `FC_NUM_RUNS` when it is a positive
 * integer. No property file sets `numRuns` itself (testing.md).
 */
export function fcParams(): Parameters<unknown[]> {
  const requested = Number(process.env.FC_NUM_RUNS);
  const numRuns = Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_NUM_RUNS;
  return { numRuns };
}

/** For properties that spawn make: `FC_MAKE_RUNS` when it is a positive integer, else 50. */
export function fcMakeParams(): Parameters<unknown[]> {
  const requested = Number(process.env.FC_MAKE_RUNS);
  const numRuns = Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_MAKE_RUNS;
  return { numRuns };
}
