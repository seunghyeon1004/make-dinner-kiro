import type { Result } from '../../src/core/index.js';
import type { LogFields, Logger, LogLevel } from '../../src/server/log.js';
import type { ModelClient, ModelError } from '../../src/server/parse/anthropic-client.js';
import type { Clock } from '../../src/server/parse/limits.js';

export interface LogCall {
  level: LogLevel;
  msg: string;
  fields: LogFields | undefined;
}

/** A logger that records what it was asked to log. Fakes a collaborator of the server. */
export function fakeLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const record =
    (level: LogLevel) =>
    (msg: string, fields?: LogFields): void => {
      calls.push({ level, msg, fields });
    };
  return {
    logger: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    },
    calls,
  };
}

// --- recipe-reader fakes (R15.2): the clock, the model client and the Anthropic endpoint ---

/** A clock the test moves by hand. Fakes the system clock, a collaborator of the server. */
export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function fakeClock(startMs: number): FakeClock {
  let now = startMs;
  return {
    nowMs: () => now,
    advance(ms) {
      now += ms;
    },
    set(ms) {
      now = ms;
    },
  };
}

type ModelReply = Result<unknown, ModelError> | Error | Promise<Result<unknown, ModelError>>;

/**
 * Answers `readRecipes` with the replies in order; an Error reply is thrown. A call past the
 * last reply throws, which fails the test. `calls` holds the texts it was given.
 */
export function fakeModelClient(replies: readonly ModelReply[]): ModelClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async readRecipes(text) {
      calls.push(text);
      const reply = replies[calls.length - 1];
      if (reply === undefined) {
        throw new Error(`fakeModelClient: no reply left for call ${calls.length}`);
      }
      if (reply instanceof Error) throw reply;
      return await reply;
    },
  };
}

export type FakeHttpReply =
  | { status: number; body: unknown; headers?: Record<string, string>; rawBody?: string }
  | { networkError: true }
  | { hang: true };

export interface FakeRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A `fetch` that answers the Anthropic SDK's requests from a script, so no test reaches the
 * network. Error statuses carry a `request-id` header and `retry-after-ms: 1`, so the SDK's
 * one retry does not wait.
 */
export function fakeAnthropicFetch(replies: readonly FakeHttpReply[]): {
  fetch: FetchFn;
  requests: FakeRequest[];
} {
  const requests: FakeRequest[] = [];
  const fetchFake: FetchFn = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    requests.push({ url, headers, body });
    const reply = replies[requests.length - 1];
    if (reply === undefined) {
      return Promise.reject(
        new Error(`fakeAnthropicFetch: no reply left for request ${requests.length}`),
      );
    }
    if ('networkError' in reply) return Promise.reject(new TypeError('fetch failed'));
    if ('hang' in reply) {
      return new Promise<Response>((_resolve, reject) => {
        const abort = (): void =>
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (init?.signal?.aborted === true) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      });
    }
    const responseHeaders: Record<string, string> = { 'content-type': 'application/json' };
    if (reply.status >= 400) {
      responseHeaders['request-id'] = 'req_test';
      responseHeaders['retry-after-ms'] = '1';
    }
    return Promise.resolve(
      new Response(reply.rawBody ?? JSON.stringify(reply.body), {
        status: reply.status,
        headers: { ...responseHeaders, ...reply.headers },
      }),
    );
  };
  return { fetch: fetchFake, requests };
}

/** A Messages API response body: id, type, role, model, content, stop_reason, stop_details, usage. */
export function anthropicMessage(
  content: unknown[],
  stopReason: string,
  stopDetails?: unknown,
): unknown {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: stopReason,
    stop_details: stopDetails ?? null,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}
