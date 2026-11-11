import { z } from 'zod';
import { DishIdSchema, IssueSchema, KitchenSchema, PlanSchema, ServeTimeSchema } from './schema.js';

/** Longest recipe text the server reads, in Unicode code points, after normalising (R4.6). */
export const RECIPE_TEXT_MAX = 12_000;

/** The error codes of `tech.md`, "Error handling". */
export const API_ERROR_CODES = [
  'bad_request',
  'input_too_long',
  'invalid_plan',
  'rate_limited',
  'daily_cap_reached',
  'model_unavailable',
  'model_refused',
  'model_output_invalid',
  'not_found',
  'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Every failing response of `/api/*`: `{ "error": { "code", "message" } }`. */
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
});

/** One entry of `samples/index.json` (R1.2). */
export const SampleEntrySchema = z.strictObject({
  id: DishIdSchema,
  title: z.string().max(80).regex(/\S/),
  blurb: z
    .string()
    .max(160)
    .regex(/^[^\n]*\S[^\n]*$/),
  dishes: z.array(z.string().max(80).regex(/\S/)).min(1).max(12),
  kitchen: KitchenSchema,
  servingTime: ServeTimeSchema,
});

/** `samples/index.json`: the entries in display order. Shared by the server and the MCP server. */
export const SampleIndexSchema = z.array(SampleEntrySchema).min(1).max(12);

/** `recordings/<id>.json`: one recorded model parse, `raw` unchecked until `validatePlan`. */
export const RecordingSchema = z.strictObject({
  sampleId: DishIdSchema,
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string().max(100).regex(/\S/),
  recordedAt: z.iso.datetime(),
  raw: z.unknown(),
});

/** One item of `GET /api/samples` (R3.2). */
export const SampleItemSchema = SampleEntrySchema.extend({
  text: z.string(),
  plan: PlanSchema,
  issues: z.array(IssueSchema),
});

export const SamplesResponseSchema = z.strictObject({ samples: z.array(SampleItemSchema) });

/** The body of `POST /api/parse` (R4.3). */
export const ParseRequestSchema = z.strictObject({ text: z.string() });

/** The 200 body of `POST /api/parse` (R10.3). */
export const ParseResponseSchema = z.strictObject({
  plan: PlanSchema,
  issues: z.array(IssueSchema),
  source: z.enum(['recording', 'model']),
});

export type SampleEntry = z.infer<typeof SampleEntrySchema>;
export type Recording = z.infer<typeof RecordingSchema>;
export type SampleItem = z.infer<typeof SampleItemSchema>;
export type SamplesResponse = z.infer<typeof SamplesResponseSchema>;
export type ParseRequest = z.infer<typeof ParseRequestSchema>;
export type ParseResponse = z.infer<typeof ParseResponseSchema>;
