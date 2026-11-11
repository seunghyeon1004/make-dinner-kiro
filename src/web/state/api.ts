import { z } from 'zod';
import {
  DishIdSchema,
  err,
  IssueSchema,
  KitchenSchema,
  ok,
  PlanSchema,
  ServeTimeSchema,
} from '../../core/index.js';
import type { Plan, Result } from '../../core/index.js';

/*
 * Response schemas of the two endpoints the browser uses (plan-ui design, "API").
 * `z.object`, not `z.strictObject`: a field the server adds later is dropped, not fatal.
 */
export const SampleItemSchema = z.object({
  id: DishIdSchema,
  title: z.string().min(1).max(80),
  blurb: z.string().min(1).max(160),
  dishes: z.array(z.string().min(1).max(80)).min(1).max(12),
  kitchen: KitchenSchema,
  servingTime: ServeTimeSchema,
  text: z.string(),
  plan: PlanSchema,
  issues: z.array(IssueSchema),
});
export const SamplesResponseSchema = z.object({
  samples: z.array(SampleItemSchema).min(1).max(12),
});

export type SampleItem = z.infer<typeof SampleItemSchema>;

export const ParseResponseSchema = z.object({
  plan: PlanSchema,
  issues: z.array(IssueSchema),
  source: z.enum(['recording', 'model']),
});
export const ApiErrorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** Why a parse request gave no plan. */
export type ParseFailure =
  | {
      kind:
        | 'bad_request'
        | 'input_too_long'
        | 'model_unavailable'
        | 'model_refused'
        | 'model_output_invalid'
        | 'internal'
        | 'network';
    }
  | { kind: 'rate_limited' | 'daily_cap_reached'; retryAtMs: number | null }
  | { kind: 'unexpected'; status: number };

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** `GET /api/samples`, checked against `SamplesResponseSchema`. Never throws. */
export async function fetchSamples(
  fetchFn: FetchLike,
): Promise<Result<SampleItem[], 'network' | 'unexpected'>> {
  let response: Response;
  try {
    response = await fetchFn('/api/samples');
  } catch {
    return err('network');
  }
  if (!response.ok) return err('unexpected');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err('unexpected');
  }
  const parsed = SamplesResponseSchema.safeParse(body);
  return parsed.success ? ok(parsed.data.samples) : err('unexpected');
}

export type ParseOutcome = Result<Plan, ParseFailure> | { ok: false; error: { kind: 'cancelled' } };

const DIRECT_CODES: ReadonlySet<string> = new Set([
  'bad_request',
  'input_too_long',
  'model_unavailable',
  'model_refused',
  'model_output_invalid',
  'internal',
]);

/** `Retry-After` as whole seconds >= 0 becomes an instant; anything else is null. */
function retryAt(header: string | null, nowMs: number): number | null {
  if (header === null || !/^[0-9]{1,9}$/.test(header.trim())) return null;
  return nowMs + Number(header.trim()) * 1000;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * `POST /api/parse` (R2.3). The text goes as typed; the server normalises it. Never throws.
 * A non-2xx body is mapped by its `code` (tech.md); the response's `issues` are not used.
 */
export async function postParse(
  fetchFn: FetchLike,
  text: string,
  signal: AbortSignal,
  nowMs: number,
): Promise<ParseOutcome> {
  let response: Response;
  try {
    response = await fetchFn('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (error) {
    return isAbort(error) ? { ok: false, error: { kind: 'cancelled' } } : err({ kind: 'network' });
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (isAbort(error)) return { ok: false, error: { kind: 'cancelled' } };
    return err({ kind: 'unexpected', status: response.status });
  }
  if (response.ok) {
    const parsed = ParseResponseSchema.safeParse(body);
    return parsed.success
      ? ok(parsed.data.plan)
      : err({ kind: 'unexpected', status: response.status });
  }
  const failure = ApiErrorBodySchema.safeParse(body);
  const unexpected = err({ kind: 'unexpected', status: response.status } as const);
  if (!failure.success) return unexpected;
  const code = failure.data.error.code;
  if (code === 'rate_limited' || code === 'daily_cap_reached') {
    return err({ kind: code, retryAtMs: retryAt(response.headers.get('Retry-After'), nowMs) });
  }
  if (DIRECT_CODES.has(code)) {
    return err({ kind: code } as ParseFailure);
  }
  return unexpected;
}
