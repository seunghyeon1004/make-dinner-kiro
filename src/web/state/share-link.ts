import { z } from 'zod';
import {
  canonicalPlan,
  err,
  hasErrors,
  LIMITS,
  ok,
  parseKitchen,
  ServeTimeSchema,
  validatePlan,
} from '../../core/index.js';
import type { Appliance, Issue, Kitchen, Plan, Result, ServeTime } from '../../core/index.js';

export const SHARE_VERSION = 1;
/** RFC 9110 section 4.1 recommends supporting URIs of 8,000 octets. */
export const SHARE_URL_MAX = 8_000;
/** Accepted on load: payload characters, and inflated bytes (a deflate bomb stops here). */
export const SHARE_PAYLOAD_MAX = 65_536;
export const SHARE_INFLATED_MAX = 262_144;

export interface SharedDinner {
  plan: Plan;
  kitchen: Kitchen;
  serve: ServeTime;
}

export type ShareDecodeError =
  | { kind: 'bad_format' }
  | { kind: 'unknown_version'; version: number }
  | { kind: 'too_large' }
  | { kind: 'invalid_plan'; issues: Issue[] };

const APPLIANCES: readonly Appliance[] = ['burner', 'oven', 'none'];

/**
 * The version 1 body (plan-ui design, "Share link"), built from the canonical plan:
 * `[title, [[dishId, name]], [[stepId, dishIndex, title, minutes, appliance, handsOn,
 * [afterIndex], holdMin, detail?]], [burners, ovens, cooks], "HH:MM"]`.
 * Exported for tests; the plan must have no `after` entry without a step.
 */
export function shareBody(plan: Plan, kitchen: Kitchen, serve: ServeTime): unknown[] {
  const canonical = canonicalPlan(plan);
  const dishIndex = new Map(canonical.dishes.map((d, i) => [d.id, i]));
  const stepIndex = new Map(canonical.steps.map((s, i) => [s.id, i]));
  return [
    canonical.title,
    canonical.dishes.map((d) => [d.id, d.name]),
    canonical.steps.map((s) => {
      const row: unknown[] = [
        s.id,
        dishIndex.get(s.dish) ?? -1,
        s.title,
        s.minutes,
        APPLIANCES.indexOf(s.appliance),
        s.handsOn ? 1 : 0,
        s.after.map((id) => stepIndex.get(id) ?? -1),
        s.holdMin,
      ];
      if (s.detail !== undefined) row.push(s.detail);
      return row;
    }),
    [kitchen.burners, kitchen.ovens, kitchen.cooks],
    serve,
  ];
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function deflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return (await collect(stream, Number.POSITIVE_INFINITY)) ?? new Uint8Array();
}

/** Null when the bytes are not deflate or inflate past `limit`; `'large'` past the limit. */
async function inflate(
  bytes: Uint8Array<ArrayBuffer>,
  limit: number,
): Promise<Uint8Array | 'large' | null> {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return (await collect(stream, limit)) ?? 'large';
  } catch {
    return null;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** `"1.<base64url>"`, or `invalid_plan` when the plan has an error (no index for a missing step). */
export async function encodeShare(d: SharedDinner): Promise<Result<string, 'invalid_plan'>> {
  const check = validatePlan(d.plan);
  if (check.plan === null || hasErrors(check.issues)) return err('invalid_plan');
  const json = JSON.stringify(shareBody(check.plan, d.kitchen, d.serve));
  const compressed = await deflate(new TextEncoder().encode(json));
  return ok(`${SHARE_VERSION}.${toBase64Url(compressed)}`);
}

const StepRowSchema = z.tuple(
  [
    z.string(),
    z.int().min(0).max(LIMITS.dishesMax),
    z.string(),
    z.number(),
    z.union([z.literal(0), z.literal(1), z.literal(2)]),
    z.union([z.literal(0), z.literal(1)]),
    z.array(z.int().min(0)).max(LIMITS.afterMax),
    z.number().nullable(),
  ],
  z.string(),
);
const BodySchema = z.tuple([
  z.string(),
  z.array(z.tuple([z.string(), z.string()])).max(LIMITS.dishesMax),
  z.array(StepRowSchema).max(LIMITS.stepsMax),
  z.tuple([z.number(), z.number(), z.number()]),
  z.string(),
]);

/** Never throws or rejects: every failure is a `ShareDecodeError`. */
export async function decodeShare(
  version: number,
  payload: string,
): Promise<Result<SharedDinner, ShareDecodeError>> {
  const bad = err<ShareDecodeError>({ kind: 'bad_format' });
  if (version !== SHARE_VERSION) return err({ kind: 'unknown_version', version });
  if (payload.length > SHARE_PAYLOAD_MAX) return err({ kind: 'too_large' });
  const compressed = fromBase64Url(payload);
  if (compressed === null) return bad;
  const inflated = await inflate(compressed, SHARE_INFLATED_MAX);
  if (inflated === 'large') return err({ kind: 'too_large' });
  if (inflated === null) return bad;

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated));
  } catch {
    return bad;
  }
  const body = BodySchema.safeParse(json);
  if (!body.success) return bad;
  const [title, dishRows, stepRows, kitchenRow, serve] = body.data;

  const rawSteps = [];
  for (const [
    id,
    dishAt,
    stepTitle,
    minutes,
    appliance,
    handsOn,
    afterAt,
    holdMin,
    detail,
  ] of stepRows) {
    const dish = dishRows[dishAt];
    const after = afterAt.map((at) => stepRows[at]?.[0]);
    const appliancePicked = APPLIANCES[appliance];
    if (dish === undefined || after.includes(undefined) || appliancePicked === undefined)
      return bad;
    rawSteps.push({
      id,
      dish: dish[0],
      title: stepTitle,
      minutes,
      appliance: appliancePicked,
      handsOn: handsOn === 1,
      after: after as string[],
      holdMin,
      ...(detail === undefined ? {} : { detail }),
    });
  }
  const check = validatePlan({
    title,
    dishes: dishRows.map(([id, name]) => ({ id, name })),
    steps: rawSteps,
  });
  if (check.plan === null || hasErrors(check.issues)) {
    return err({ kind: 'invalid_plan', issues: check.issues });
  }
  const kitchen = parseKitchen({
    burners: kitchenRow[0],
    ovens: kitchenRow[1],
    cooks: kitchenRow[2],
  });
  const time = ServeTimeSchema.safeParse(serve);
  if (!kitchen.ok || !time.success) return bad;
  return ok({ plan: canonicalPlan(check.plan), kitchen: kitchen.value, serve: time.data });
}

/** `base` is origin plus pathname; the payload goes in the fragment, which browsers never send. */
export function shareUrl(base: string, encoded: string): string {
  return `${base}#/share/${encoded}`;
}
