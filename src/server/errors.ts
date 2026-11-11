import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiErrorCode } from '../core/index.js';
import type { Logger } from './log.js';

export type { ApiErrorCode };

const STATUS = {
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
} as const satisfies Record<ApiErrorCode, ContentfulStatusCode>;

const INTERNAL_MESSAGE = 'Something went wrong on our side. Try again in a moment.';
const NOT_FOUND_MESSAGE = 'There is nothing at this address.';

/** Thrown by routes. `message` is plain English the UI can show as is. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export function errorResponse(c: Context, code: ApiErrorCode, message: string): Response {
  return c.json({ error: { code, message } }, STATUS[code]);
}

/** The one `onError` handler. Stack traces go to the log, never to the response. */
export function createErrorHandler(logger: Logger): ErrorHandler {
  return (error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    logger.error('unhandled error', { error: error.message, stack: error.stack });
    return errorResponse(c, 'internal', INTERNAL_MESSAGE);
  };
}

export const notFoundHandler: NotFoundHandler = (c) =>
  errorResponse(c, 'not_found', NOT_FOUND_MESSAGE);
