import { describe, expect, expectTypeOf, it } from 'vitest';
import { err, ok } from '../../src/core/index.js';
import type { Result } from '../../src/core/index.js';

describe('Result (tech.md, Error handling)', () => {
  it('ok(value) is { ok: true, value }', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('err(error) is { ok: false, error }', () => {
    expect(err({ kind: 'cycle', path: ['a.one', 'a.two'] })).toEqual({
      ok: false,
      error: { kind: 'cycle', path: ['a.one', 'a.two'] },
    });
  });

  it('ok and err results are told apart by the ok flag', () => {
    const results: Result<string, string>[] = [ok('fine'), err('broken')];
    expect(results.map((r) => r.ok)).toEqual([true, false]);
  });

  it('checking ok narrows the result to the value or the error', () => {
    const describeResult = (r: Result<number, string>): string => (r.ok ? `v${r.value}` : r.error);
    expect(describeResult(ok(7))).toBe('v7');
    expect(describeResult(err('bad'))).toBe('bad');
  });

  it('ok and err carry the narrowest types', () => {
    expectTypeOf(ok(1)).toEqualTypeOf<Result<number, never>>();
    expectTypeOf(err('x')).toEqualTypeOf<Result<never, string>>();
  });
});
