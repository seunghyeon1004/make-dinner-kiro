import { z } from 'zod';
import { err, ok } from '../core/index.js';
import type { Result } from '../core/index.js';
import { LOG_LEVELS } from './log.js';

const positiveInt = z.coerce.number().int().positive();

const EnvSchema = z
  .object({
    ANTHROPIC_API_KEY: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    PARSE_RATE_PER_IP: positiveInt.default(5),
    PARSE_RATE_WINDOW_SEC: positiveInt.default(600),
    PARSE_DAILY_CAP: positiveInt.default(200),
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  })
  .transform((raw) => ({
    anthropicApiKey: raw.ANTHROPIC_API_KEY,
    port: raw.PORT,
    parseRatePerIp: raw.PARSE_RATE_PER_IP,
    parseRateWindowSec: raw.PARSE_RATE_WINDOW_SEC,
    parseDailyCap: raw.PARSE_DAILY_CAP,
    trustProxy: raw.TRUST_PROXY,
    logLevel: raw.LOG_LEVEL,
  }));

export type Env = z.output<typeof EnvSchema>;

/**
 * Validates the environment once, at startup. An empty value counts as unset, so a
 * copied `.env.example` (empty key) means "samples and import only". Error messages name
 * the variable and the rule, never the value.
 */
export function loadEnv(source: Record<string, string | undefined>): Result<Env, string[]> {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const parsed = EnvSchema.safeParse(present);
  if (parsed.success) return ok(parsed.data);
  return err(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
}
