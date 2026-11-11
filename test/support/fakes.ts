import type { LogFields, Logger, LogLevel } from '../../src/server/log.js';

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
