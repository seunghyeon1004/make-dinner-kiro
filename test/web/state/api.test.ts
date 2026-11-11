import { describe, expect, it } from 'vitest';
import { fetchSamples, postParse } from '../../../src/web/state/api.js';
import type { FetchLike } from '../../../src/web/state/api.js';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../../support/fixtures.js';

/** One item of `GET /api/samples`, written out field by field (core `SampleItemSchema`). */
function sampleItem(): Record<string, unknown> {
  return {
    id: 'sunday-roast',
    title: 'Sunday roast',
    blurb: 'Roast chicken with gravy and greens.',
    dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
    kitchen: HOME_KITCHEN,
    servingTime: '13:30',
    text: 'Sunday roast\n\nRoast chicken\nRoast it.',
    plan: SUNDAY_ROAST,
    issues: [],
  };
}

function respond(status: number, body: string): FetchLike {
  return () => Promise.resolve(new Response(body, { status }));
}

describe('fetchSamples (R1.1, R1.2)', () => {
  it('R1.1 asks GET /api/samples and returns the items in response order', async () => {
    const calls: string[] = [];
    const second = { ...sampleItem(), id: 'weeknight-curry', title: 'Weeknight curry' };
    const fetchFn: FetchLike = (url) => {
      calls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ samples: [sampleItem(), second] }), { status: 200 }),
      );
    };
    const result = await fetchSamples(fetchFn);
    expect(calls).toEqual(['/api/samples']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.title)).toEqual(['Sunday roast', 'Weeknight curry']);
    expect(result.value[0]?.plan.title).toBe('Sunday roast');
    expect(result.value[0]?.servingTime).toBe('13:30');
    expect(result.value[0]?.kitchen).toEqual({ burners: 4, ovens: 1, cooks: 1 });
  });

  it('R1.2 an extra field is dropped, not fatal', async () => {
    const withExtra = { ...sampleItem(), recordedAt: '2026-11-11' };
    const result = await fetchSamples(
      respond(200, JSON.stringify({ samples: [withExtra], note: 'x' })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value[0] ?? {}).sort()).toEqual(
      ['blurb', 'dishes', 'id', 'issues', 'kitchen', 'plan', 'servingTime', 'text', 'title'].sort(),
    );
  });

  it('R1.2 an item without a plan fails the schema: unexpected', async () => {
    const noPlan = Object.fromEntries(
      Object.entries(sampleItem()).filter(([key]) => key !== 'plan'),
    );
    const result = await fetchSamples(respond(200, JSON.stringify({ samples: [noPlan] })));
    expect(result).toEqual({ ok: false, error: 'unexpected' });
  });

  it('R1.2 an empty sample list fails the schema: unexpected', async () => {
    expect(await fetchSamples(respond(200, JSON.stringify({ samples: [] })))).toEqual({
      ok: false,
      error: 'unexpected',
    });
  });

  it('R1.2 bad JSON is unexpected', async () => {
    expect(await fetchSamples(respond(200, '<html>'))).toEqual({
      ok: false,
      error: 'unexpected',
    });
  });

  it('R1.2 a 500 is unexpected, even with a valid body', async () => {
    const body = JSON.stringify({ samples: [sampleItem()] });
    expect(await fetchSamples(respond(500, body))).toEqual({ ok: false, error: 'unexpected' });
  });

  it('R1.2 a thrown fetch is network', async () => {
    const fetchFn: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await fetchSamples(fetchFn)).toEqual({ ok: false, error: 'network' });
  });
});

/** A fake fetch that records the call and answers with a fixed response. */
function recording(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): { fetchFn: FetchLike; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(body, { status, headers }));
  };
  return { fetchFn, calls };
}

function errorBody(code: string): string {
  return JSON.stringify({ error: { code, message: 'plain English' } });
}

const NOW_MS = Date.parse('2026-11-11T17:00:00Z');
const signal = new AbortController().signal;

