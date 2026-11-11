import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApiErrorSchema, err, ok, ParseResponseSchema } from '../../../src/core/index.js';
import type { ModelClient, ModelError } from '../../../src/server/parse/anthropic-client.js';
import { createDailyCap, createRateLimiter } from '../../../src/server/parse/limits.js';
import { fakeClock, fakeModelClient } from '../../support/fakes.js';
import type { LogCall } from '../../support/fakes.js';
import { makeTestApp, postParse, TEST_START_MS } from '../../support/server.js';

// --- hand-written values -------------------------------------------------------------------

const MSG = {
  json: 'Send the recipes as JSON in the form { "text": "..." }.',
  empty: 'Paste at least one recipe.',
  bodyTooLarge: 'The request is too large. Paste at most 12,000 characters of recipes.',
  noKey:
    'This server has no recipe reader set up. The sample dinners and Dinnerfile import still work.',
  unavailable:
    'The recipe reader is not available right now. Try again in a few minutes. The sample dinners and Dinnerfile import still work.',
  refused:
    'The recipe reader declined to read this text. Check that it is a recipe, or try a sample dinner.',
  invalidOutput:
    'The recipe reader returned steps this app cannot use. Try again, or paste fewer dishes at a time.',
  daily:
    'The recipe reader has reached its limit for today. It starts again at midnight UTC. The sample dinners and Dinnerfile import still work.',
  notARecipe: 'That does not look like a recipe. Paste the ingredients and method for each dish.',
  internal: 'Something went wrong on our side. Try again in a moment.',
};
const rateLimited = (wait: string) =>
  `Too many recipe reads from your address. Try again in ${wait}. The sample dinners and Dinnerfile import still work.`;

function fixtureRaw(id: string): unknown {
  const file = new URL(`../../fixtures/not-a-recording/recordings/${id}.json`, import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { raw: unknown }).raw;
}
const SALAD_RAW = fixtureRaw('tiny-salad');
const SALAD_TEXT = readFileSync(
  new URL('../../fixtures/not-a-recording/samples/tiny-salad.md', import.meta.url),
  'utf8',
);

/** A text that is not a sample. */
const freeText = (n = 0) => `Boil egg number ${n}, 8 minutes.`;

const SENTINEL_RAW = {
  title: 'Not a recipe',
  dishes: [{ id: 'not-a-recipe', name: 'Not a recipe' }],
  steps: [
    {
      id: 'not-a-recipe.skip',
      dish: 'not-a-recipe',
      title: 'Not a recipe',
      minutes: 1,
      appliance: 'none',
      handsOn: false,
      after: [],
      holdMin: null,
    },
  ],
};

async function expectError(res: Response, status: number, code: string, message: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  const body: unknown = await res.json();
  expect(body).toEqual({ error: { code, message } });
  expect(ApiErrorSchema.safeParse(body).success).toBe(true);
}

/** A body of exactly `bytes` bytes: {"text":"aaa..."}. */
function bodyOfBytes(bytes: number): string {
  return `{"text":"${'a'.repeat(bytes - 11)}"}`;
}

// --- input (T5.3) --------------------------------------------------------------------------

describe('R4.1 content type', () => {
  it.each(['text/plain', 'application/jsonx', 'application/json-patch+json', 'text/json'])(
    'R4.1 %s is a bad_request',
    async (contentType) => {
      const { app } = makeTestApp();
      const res = await postParse(
        app,
        { text: freeText() },
        { headers: { 'content-type': contentType } },
      );
      await expectError(res, 400, 'bad_request', MSG.json);
    },
  );

  it.each([
    'application/json',
    'APPLICATION/JSON',
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
  ])('R4.1 %s is accepted (parameters allowed, case-insensitive)', async (contentType) => {
    const { app } = makeTestApp();
    const res = await postParse(
      app,
      { text: freeText() },
      { headers: { 'content-type': contentType } },
    );
    // Past the input checks, a server without a key answers model_unavailable.
    await expectError(res, 503, 'model_unavailable', MSG.noKey);
  });
});

