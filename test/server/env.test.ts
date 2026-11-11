import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/server/env.js';

describe('environment (tech.md, Environment variables)', () => {
  it('an empty environment gives the documented defaults and no key', () => {
    expect(loadEnv({})).toEqual({
      ok: true,
      value: {
        anthropicApiKey: undefined,
        port: 3000,
        parseRatePerIp: 5,
        parseRateWindowSec: 600,
        parseDailyCap: 200,
        parseTimeoutMs: 60_000,
        trustProxy: false,
        logLevel: 'info',
      },
    });
  });

  it('reads every variable', () => {
    expect(
      loadEnv({
        ANTHROPIC_API_KEY: 'test-key-value',
        PORT: '10000',
        PARSE_RATE_PER_IP: '2',
        PARSE_RATE_WINDOW_SEC: '60',
        PARSE_DAILY_CAP: '10',
        PARSE_TIMEOUT_MS: '15000',
        TRUST_PROXY: 'true',
        LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      ok: true,
      value: {
        anthropicApiKey: 'test-key-value',
        port: 10000,
        parseRatePerIp: 2,
        parseRateWindowSec: 60,
        parseDailyCap: 10,
        parseTimeoutMs: 15_000,
        trustProxy: true,
        logLevel: 'debug',
      },
    });
  });

  it('an empty value counts as unset (.env.example ships an empty key)', () => {
    expect(loadEnv({ ANTHROPIC_API_KEY: '', PORT: '', TRUST_PROXY: '', LOG_LEVEL: '' })).toEqual({
      ok: true,
      value: {
        anthropicApiKey: undefined,
        port: 3000,
        parseRatePerIp: 5,
        parseRateWindowSec: 600,
        parseDailyCap: 200,
        parseTimeoutMs: 60_000,
        trustProxy: false,
        logLevel: 'info',
      },
    });
  });

  const invalid: [string, string][] = [
    ['PORT', 'abc'],
    ['PORT', '0'],
    ['PORT', '70000'],
    ['PARSE_RATE_PER_IP', '-1'],
    ['PARSE_RATE_WINDOW_SEC', '1.5'],
    ['PARSE_DAILY_CAP', 'lots'],
    ['PARSE_TIMEOUT_MS', 'abc'],
    ['PARSE_TIMEOUT_MS', '999'],
    ['PARSE_TIMEOUT_MS', '600001'],
    ['PARSE_RATE_PER_IP', '101'],
    ['TRUST_PROXY', 'yes'],
    ['LOG_LEVEL', 'loud'],
  ];
  for (const [name, value] of invalid) {
    it(`${name}=${value} is rejected and the error names ${name}`, () => {
      const result = loadEnv({ [name]: value });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toHaveLength(1);
      expect(result.error[0]?.startsWith(`${name}:`)).toBe(true);
    });
  }

  it('R14.1 PARSE_TIMEOUT_MS accepts 1,000 and 600,000', () => {
    for (const value of ['1000', '600000']) {
      const result = loadEnv({ PARSE_TIMEOUT_MS: value });
      expect(result.ok && result.value.parseTimeoutMs).toBe(Number(value));
    }
  });

  it('R14.2 PARSE_RATE_PER_IP accepts 100', () => {
    const result = loadEnv({ PARSE_RATE_PER_IP: '100' });
    expect(result.ok && result.value.parseRatePerIp).toBe(100);
  });

  it('R14.1 a rejected PARSE_TIMEOUT_MS message names the variable and not the value', () => {
    const result = loadEnv({ PARSE_TIMEOUT_MS: '987654321' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toHaveLength(1);
    expect(result.error[0]?.startsWith('PARSE_TIMEOUT_MS:')).toBe(true);
    expect(JSON.stringify(result.error)).not.toContain('987654321');
  });

  it('error messages never contain the API key', () => {
    const result = loadEnv({ ANTHROPIC_API_KEY: 'test-key-value', PORT: 'abc' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).not.toContain('test-key-value');
  });
});