describe('postParse (R2.3, R2.5 to R2.7)', () => {
  it('R2.3 posts { text } as typed, as application/json, to /api/parse', async () => {
    const ok200 = JSON.stringify({ plan: SUNDAY_ROAST, issues: [], source: 'model' });
    const { fetchFn, calls } = recording(200, ok200);
    await postParse(fetchFn, '  Roast it.\r\n', signal, NOW_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/parse');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
    expect(calls[0]?.init?.body).toBe('{"text":"  Roast it.\\r\\n"}');
    expect(calls[0]?.init?.signal).toBe(signal);
  });

  it('R2.5 a 200 with a plan gives the plan', async () => {
    const body = JSON.stringify({ plan: SUNDAY_ROAST, issues: [], source: 'recording' });
    const result = await postParse(recording(200, body).fetchFn, 'x', signal, NOW_MS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Sunday roast');
    expect(result.value.steps).toHaveLength(SUNDAY_ROAST.steps.length);
  });

  it.each([
    'bad_request',
    'input_too_long',
    'model_unavailable',
    'model_refused',
    'model_output_invalid',
    'internal',
  ])('R2.6 code %s maps to its own failure kind', async (code) => {
    const result = await postParse(recording(502, errorBody(code)).fetchFn, 'x', signal, NOW_MS);
    expect(result).toEqual({ ok: false, error: { kind: code } });
  });

  it.each(['not_found', 'invalid_plan', 'something_new'])(
    'R2.7 code %s is unexpected with the status',
    async (code) => {
      const result = await postParse(recording(422, errorBody(code)).fetchFn, 'x', signal, NOW_MS);
      expect(result).toEqual({ ok: false, error: { kind: 'unexpected', status: 422 } });
    },
  );

  it('R2.6 rate_limited with Retry-After 120 gives now + 120 s', async () => {
    const { fetchFn } = recording(429, errorBody('rate_limited'), { 'Retry-After': '120' });
    const result = await postParse(fetchFn, 'x', signal, NOW_MS);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'rate_limited', retryAtMs: NOW_MS + 120_000 },
    });
  });

  it('R2.6 daily_cap_reached with Retry-After 0 gives now', async () => {
    const { fetchFn } = recording(429, errorBody('daily_cap_reached'), { 'Retry-After': '0' });
    const result = await postParse(fetchFn, 'x', signal, NOW_MS);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'daily_cap_reached', retryAtMs: NOW_MS },
    });
  });

  it('R2.6 a Retry-After that is not a whole number gives null', async () => {
    const { fetchFn } = recording(429, errorBody('rate_limited'), { 'Retry-After': 'abc' });
    const result = await postParse(fetchFn, 'x', signal, NOW_MS);
    expect(result).toEqual({ ok: false, error: { kind: 'rate_limited', retryAtMs: null } });
  });

  it('R2.6 a missing Retry-After gives null', async () => {
    const result = await postParse(
      recording(429, errorBody('rate_limited')).fetchFn,
      'x',
      signal,
      NOW_MS,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'rate_limited', retryAtMs: null } });
  });

  it('R2.7 a 200 that fails the schema is unexpected', async () => {
    const result = await postParse(
      recording(200, JSON.stringify({ plan: { title: 'x' } })).fetchFn,
      'x',
      signal,
      NOW_MS,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'unexpected', status: 200 } });
  });

  it('R2.7 a non-JSON error body is unexpected', async () => {
    const result = await postParse(recording(500, '<html>').fetchFn, 'x', signal, NOW_MS);
    expect(result).toEqual({ ok: false, error: { kind: 'unexpected', status: 500 } });
  });

  it('R2.7 a thrown fetch is network', async () => {
    const fetchFn: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await postParse(fetchFn, 'x', signal, NOW_MS)).toEqual({
      ok: false,
      error: { kind: 'network' },
    });
  });

  it('R2.4 an AbortError is cancelled', async () => {
    const fetchFn: FetchLike = () =>
      Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    expect(await postParse(fetchFn, 'x', signal, NOW_MS)).toEqual({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });
});
