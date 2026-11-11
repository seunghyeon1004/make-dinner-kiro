import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { createApp } from '../../src/server/app.js';
import type { ModelClient } from '../../src/server/parse/anthropic-client.js';
import { createDailyCap, createRateLimiter } from '../../src/server/parse/limits.js';
import type { DailyCap, RateLimiter } from '../../src/server/parse/limits.js';
import { loadSampleLibrary } from '../../src/server/parse/recordings.js';
import type { LibraryPaths, SampleLibrary } from '../../src/server/parse/recordings.js';
import { fakeClock, fakeLogger } from './fakes.js';
import type { FakeClock, LogCall } from './fakes.js';

const FIXTURE_DIR = new URL('../fixtures/not-a-recording/', import.meta.url);

/** The hand-made sample directories (test/fixtures/not-a-recording/). */
export const FIXTURE_PATHS: LibraryPaths = {
  samplesDir: fileURLToPath(new URL('samples', FIXTURE_DIR)),
  recordingsDir: fileURLToPath(new URL('recordings', FIXTURE_DIR)),
};

/** The library of the hand-made fixture; throws if the fixture is broken. */
export function fixtureLibrary(): SampleLibrary {
  const result = loadSampleLibrary(FIXTURE_PATHS);
  if (!result.ok) throw new Error(`The fixture library is broken:\n${result.error.join('\n')}`);
  return result.value;
}

/** 2026-11-11 12:00:00 UTC. */
export const TEST_START_MS = Date.UTC(2026, 10, 11, 12, 0, 0);

export interface TestAppOptions {
  modelClient?: ModelClient | null;
  clock?: FakeClock;
  rateLimiter?: RateLimiter;
  dailyCap?: DailyCap;
  trustProxy?: boolean;
  library?: SampleLibrary;
  publicDir?: string;
}

/** The app with fakes at every boundary: no key, a fake clock, in-memory limits, no socket. */
export function makeTestApp(options: TestAppOptions = {}): {
  app: Hono;
  clock: FakeClock;
  rateLimiter: RateLimiter;
  dailyCap: DailyCap;
  logs: LogCall[];
} {
  const clock = options.clock ?? fakeClock(TEST_START_MS);
  const rateLimiter = options.rateLimiter ?? createRateLimiter({ limit: 5, windowSec: 600 });
  const dailyCap = options.dailyCap ?? createDailyCap(200);
  const { logger, calls } = fakeLogger();
  const app = createApp({
    publicDir: options.publicDir ?? '/nonexistent-public-dir',
    logger,
    library: options.library ?? fixtureLibrary(),
    parse: {
      modelClient: options.modelClient ?? null,
      clock,
      rateLimiter,
      dailyCap,
      trustProxy: options.trustProxy ?? false,
    },
  });
  return { app, clock, rateLimiter, dailyCap, logs: calls };
}

/** The `env` argument of `app.request()` that makes the TCP peer address `address`. */
export function peer(address: string): { incoming: { socket: { remoteAddress: string } } } {
  return { incoming: { socket: { remoteAddress: address } } };
}

export interface PostParseOptions {
  peer?: string;
  headers?: Record<string, string>;
  /** Sent as the body instead of `JSON.stringify(body)`. */
  rawBody?: string;
}

/** `POST /api/parse` as JSON from peer 203.0.113.7 unless told otherwise. */
export function postParse(
  app: Hono,
  body: unknown,
  options: PostParseOptions = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(
      '/api/parse',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: options.rawBody ?? JSON.stringify(body),
      },
      peer(options.peer ?? '203.0.113.7'),
    ),
  );
}
