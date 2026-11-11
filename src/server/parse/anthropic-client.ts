import {
  Anthropic,
  AnthropicError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  InternalServerError,
  OverloadedError,
  PermissionDeniedError,
  RateLimitError,
  RequestTimeoutError,
} from '@anthropic-ai/sdk';
import type { ClientOptions } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { JSONOutputFormat, TextBlock } from '@anthropic-ai/sdk/resources/messages';
import { PlanSchema, err, ok } from '../../core/index.js';
import type { Result } from '../../core/index.js';
import type { Logger } from '../log.js';
import { buildUserMessage, SYSTEM_PROMPT } from './prompt.js';

export const MODEL_ID = 'claude-opus-5-5';
export const MAX_TOKENS = 16_000;
export const MAX_RETRIES = 1;

export type UnavailableReason =
  | 'timeout'
  | 'connection'
  | 'auth'
  | 'rate_limited'
  | 'overloaded'
  | 'server_error'
  | 'rejected'
  | 'sdk_error';

export type ModelError =
  | { kind: 'unavailable'; reason: UnavailableReason; status: number | null }
  | { kind: 'refused'; category: string | null }
  | { kind: 'output_invalid'; reason: 'max_tokens' | 'stop_reason' | 'text_blocks' | 'not_json' };

/** Turns recipe text into an untrusted JSON value or a typed error. Never validates the value. */
export interface ModelClient {
  readRecipes(text: string): Promise<Result<unknown, ModelError>>;
}

/**
 * The wire schema: the SDK's transform of `PlanSchema` into what structured outputs accept.
 * Only `{ type, schema }` of the helper's result is kept, so the helper's own `parse()` (which
 * throws errors that quote the model's text) is never used; `validatePlan` checks the output.
 */
export const PLAN_OUTPUT_FORMAT: JSONOutputFormat = (() => {
  const format = zodOutputFormat(PlanSchema);
  return { type: 'json_schema', schema: format.schema };
})();

export interface AnthropicModelClientOptions {
  apiKey: string;
  timeoutMs: number;
  logger: Logger;
  /** Tests pass a fake; production omits it. */
  fetch?: ClientOptions['fetch'];
}

interface Classified {
  error: ModelError;
  log: { level: 'warn' | 'error'; msg: string; fields: Record<string, unknown> };
}

/** Maps an SDK error, most specific class first. Anything else is `null`: not ours to handle. */
function classify(thrown: unknown): Classified | null {
  if (!(thrown instanceof AnthropicError)) return null;
  const status = thrown instanceof APIError ? (thrown.status ?? null) : null;
  const requestId = thrown instanceof APIError ? (thrown.requestID ?? null) : null;
  const failed = (reason: UnavailableReason): Classified => ({
    error: { kind: 'unavailable', reason, status },
    log: { level: 'warn', msg: 'model call failed', fields: { reason, status, requestId } },
  });

  if (thrown instanceof APIConnectionTimeoutError) return failed('timeout');
  if (thrown instanceof APIConnectionError) return failed('connection');
  if (thrown instanceof AuthenticationError || thrown instanceof PermissionDeniedError) {
    return {
      error: { kind: 'unavailable', reason: 'auth', status },
      log: { level: 'error', msg: 'model authentication failed', fields: { status, requestId } },
    };
  }
  if (thrown instanceof RateLimitError) return failed('rate_limited');
  if (thrown instanceof OverloadedError) return failed('overloaded');
  if (thrown instanceof InternalServerError) return failed('server_error');
  if (thrown instanceof RequestTimeoutError) return failed('timeout');
  if (thrown instanceof APIError) {
    return {
      error: { kind: 'unavailable', reason: 'rejected', status },
      log: { level: 'error', msg: 'model request rejected', fields: { status, requestId } },
    };
  }
  return failed('sdk_error');
}

/**
 * The real client: one Messages API request per call (R9.2). No log line carries the SDK
 * error's message, headers or body (they can quote the API's reply or carry the key), nor the
 * model's text.
 */
export function createAnthropicModelClient(options: AnthropicModelClientOptions): ModelClient {
  const { logger } = options;
  const sdk = new Anthropic({
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    maxRetries: MAX_RETRIES,
    logLevel: 'off',
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  return {
    async readRecipes(text) {
      let message;
      try {
        message = await sdk.messages.create({
          model: MODEL_ID,
          max_tokens: MAX_TOKENS,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: buildUserMessage(text) }],
          output_config: { effort: 'low', format: PLAN_OUTPUT_FORMAT },
        });
      } catch (thrown) {
        const classified = classify(thrown);
        if (classified === null) throw thrown;
        logger[classified.log.level](classified.log.msg, classified.log.fields);
        return err(classified.error);
      }

      // Decide on the stop reason before any content is read.
      if (message.stop_reason === 'refusal') {
        const category = message.stop_details?.category ?? null;
        logger.info('model refused', { category });
        return err({ kind: 'refused', category });
      }
      if (message.stop_reason !== 'end_turn') {
        logger.warn('model stopped early', {
          stopReason: message.stop_reason,
          outputTokens: message.usage.output_tokens,
        });
        return err({
          kind: 'output_invalid',
          reason: message.stop_reason === 'max_tokens' ? 'max_tokens' : 'stop_reason',
        });
      }

      const texts = message.content.filter((block): block is TextBlock => block.type === 'text');
      const only = texts[0];
      if (texts.length !== 1 || only === undefined) {
        logger.warn('model output was not usable', { reason: 'text_blocks' });
        return err({ kind: 'output_invalid', reason: 'text_blocks' });
      }
      try {
        return ok(JSON.parse(only.text) as unknown);
      } catch {
        // The parser's error quotes the text, so it is neither kept nor logged.
        logger.warn('model output was not usable', { reason: 'not_json' });
        return err({ kind: 'output_invalid', reason: 'not_json' });
      }
    },
  };
}
