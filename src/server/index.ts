import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { createLogger } from './log.js';
import { createAnthropicModelClient } from './parse/anthropic-client.js';
import { createDailyCap, createRateLimiter, systemClock } from './parse/limits.js';
import { formatStartupFailure, loadSampleLibrary } from './parse/recordings.js';

const env = loadEnv(process.env);
if (!env.ok) {
  console.error(`Invalid environment:\n${env.error.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

const logger = createLogger(env.value.logLevel, (line) => process.stdout.write(`${line}\n`));
// These resolve to <repo>/public, <repo>/samples and <repo>/recordings both from src/server
// (tsx) and dist/server (node).
const publicDir = fileURLToPath(new URL('../../public', import.meta.url));
const samplesDir = fileURLToPath(new URL('../../samples', import.meta.url));
const recordingsDir = fileURLToPath(new URL('../../recordings', import.meta.url));

// Refuse to start when a sample has no current recording (R2.3, R2.6).
const library = loadSampleLibrary({ samplesDir, recordingsDir });
if (!library.ok) {
  console.error(formatStartupFailure(library.error));
  process.exit(1);
}

// The only place besides scripts/record.ts that builds the real model client (R9.1).
const apiKey = env.value.anthropicApiKey;
const modelClient =
  apiKey === undefined
    ? null
    : createAnthropicModelClient({ apiKey, timeoutMs: env.value.parseTimeoutMs, logger });

const app = createApp({
  publicDir,
  logger,
  library: library.value,
  parse: {
    modelClient,
    clock: systemClock,
    rateLimiter: createRateLimiter({
      limit: env.value.parseRatePerIp,
      windowSec: env.value.parseRateWindowSec,
    }),
    dailyCap: createDailyCap(env.value.parseDailyCap),
    trustProxy: env.value.trustProxy,
  },
});

const server = serve({ fetch: app.fetch, port: env.value.port }, (info) => {
  logger.info('listening', {
    port: info.port,
    modelEnabled: modelClient !== null,
    samples: library.value.samples.length,
  });
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
