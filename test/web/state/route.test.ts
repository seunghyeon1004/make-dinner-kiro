import { describe, expect, it } from 'vitest';
import { hashOf, parseHash } from '../../../src/web/state/route.js';

describe('parseHash (R9.3)', () => {
  it('an empty fragment is none', () => {
    expect(parseHash('')).toEqual({ kind: 'none' });
    expect(parseHash('#')).toEqual({ kind: 'none' });
    expect(parseHash('#/')).toEqual({ kind: 'none' });
  });
  it('the four routes', () => {
    for (const route of ['menu', 'steps', 'plan', 'cook'] as const) {
      expect(parseHash(`#/${route}`)).toEqual({ kind: 'route', route });
    }
  });
  it('anything else is unknown', () => {
    expect(parseHash('#/nope')).toEqual({ kind: 'unknown' });
    expect(parseHash('#/plan/')).toEqual({ kind: 'unknown' });
    expect(parseHash('plan')).toEqual({ kind: 'unknown' });
  });
  it('R8.5 a share fragment carries its version and payload', () => {
    expect(parseHash('#/share/1.abc_-XYZ09')).toEqual({
      kind: 'share',
      version: 1,
      payload: 'abc_-XYZ09',
    });
    expect(parseHash('#/share/12.a')).toEqual({ kind: 'share', version: 12, payload: 'a' });
  });
  it('R8.5 a share payload of 65,536 characters is accepted and 65,537 is unknown', () => {
    expect(parseHash(`#/share/1.${'a'.repeat(65_536)}`)).toEqual({
      kind: 'share',
      version: 1,
      payload: 'a'.repeat(65_536),
    });
    expect(parseHash(`#/share/1.${'a'.repeat(65_537)}`)).toEqual({ kind: 'unknown' });
  });
  it('R8.6 a share fragment with a bad character, no payload or a four-digit version is unknown', () => {
    expect(parseHash('#/share/1.ab*c')).toEqual({ kind: 'unknown' });
    expect(parseHash('#/share/1.')).toEqual({ kind: 'unknown' });
    expect(parseHash('#/share/1234.abc')).toEqual({ kind: 'unknown' });
    expect(parseHash('#/share/abc')).toEqual({ kind: 'unknown' });
  });
});

describe('hashOf', () => {
  it('is #/ plus the route', () => {
    expect(hashOf('plan')).toBe('#/plan');
    expect(hashOf('menu')).toBe('#/menu');
  });
});
