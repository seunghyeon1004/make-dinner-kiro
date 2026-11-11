import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/server/log.js';

function capture(level: Parameters<typeof createLogger>[0]) {
  const lines: string[] = [];
  const logger = createLogger(level, (line) => lines.push(line));
  return { logger, lines };
}

describe('logger (tech.md: LOG_LEVEL, redaction)', () => {
  it('LOG_LEVEL=info drops debug and writes info, warn and error', () => {
    const { logger, lines } = capture('info');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map((l) => (JSON.parse(l) as { level: string }).level)).toEqual([
      'info',
      'warn',
      'error',
    ]);
  });

  it('LOG_LEVEL=error writes only errors', () => {
    const { logger, lines } = capture('error');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toEqual(['e']);
  });

  it('LOG_LEVEL=debug writes all four levels', () => {
    const { logger, lines } = capture('debug');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines).toHaveLength(4);
  });

  it('writes one JSON object per call with level, msg and the fields', () => {
    const { logger, lines } = capture('info');
    logger.info('listening', { port: 3000 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({ level: 'info', msg: 'listening', port: 3000 });
  });

  it('redacts fields named like key, token, secret or authorization, at any depth', () => {
    const { logger, lines } = capture('info');
    logger.info('request', {
      anthropicApiKey: 'sk-test-value-1',
      client_secret: 'secret-value-2',
      headers: { Authorization: 'Bearer bearer-value-3', accept: 'text/html' },
      list: [{ refreshToken: 'token-value-4', ok: 1 }],
      port: 3000,
    });
    const line = lines[0] ?? '';
    expect(JSON.parse(line)).toEqual({
      level: 'info',
      msg: 'request',
      anthropicApiKey: '[redacted]',
      client_secret: '[redacted]',
      headers: { Authorization: '[redacted]', accept: 'text/html' },
      list: [{ refreshToken: '[redacted]', ok: 1 }],
      port: 3000,
    });
    for (const secret of ['sk-test-value-1', 'secret-value-2', 'bearer-value-3', 'token-value-4']) {
      expect(line).not.toContain(secret);
    }
  });

  it('does not throw on circular fields', () => {
    const { logger, lines } = capture('info');
    const circular: Record<string, unknown> = { name: 'loop' };
    circular['self'] = circular;
    expect(() => logger.info('circular', circular)).not.toThrow();
    expect(lines).toHaveLength(1);
  });
});
