import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { fakeLogger } from '../support/fakes.js';

function makeApp() {
  return createApp({ publicDir: '/nonexistent-public-dir', logger: fakeLogger().logger });
}

describe('GET /api/health (tech.md, Deploy: health check)', () => {
  it('returns 200 and exactly { status: "ok" }', async () => {
    const res = await makeApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers with a JSON content type', async () => {
    const res = await makeApp().request('/api/health');
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  });
});

describe('not_found (tech.md, Error handling)', () => {
  it('an unknown GET /api route returns 404 with { error: { code: "not_found" } }', async () => {
    const res = await makeApp().request('/api/no-such-route');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(Object.keys(body)).toEqual(['error']);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
    expect(body.error.message).not.toBe('');
  });

  it('an unknown POST /api route also returns 404 not_found', async () => {
    const res = await makeApp().request('/api/no-such-route', { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });
});