describe('R4.2 body size', () => {
  it('R4.2 a body of 65,537 bytes is input_too_long', async () => {
    const { app } = makeTestApp();
    const res = await postParse(app, null, { rawBody: bodyOfBytes(65_537) });
    await expectError(res, 413, 'input_too_long', MSG.bodyTooLarge);
  });

  it('R4.2 a body of 65,536 bytes is read, and then fails the character limit instead', async () => {
    const { app } = makeTestApp();
    const res = await postParse(app, null, { rawBody: bodyOfBytes(65_536) });
    await expectError(
      res,
      413,
      'input_too_long',
      'The recipes are 65,525 characters long and the limit is 12,000. Paste fewer dishes at a time.',
    );
  });
});

describe('R4.3 body shape', () => {
  it.each([
    ['not JSON', { rawBody: '{"text":' }],
    ['an empty body', { rawBody: '' }],
    ['a JSON array', { rawBody: '["a"]' }],
    ['null', { rawBody: 'null' }],
    ['no text key', { rawBody: '{}' }],
    ['a number for text', { rawBody: '{"text":5}' }],
    ['an extra key', { rawBody: '{"text":"a","more":1}' }],
  ])('R4.3 %s is a bad_request', async (_name, options) => {
    const { app } = makeTestApp();
    await expectError(await postParse(app, null, options), 400, 'bad_request', MSG.json);
  });
});

describe('R4.4 to R4.6 normalise, empty, length', () => {
  it('R4.5 text that is empty after normalising is a bad_request', async () => {
    const { app } = makeTestApp();
    for (const text of ['', '   ', '\n\r\n\t \n']) {
      await expectError(await postParse(app, { text }), 400, 'bad_request', MSG.empty);
    }
  });

  it('R4.6 12,001 characters is input_too_long, naming the count with a thousands separator', async () => {
    const { app } = makeTestApp();
    const res = await postParse(app, { text: 'a'.repeat(12_001) });
    await expectError(
      res,
      413,
      'input_too_long',
      'The recipes are 12,001 characters long and the limit is 12,000. Paste fewer dishes at a time.',
    );
  });

  it('R4.6 exactly 12,000 characters is accepted', async () => {
    const { app } = makeTestApp();
    await expectError(
      await postParse(app, { text: 'a'.repeat(12_000) }),
      503,
      'model_unavailable',
      MSG.noKey,
    );
  });

  it('R4.4 R4.6 trailing spaces that normalisation removes do not count', async () => {
    const { app } = makeTestApp();
    const text = `${'a'.repeat(12_000)}${' '.repeat(100)}`;
    await expectError(await postParse(app, { text }), 503, 'model_unavailable', MSG.noKey);
  });

  it('R4.6 characters are Unicode code points: 12,000 emoji pass, 12,001 do not', async () => {
    const { app } = makeTestApp();
    await expectError(
      await postParse(app, { text: '🍳'.repeat(12_000) }),
      503,
      'model_unavailable',
      MSG.noKey,
    );
    await expectError(
      await postParse(app, { text: '🍳'.repeat(12_001) }),
      413,
      'input_too_long',
      'The recipes are 12,001 characters long and the limit is 12,000. Paste fewer dishes at a time.',
    );
  });

  it('R4.4 the model gets the normalised text', async () => {
    const client = fakeModelClient([ok(SALAD_RAW)]);
    const { app } = makeTestApp({ modelClient: client });
    const res = await postParse(app, { text: '  Boil an egg.  \r\n\r\n\r\n\r\nServe.\t\r\n' });
    expect(res.status).toBe(200);
    expect(client.calls).toEqual(['Boil an egg.\n\nServe.']);
  });
});

describe('only POST is routed', () => {
  it('GET /api/parse is not_found', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/api/parse');
    await expectError(res, 404, 'not_found', 'There is nothing at this address.');
  });
});

// --- every error code and the success body (T5.3) ------------------------------------------

