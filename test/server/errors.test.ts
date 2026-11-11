import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { ApiError } from '../../src/server/errors.js';
import type { ApiErrorCode } from '../../src/server/errors.js';
import { fakeLogger } from '../support/fakes.js';

// The status for each code, copied from tech.md "Error handling".
const EXPECTED_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  input_too_long: 413,
  invalid_plan: 422,
  rate_limited: 429,
  daily_cap_reached: 429,
  model_unavailable: 503,
  model_refused: 502,
  model_output_invalid: 502,
  not_found: 404,
  internal: 500,
};

describe('error mapping (tech.md, Error handling)', () => {
  for (const [code, status] of Object.entries(EXPECTED_STATUS) as [ApiErrorCode, number][]) {
    it(`${code}: an ApiError thrown by a route becomes ${status} with { error: { code, message } }`, async () => {
      const { logger, calls } = fakeLogger();
      const app = createApp({ publicDir: '/nonexistent-public-dir', logger });
      app.get('/api/test-throw', () => {
        throw new ApiError(code, 'Something the cook can read.');
      });

      const res = await app.request('/api/test-throw');

      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({
        error: { code, message: 'Something the cook can read.' },
      });
      expect(calls.filter((c) => c.level === 'error')).toEqual([]);
    });
  }
});

describe('the single onError handler (tech.md, Error handling)', () => {
  it('an unexpected throw becomes 500 internal with a generic message and no stack or detail', async () => {
    const { logger } = fakeLogger();
    const app = createApp({ publicDir: '/nonexistent-public-dir', logger });
    app.get('/api/test-boom', () => {
      throw new Error('database password=hunter2 at /srv/app/db.ts:12');
    });

    const res = await app.request('/api/test-boom');
    const text = await res.text();

    expect(res.status).toBe(500);
    const body = JSON.parse(text) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('internal');
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('db.ts');
    expect(text).not.toContain('stack');
  });

  it('logs the unexpected error, with its stack, to the server log only', async () => {
    const { logger, calls } = fakeLogger();
    const app = createApp({ publicDir: '/nonexistent-public-dir', logger });
    app.get('/api/test-boom', () => {
      throw new Error('kaboom');
    });

    await app.request('/api/test-boom');

    const errorCalls = calls.filter((c) => c.level === 'error');
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]?.fields?.['error']).toBe('kaboom');
    expect(String(errorCalls[0]?.fields?.['stack'])).toContain('kaboom');
  });

  it('a thrown non-Error value is still turned into 500 internal', async () => {
    const { logger } = fakeLogger();
    const app = createApp({ publicDir: '/nonexistent-public-dir', logger });
    app.get('/api/test-boom', () => {
      throw 'a plain string';
    });

    const res = await app.request('/api/test-boom');

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'internal' } });
  });
});
