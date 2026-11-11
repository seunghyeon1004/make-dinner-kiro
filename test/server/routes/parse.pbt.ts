import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createDailyCap, createRateLimiter } from '../../../src/server/parse/limits.js';
import { arbPerturbedText } from '../../support/arbitraries.js';
import { fcParams } from '../../support/fc-params.js';
import { oracleNormalise } from '../../support/oracles.js';
import { fixtureLibrary, makeTestApp, postParse, TEST_START_MS } from '../../support/server.js';

const DIR = new URL('../../fixtures/not-a-recording/', import.meta.url);
const SAMPLE_IDS = ['tiny-roast', 'tiny-salad'] as const;

function read(path: string): string {
  return readFileSync(new URL(path, DIR), 'utf8');
}

const cases = SAMPLE_IDS.map((id) => ({
  id,
  text: oracleNormalise(read(`samples/${id}.md`)),
  plan: (JSON.parse(read(`recordings/${id}.json`)) as { raw: unknown }).raw,
}));
const library = fixtureLibrary();

describe('P-RR5 recorded match', () => {
  it('P-RR5 recorded match: a perturbed sample text is answered from the recording, before and without any limit, key or model', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .constantFrom(...cases)
          .chain((c) => arbPerturbedText(c.text).map((text) => ({ c, text }))),
        async ({ c, text }) => {
          const limiter = createRateLimiter({ limit: 3, windowSec: 600 });
          for (let i = 0; i < 3; i++) limiter.record('203.0.113.7', TEST_START_MS);
          const cap = createDailyCap(2);
          cap.record(TEST_START_MS);
          cap.record(TEST_START_MS);
          const { app } = makeTestApp({ modelClient: null, rateLimiter: limiter, dailyCap: cap });
          const before = limiter.size();

          const res = await postParse(app, { text });
          expect(res.status).toBe(200);
          expect(await res.json()).toEqual({
            plan: c.plan,
            issues: library.samples.find((s) => s.id === c.id)?.issues,
            source: 'recording',
          });
          expect(limiter.size()).toEqual(before);
          expect(cap.usedToday(TEST_START_MS)).toBe(2);
        },
      ),
      fcParams(),
    );
  });
});