describe('R8.2 R10.2 to R10.5 the error table', () => {
  it('R8.2 model_unavailable (503) when the server has no key', async () => {
    const { app } = makeTestApp({ modelClient: null });
    await expectError(
      await postParse(app, { text: freeText() }),
      503,
      'model_unavailable',
      MSG.noKey,
    );
  });

  it('R10.4 model_unavailable (503) when the client says unavailable', async () => {
    const error: ModelError = { kind: 'unavailable', reason: 'overloaded', status: 529 };
    const { app } = makeTestApp({ modelClient: fakeModelClient([err(error)]) });
    await expectError(
      await postParse(app, { text: freeText() }),
      503,
      'model_unavailable',
      MSG.unavailable,
    );
  });

  it('R10.4 model_refused (502) when the client says refused', async () => {
    const { app } = makeTestApp({
      modelClient: fakeModelClient([err({ kind: 'refused', category: 'cyber' })]),
    });
    await expectError(
      await postParse(app, { text: freeText() }),
      502,
      'model_refused',
      MSG.refused,
    );
  });

  it('R10.4 model_output_invalid (502) when the client says output_invalid', async () => {
    const { app } = makeTestApp({
      modelClient: fakeModelClient([err({ kind: 'output_invalid', reason: 'max_tokens' })]),
    });
    await expectError(
      await postParse(app, { text: freeText() }),
      502,
      'model_output_invalid',
      MSG.invalidOutput,
    );
  });

  it('R10.2 model_output_invalid (502) when the raw value fails the schema, with no plan and no raw in the body', async () => {
    const { app } = makeTestApp({
      modelClient: fakeModelClient([ok({ title: 'MODEL-MARKER-TEXT' })]),
    });
    const res = await postParse(app, { text: freeText() });
    const text = await res.clone().text();
    await expectError(res, 502, 'model_output_invalid', MSG.invalidOutput);
    expect(text).not.toContain('MODEL-MARKER-TEXT');
  });

  it('R9.10 internal (500) when the client throws something else, without its message', async () => {
    const { app } = makeTestApp({
      modelClient: fakeModelClient([new Error('boom-secret-detail')]),
    });
    const res = await postParse(app, { text: freeText() });
    const text = await res.clone().text();
    await expectError(res, 500, 'internal', MSG.internal);
    expect(text).not.toContain('boom-secret-detail');
  });

  it('R6.1 rate_limited (429) with Retry-After, written in whole minutes', async () => {
    const limiter = createRateLimiter({ limit: 1, windowSec: 600 });
    const { app } = makeTestApp({
      modelClient: fakeModelClient([ok(SALAD_RAW)]),
      rateLimiter: limiter,
    });
    expect((await postParse(app, { text: freeText(1) })).status).toBe(200);
    const res = await postParse(app, { text: freeText(2) });
    expect(res.headers.get('retry-after')).toBe('600');
    await expectError(res, 429, 'rate_limited', rateLimited('10 minutes'));
  });

  it('R6.1 R6.3 one minute is written "1 minute", and 61 seconds rounds up to 2 minutes', async () => {
    for (const [windowSec, wait] of [
      [60, '1 minute'],
      [61, '2 minutes'],
    ] as const) {
      const { app } = makeTestApp({
        modelClient: fakeModelClient([ok(SALAD_RAW)]),
        rateLimiter: createRateLimiter({ limit: 1, windowSec }),
      });
      await postParse(app, { text: freeText(1) });
      const res = await postParse(app, { text: freeText(2) });
      expect(res.headers.get('retry-after')).toBe(String(windowSec));
      await expectError(res, 429, 'rate_limited', rateLimited(wait));
    }
  });

  it('R7.1 daily_cap_reached (429) with Retry-After until midnight UTC', async () => {
    const { app } = makeTestApp({
      modelClient: fakeModelClient([ok(SALAD_RAW)]),
      dailyCap: createDailyCap(1),
    });
    expect((await postParse(app, { text: freeText(1) })).status).toBe(200);
    const res = await postParse(app, { text: freeText(2) });
    // The fake clock starts at 12:00:00 UTC: 12 hours to midnight.
    expect(res.headers.get('retry-after')).toBe('43200');
    await expectError(res, 429, 'daily_cap_reached', MSG.daily);
  });

  it('review Q4 invalid_plan (422) when the model reads the text as not a recipe, and no plan is returned', async () => {
    const { app } = makeTestApp({ modelClient: fakeModelClient([ok(SENTINEL_RAW)]) });
    const res = await postParse(app, { text: 'Dear Sam, see you on Friday.' });
    const text = await res.clone().text();
    await expectError(res, 422, 'invalid_plan', MSG.notARecipe);
    expect(text).not.toContain('not-a-recipe');
  });

  it('review Q4 the sentinel dish among other dishes is an ordinary plan (200)', async () => {
    const raw = structuredClone(SALAD_RAW) as { dishes: unknown[]; steps: unknown[] };
    raw.dishes.push({ id: 'not-a-recipe', name: 'Not a recipe' });
    raw.steps.push(SENTINEL_RAW.steps[0]);
    const { app } = makeTestApp({ modelClient: fakeModelClient([ok(raw)]) });
    const res = await postParse(app, { text: freeText() });
    expect(res.status).toBe(200);
  });

  it('R10.3 a model plan is 200 { plan, issues, source: "model" } and matches ParseResponseSchema', async () => {
    const { app } = makeTestApp({ modelClient: fakeModelClient([ok(SALAD_RAW)]) });
    const res = await postParse(app, { text: freeText() });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({ plan: SALAD_RAW, issues: [], source: 'model' });
    expect(ParseResponseSchema.safeParse(body).success).toBe(true);
  });
});

