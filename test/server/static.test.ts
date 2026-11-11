import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { makeTestApp } from '../support/server.js';

const INDEX_HTML = '<!doctype html><title>shell</title>';
const ASSET_JS = 'console.log("asset");';
const OUTSIDE_TEXT = 'outside the public directory';

let root = '';
let app: Hono;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'make-dinner-static-'));
  const publicDir = join(root, 'public');
  mkdirSync(join(publicDir, 'assets'), { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), INDEX_HTML);
  writeFileSync(join(publicDir, 'assets', 'main.js'), ASSET_JS);
  writeFileSync(join(root, 'outside.txt'), OUTSIDE_TEXT);
  app = makeTestApp({ publicDir }).app;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('static serving of public/ (tech.md, Stack: Server)', () => {
  it('GET / serves public/index.html as HTML', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await res.text()).toBe(INDEX_HTML);
  });

  it('GET /assets/main.js serves the file as JavaScript', async () => {
    const res = await app.request('/assets/main.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    expect(await res.text()).toBe(ASSET_JS);
  });

  it('a missing file returns 404 not_found as JSON', async () => {
    const res = await app.request('/assets/missing.js');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
  });

  it('files outside public/ are not served, including via encoded dot segments', async () => {
    for (const path of ['/outside.txt', '/../outside.txt', '/%2e%2e/outside.txt']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain(OUTSIDE_TEXT);
    }
  });

  it('/api/health is answered by the route, not by the static handler', async () => {
    const res = await app.request('/api/health');
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
