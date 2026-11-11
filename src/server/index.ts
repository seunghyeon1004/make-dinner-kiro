import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadEnv } from './env.js';
import { createLogger } from './log.js';

const env = loadEnv(process.env);
if (!env.ok) {
  console.error(`Invalid environment:\n${env.error.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

const logger = createLogger(env.value.logLevel, (line) => process.stdout.write(`${line}\n`));
// Resolves to <repo>/public both from src/server (tsx) and dist/server (node).
const publicDir = fileURLToPath(new URL('../../public', import.meta.url));
const app = createApp({ publicDir, logger });

const server = serve({ fetch: app.fetch, port: env.value.port }, (info) => {
  logger.info('listening', {
    port: info.port,
    modelEnabled: env.value.anthropicApiKey !== undefined,
  });
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