// --- order of checks and consumption (T5.4) ------------------------------------------------

describe('R5 R8.1 recorded samples are answered first and consume nothing', () => {
  it('R5.1 R5.2 R8.1 a sample text is served with the limiter exhausted, the cap reached and no key', async () => {
    const limiter = createRateLimiter({ limit: 1, windowSec: 600 });
    const cap = createDailyCap(1);
    limiter.record('203.0.113.7', TEST_START_MS);
    cap.record(TEST_START_MS);
    const { app, clock } = makeTestApp({ modelClient: null, rateLimiter: limiter, dailyCap: cap });
    const res = await postParse(app, { text: SALAD_TEXT });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: unknown; issues: unknown; source: string };
    expect(body).toEqual({ plan: SALAD_RAW, issues: [], source: 'recording' });
    expect(limiter.size()).toEqual({ clients: 1, timestamps: 1 });
    expect(cap.usedToday(clock.nowMs())).toBe(1);
  });

  it('R5.1 a sample text with other line endings and trailing spaces is still the sample', async () => {
    const { app } = makeTestApp({ modelClient: null });
    const res = await postParse(app, { text: SALAD_TEXT.replaceAll('\n', '  \r\n') });
    expect(((await res.json()) as { source: string }).source).toBe('recording');
  });

  it('R5.1 a sample text with one more word is not the sample', async () => {
    const { app } = makeTestApp({ modelClient: null });
    await expectError(
      await postParse(app, { text: `${SALAD_TEXT}\nAdd salt.` }),
      503,
      'model_unavailable',
      MSG.noKey,
    );
  });
});

