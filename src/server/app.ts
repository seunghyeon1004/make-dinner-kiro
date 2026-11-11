import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createErrorHandler, notFoundHandler } from './errors.js';
import type { Logger } from './log.js';
import { health } from './routes/health.js';

export interface AppDeps {
  /** Absolute path of the directory served as static files. */
  publicDir: string;
  logger: Logger;
}

/** No side effects at import time or on creation: nothing listens, nothing is read. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Hono hands only Error instances to onError. Wrap anything else so it is handled too.
  app.use('*', async (_c, next) => {
    try {
      await next();
    } catch (thrown) {
      throw thrown instanceof Error ? thrown : new Error(`Non-Error thrown: ${String(thrown)}`);
    }
  });

  app.route('/api/health', health);
  app.use('*', serveStatic({ root: deps.publicDir }));

  app.notFound(notFoundHandler);
  app.onError(createErrorHandler(deps.logger));
  return app;
}
