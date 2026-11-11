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
import type { Result } from '../../core/index.js';

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

/** Why a parse request gave no plan (T6 fills in `postParse`). */
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