describe('R6.4 R7.2 R8.2 what each check consumes', () => {
  it('R7.2 a rate-limited request does not consume the daily cap', async () => {
    const limiter = createRateLimiter({ limit: 1, windowSec: 600 });
    const cap = createDailyCap(10);
    const { app, clock } = makeTestApp({
      modelClient: fakeModelClient([ok(SALAD_RAW)]),
      rateLimiter: limiter,
      dailyCap: cap,
    });
    expect((await postParse(app, { text: freeText(1) })).status).toBe(200);
    expect(cap.usedToday(clock.nowMs())).toBe(1);
    expect((await postParse(app, { text: freeText(2) })).status).toBe(429);
    expect(cap.usedToday(clock.nowMs())).toBe(1);
  });

  it('R6.4 a capped request does not consume the rate limit', async () => {
    const limiter = createRateLimiter({ limit: 2, windowSec: 600 });
    const cap = createDailyCap(1);
    const { app, clock } = makeTestApp({
      modelClient: fakeModelClient([ok(SALAD_RAW)]),
      rateLimiter: limiter,
      dailyCap: cap,
    });
    expect((await postParse(app, { text: freeText(1) }, { peer: '198.51.100.1' })).status).toBe(
      200,
    );
    const res = await postParse(app, { text: freeText(2) }, { peer: '198.51.100.2' });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'daily_cap_reached',
    );
    expect(limiter.size()).toEqual({ clients: 1, timestamps: 1 });
    expect(limiter.check('198.51.100.2', clock.nowMs())).toEqual({ ok: true });
  });

  it('R8.2 a request on a server without a key consumes nothing, and the same limits then allow `limit` calls', async () => {
    const limiter = createRateLimiter({ limit: 3, windowSec: 600 });
    const cap = createDailyCap(3);
    const keyless = makeTestApp({ modelClient: null, rateLimiter: limiter, dailyCap: cap });
    for (let i = 0; i < 5; i++) {
      expect((await postParse(keyless.app, { text: freeText(i) })).status).toBe(503);
    }
    expect(limiter.size()).toEqual({ clients: 0, timestamps: 0 });
    expect(cap.usedToday(keyless.clock.nowMs())).toBe(0);

    const keyed = makeTestApp({
      modelClient: fakeModelClient([ok(SALAD_RAW), ok(SALAD_RAW), ok(SALAD_RAW)]),
      rateLimiter: limiter,
      dailyCap: cap,
    });
    for (let i = 0; i < 3; i++) {
      expect((await postParse(keyed.app, { text: freeText(i) })).status).toBe(200);
    }
    expect((await postParse(keyed.app, { text: freeText(9) })).status).toBe(429);
  });

  it('R6.4 R7.2 R7.3 a failed model call still counts once against both limits', async () => {
    const limiter = createRateLimiter({ limit: 5, windowSec: 600 });
    const cap = createDailyCap(5);
    const { app, clock } = makeTestApp({
      modelClient: fakeModelClient([err({ kind: 'unavailable', reason: 'timeout', status: null })]),
      rateLimiter: limiter,
      dailyCap: cap,
    });
    expect((await postParse(app, { text: freeText() })).status).toBe(503);
    expect(limiter.size()).toEqual({ clients: 1, timestamps: 1 });
    expect(cap.usedToday(clock.nowMs())).toBe(1);
  });

  it('R7.2 rejected input consumes nothing', async () => {
    const limiter = createRateLimiter({ limit: 5, windowSec: 600 });
    const cap = createDailyCap(5);
    const { app, clock } = makeTestApp({
      modelClient: fakeModelClient([]),
      rateLimiter: limiter,
      dailyCap: cap,
    });
    await postParse(app, { text: '' });
    await postParse(app, null, { rawBody: 'nope' });
    await postParse(app, { text: 'a'.repeat(12_001) });
    expect(limiter.size()).toEqual({ clients: 0, timestamps: 0 });
    expect(cap.usedToday(clock.nowMs())).toBe(0);
  });
});

describe('R6.3 R7.1 Retry-After through the route, with the fake clock', () => {
  it('R6.3 limit 2 in a 10 s window: the third call at +2 s is refused with Retry-After 8', async () => {
    const { app, clock } = makeTestApp({
      modelClient: fakeModelClient([ok(SALAD_RAW), ok(SALAD_RAW)]),
      rateLimiter: createRateLimiter({ limit: 2, windowSec: 10 }),
    });
    expect((await postParse(app, { text: freeText(1) })).status).toBe(200);
    clock.advance(1_000);
    expect((await postParse(app, { text: freeText(2) })).status).toBe(200);
    clock.advance(1_000);
    const res = await postParse(app, { text: freeText(3) });
    expect(res.headers.get('retry-after')).toBe('8');
    await expectError(res, 429, 'rate_limited', rateLimited('1 minute'));
  });

  it('R7.1 the cap refuses at 23:59:59.500 UTC with Retry-After 1 and passes again at midnight', async () => {
    const { app, clock } = makeTestApp({
      modelClient: fakeModelClient([ok(SALAD_RAW), ok(SALAD_RAW)]),
      dailyCap: createDailyCap(1),
    });
    expect((await postParse(app, { text: freeText(1) })).status).toBe(200);
    clock.set(Date.UTC(2026, 10, 11, 23, 59, 59, 500));
    const refused = await postParse(app, { text: freeText(2) });
    expect(refused.headers.get('retry-after')).toBe('1');
    expect(refused.status).toBe(429);
    clock.set(Date.UTC(2026, 10, 12, 0, 0, 0, 0));
    expect((await postParse(app, { text: freeText(2) })).status).toBe(200);
  });
});

