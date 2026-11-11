import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  normaliseRecipeText,
  ParseRequestSchema,
  RECIPE_TEXT_MAX,
  validatePlan,
} from '../../core/index.js';
import type { Issue, ParseResponse } from '../../core/index.js';
import { errorResponse } from '../errors.js';
import type { ApiErrorCode } from '../errors.js';
import type { Logger } from '../log.js';
import type { ModelClient } from '../parse/anthropic-client.js';
import { BODY_MAX_BYTES, clientKey, countChars } from '../parse/limits.js';
import type { Clock, DailyCap, RateLimiter } from '../parse/limits.js';
import { isNotARecipe } from '../parse/prompt.js';
import type { SampleLibrary } from '../parse/recordings.js';

export interface ParseRouteDeps {
  library: SampleLibrary;
  /** Null when ANTHROPIC_API_KEY is unset. */
  modelClient: ModelClient | null;
  clock: Clock;
  rateLimiter: RateLimiter;
  dailyCap: DailyCap;
  trustProxy: boolean;
  logger: Logger;
}

export type { ParseResponse };

// Messages are fixed words and numbers only: no recipe text, model output, SDK text or key (R10.5).
const MESSAGES = {
  json: 'Send the recipes as JSON in the form { "text": "..." }.',
  empty: 'Paste at least one recipe.',
  bodyTooLarge: `The request is too large. Paste at most ${RECIPE_TEXT_MAX.toLocaleString('en-US')} characters of recipes.`,
  noKey:
    'This server has no recipe reader set up. The sample dinners and Dinnerfile import still work.',
  unavailable:
    'The recipe reader is not available right now. Try again in a few minutes. The sample dinners and Dinnerfile import still work.',
  refused:
    'The recipe reader declined to read this text. Check that it is a recipe, or try a sample dinner.',
  outputInvalid:
    'The recipe reader returned steps this app cannot use. Try again, or paste fewer dishes at a time.',
  dailyCap:
    'The recipe reader has reached its limit for today. It starts again at midnight UTC. The sample dinners and Dinnerfile import still work.',
  notARecipe: 'That does not look like a recipe. Paste the ingredients and method for each dish.',
} as const;

const tooLong = (chars: number): string =>
  `The recipes are ${chars.toLocaleString('en-US')} characters long and the limit is ${RECIPE_TEXT_MAX.toLocaleString('en-US')}. Paste fewer dishes at a time.`;

const rateLimited = (retryAfterSec: number): string => {
  const minutes = Math.ceil(retryAfterSec / 60);
  const wait = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  return `Too many recipe reads from your address. Try again in ${wait}. The sample dinners and Dinnerfile import still work.`;
};

const JSON_CONTENT_TYPE = /^\s*application\/json\s*(;.*)?$/i;

/** Where in the plan an issue points, for a log line: codes and paths only, never values. */
function issueFields(issue: Issue): Record<string, string> {
  const fields: Record<string, string> = { code: issue.code };
  if ('field' in issue) fields.field = issue.field;
  if ('stepId' in issue && issue.stepId !== undefined) fields.stepId = issue.stepId;
  if ('dishId' in issue && issue.dishId !== undefined) fields.dishId = issue.dishId;
  return fields;
}

/** The TCP peer, or undefined where there is no socket (as under `app.request()` without an env). */
function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

/**
 * `POST /api/parse` (R4 to R10), in the order of the design table. Everything from the rate
 * limit check to the end of the limit bookkeeping has no `await`, so a check and the matching
 * record happen in one turn of the event loop and concurrent requests cannot share a slot (R7.4).
 */
