export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const SENSITIVE_NAME = /key|token|secret|authorization/i;
const REDACTED = '[redacted]';
const MAX_DEPTH = 6;

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        SENSITIVE_NAME.test(name) ? REDACTED : redact(item, depth + 1),
      ]),
    );
  }
  return value;
}

function formatLine(level: LogLevel, msg: string, fields: LogFields | undefined): string {
  try {
    const redacted = fields === undefined ? {} : (redact(fields, 0) as LogFields);
    return JSON.stringify({ ...redacted, level, msg });
  } catch {
    return JSON.stringify({ level, msg, fields: '[unserializable]' });
  }
}

/** One JSON object per line. Fields named like key, token, secret or authorization are redacted. */
export function createLogger(minLevel: LogLevel, write: (line: string) => void): Logger {
  const at =
    (level: LogLevel) =>
    (msg: string, fields?: LogFields): void => {
      if (RANK[level] >= RANK[minLevel]) write(formatLine(level, msg, fields));
    };
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