describe('R7.4 concurrent requests', () => {
  const slow = () =>
    new Promise<ReturnType<typeof ok>>((resolve) => setTimeout(() => resolve(ok(SALAD_RAW)), 20));

  it('R7.4 cap + 3 concurrent requests make exactly `cap` model calls', async () => {
    const cap = 3;
    const client = fakeModelClient(Array.from({ length: cap }, slow));
    const { app } = makeTestApp({
      modelClient: client,
      dailyCap: createDailyCap(cap),
      rateLimiter: createRateLimiter({ limit: 100, windowSec: 600 }),
    });
    const responses = await Promise.all(
      Array.from({ length: cap + 3 }, (_v, i) => postParse(app, { text: freeText(i) })),
    );
    expect(client.calls).toHaveLength(cap);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
  });

  it('R6.1 limit + 3 concurrent requests from one client make exactly `limit` model calls', async () => {
    const limit = 2;
    const client = fakeModelClient(Array.from({ length: limit }, slow));
    const { app } = makeTestApp({
      modelClient: client,
      rateLimiter: createRateLimiter({ limit, windowSec: 600 }),
    });
    const responses = await Promise.all(
      Array.from({ length: limit + 3 }, (_v, i) => postParse(app, { text: freeText(i) })),
    );
    expect(client.calls).toHaveLength(limit);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 429, 429, 429]);
  });
});

describe('R6.5 R6.6 TRUST_PROXY', () => {
  async function twoCalls(trustProxy: boolean, first: string, second: string): Promise<number[]> {
    const { app } = makeTestApp({
      trustProxy,
      modelClient: fakeModelClient([ok(SALAD_RAW), ok(SALAD_RAW)]),
      rateLimiter: createRateLimiter({ limit: 1, windowSec: 600 }),
    });
    const a = await postParse(
      app,
      { text: freeText(1) },
      { headers: { 'x-forwarded-for': first } },
    );
    const b = await postParse(
      app,
      { text: freeText(2) },
      { headers: { 'x-forwarded-for': second } },
    );
    return [a.status, b.status];
  }

  it('R6.5 with trust off the header is ignored: the same peer is limited whatever it sends', async () => {
    expect(await twoCalls(false, '198.51.100.1', '198.51.100.2')).toEqual([200, 429]);
  });

  it('R6.6 with trust on the rightmost entry is the client: a different one is not limited', async () => {
    expect(await twoCalls(true, '198.51.100.1', '198.51.100.2')).toEqual([200, 200]);
  });

  it('R6.6 with trust on the same rightmost entry is limited, whatever a client puts to its left', async () => {
    expect(await twoCalls(true, '198.51.100.1', '9.9.9.9, 198.51.100.1')).toEqual([200, 429]);
  });
});