export function createParseRoute(deps: ParseRouteDeps): Hono<{ Variables: { startMs: number } }> {
  const { library, clock, rateLimiter, dailyCap, logger } = deps;
  const route = new Hono<{ Variables: { startMs: number } }>();

  const finish = (c: Context, outcome: string, chars: number | null): void => {
    logger.info('parse', { outcome, chars, ms: clock.nowMs() - (c.get('startMs') as number) });
  };

  const fail = (
    c: Context,
    code: ApiErrorCode,
    message: string,
    chars: number | null,
    retryAfterSec?: number,
  ): Response => {
    if (retryAfterSec !== undefined) c.header('Retry-After', String(retryAfterSec));
    finish(c, code, chars);
    return errorResponse(c, code, message);
  };

  route.use('*', async (c, next) => {
    c.set('startMs', clock.nowMs());
    await next();
  });

  route.post(
    '/',
    async (c, next) => {
      if (!JSON_CONTENT_TYPE.test(c.req.header('content-type') ?? '')) {
        return fail(c, 'bad_request', MESSAGES.json, null);
      }
      await next();
      return undefined;
    },
    bodyLimit({
      maxSize: BODY_MAX_BYTES,
      onError: (c) => fail(c, 'input_too_long', MESSAGES.bodyTooLarge, null),
    }),
    async (c) => {
      let body: unknown;
      try {
        body = JSON.parse(await c.req.text());
      } catch {
        return fail(c, 'bad_request', MESSAGES.json, null);
      }
      const request = ParseRequestSchema.safeParse(body);
      if (!request.success) return fail(c, 'bad_request', MESSAGES.json, null);

      const text = normaliseRecipeText(request.data.text);
      if (text === '') return fail(c, 'bad_request', MESSAGES.empty, 0);
      const chars = countChars(text);
      logger.debug('parse text', { text });
      if (chars > RECIPE_TEXT_MAX) return fail(c, 'input_too_long', tooLong(chars), chars);

      const sample = library.findByText(text);
      if (sample !== undefined) {
        finish(c, 'recording', chars);
        return c.json({
          plan: sample.plan,
          issues: sample.issues,
          source: 'recording',
        } satisfies ParseResponse);
      }

      const key = clientKey({
        forwardedFor: c.req.header('x-forwarded-for'),
        peerAddress: peerAddress(c),
        trustProxy: deps.trustProxy,
      });
      const now = clock.nowMs();
      const rate = rateLimiter.check(key, now);
      if (!rate.ok) {
        return fail(c, 'rate_limited', rateLimited(rate.retryAfterSec), chars, rate.retryAfterSec);
      }
      const cap = dailyCap.check(now);
      if (!cap.ok) {
        return fail(c, 'daily_cap_reached', MESSAGES.dailyCap, chars, cap.retryAfterSec);
      }
      const client = deps.modelClient;
      if (client === null) return fail(c, 'model_unavailable', MESSAGES.noKey, chars);
      rateLimiter.record(key, now);
      dailyCap.record(now);

      let read;
      try {
        read = await client.readRecipes(text);
      } catch (thrown) {
        finish(c, 'internal', chars);
        throw thrown;
      }
      if (!read.ok) {
        switch (read.error.kind) {
          case 'unavailable':
            return fail(c, 'model_unavailable', MESSAGES.unavailable, chars);
          case 'refused':
            return fail(c, 'model_refused', MESSAGES.refused, chars);
          case 'output_invalid':
            return fail(c, 'model_output_invalid', MESSAGES.outputInvalid, chars);
        }
      }

      const check = validatePlan(read.value);
      if (check.plan === null) {
        logger.warn('model output failed the schema', { issues: check.issues.map(issueFields) });
        return fail(c, 'model_output_invalid', MESSAGES.outputInvalid, chars);
      }
      // The model's answer for text that holds no recipe (review, Q4): never returned as a plan.
      if (isNotARecipe(check.plan)) return fail(c, 'invalid_plan', MESSAGES.notARecipe, chars);

      finish(c, 'model', chars);
      return c.json({
        plan: check.plan,
        issues: check.issues,
        source: 'model',
      } satisfies ParseResponse);
    },
  );

  return route;
}