describe('R10.3 a plan with sanity errors is still a 200', () => {
  it('R10.3 a cycle from the model comes back with the cycle issue', async () => {
    const raw = structuredClone(SALAD_RAW) as { steps: { id: string; after: string[] }[] };
    const wash = raw.steps.find((s) => s.id === 'salad.wash');
    if (wash) wash.after = ['salad.toss'];
    const { app } = makeTestApp({ modelClient: fakeModelClient([ok(raw)]) });
    const res = await postParse(app, { text: freeText() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      issues: { code: string; severity: string }[];
    };
    expect(body.source).toBe('model');
    expect(body.issues.filter((i) => i.severity === 'error').map((i) => i.code)).toContain('cycle');
  });
});

describe('R13 logs', () => {
  const infoLines = (logs: LogCall[]) => logs.filter((l) => l.level === 'info');

  it('R13.2 one info line per request: outcome, chars and ms from the injected clock, no address', async () => {
    const clock = fakeClock(TEST_START_MS);
    const client: ModelClient = {
      readRecipes: () => {
        clock.advance(1_234);
        return Promise.resolve(ok(SALAD_RAW));
      },
    };
    const { app, logs } = makeTestApp({ modelClient: client, clock });
    await postParse(app, { text: 'Boil an egg.  \n' }, { peer: '203.0.113.7' });
    expect(infoLines(logs)).toEqual([
      { level: 'info', msg: 'parse', fields: { outcome: 'model', chars: 12, ms: 1_234 } },
    ]);
    expect(JSON.stringify(logs)).not.toContain('203.0.113.7');
  });

  it('R13.2 a recorded sample logs outcome recording; an error logs its code; chars is null before normalising', async () => {
    const { app, logs } = makeTestApp();
    await postParse(app, { text: SALAD_TEXT });
    await postParse(app, { text: freeText() });
    await postParse(app, { text: freeText() }, { headers: { 'content-type': 'text/plain' } });
    expect(infoLines(logs).map((l) => l.fields)).toEqual([
      { outcome: 'recording', chars: 170, ms: 0 },
      { outcome: 'model_unavailable', chars: 29, ms: 0 },
      { outcome: 'bad_request', chars: null, ms: 0 },
    ]);
  });

  it('R13.1 recipe text appears in no line above debug; at debug the normalised text has its own line', async () => {
    const { app, logs } = makeTestApp({ modelClient: fakeModelClient([ok(SALAD_RAW)]) });
    await postParse(app, { text: '  RECIPE-MARKER-XYZ, 5 minutes.  ' });
    const above = logs.filter((l) => l.level !== 'debug');
    expect(JSON.stringify(above)).not.toContain('RECIPE-MARKER-XYZ');
    expect(logs.filter((l) => l.level === 'debug')).toEqual([
      { level: 'debug', msg: 'parse text', fields: { text: 'RECIPE-MARKER-XYZ, 5 minutes.' } },
    ]);
  });

  it('R13.1 model output that fails the schema is in no log line and no response; the warn line carries codes and fields only', async () => {
    const { app, logs } = makeTestApp({
      modelClient: fakeModelClient([ok({ title: 'MODEL-MARKER-TEXT' })]),
    });
    const res = await postParse(app, { text: freeText() });
    expect(JSON.stringify(logs)).not.toContain('MODEL-MARKER-TEXT');
    expect(await res.text()).not.toContain('MODEL-MARKER-TEXT');
    expect(logs.filter((l) => l.level === 'warn')).toEqual([
      {
        level: 'warn',
        msg: 'model output failed the schema',
        fields: {
          issues: [
            { code: 'invalid_field', field: 'dishes' },
            { code: 'invalid_field', field: 'steps' },
          ],
        },
      },
    ]);
  });

  it('review Q4 the not-a-recipe answer consumed one model call, one rate-limit slot and one cap slot, and logs invalid_plan', async () => {
    const limiter = createRateLimiter({ limit: 5, windowSec: 600 });
    const cap = createDailyCap(5);
    const { app, logs, clock } = makeTestApp({
      modelClient: fakeModelClient([ok(SENTINEL_RAW)]),
      rateLimiter: limiter,
      dailyCap: cap,
    });
    expect((await postParse(app, { text: 'Dear Sam, see you on Friday.' })).status).toBe(422);
    expect(limiter.size()).toEqual({ clients: 1, timestamps: 1 });
    expect(cap.usedToday(clock.nowMs())).toBe(1);
    expect(infoLines(logs).map((l) => (l.fields as { outcome: string }).outcome)).toEqual([
      'invalid_plan',
    ]);
  });

  it('R13.1 a thrown error logs outcome internal and is answered without its message', async () => {
    const { app, logs } = makeTestApp({
      modelClient: fakeModelClient([new Error('boom-secret-detail')]),
    });
    const res = await postParse(app, { text: freeText() });
    expect(res.status).toBe(500);
    expect(infoLines(logs).map((l) => (l.fields as { outcome: string }).outcome)).toEqual([
      'internal',
    ]);
  });
});
