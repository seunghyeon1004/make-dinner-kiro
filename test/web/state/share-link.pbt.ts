import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalPlan, hasErrors, validatePlan } from '../../../src/core/index.js';
import { decodeShare, encodeShare } from '../../../src/web/state/share-link.js';
import { arbPlanAndKitchen, arbServeTime } from '../../support/arbitraries.js';
import { fcParams } from '../../support/fc-params.js';

const KINDS = ['bad_format', 'unknown_version', 'too_large', 'invalid_plan'];
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Mostly small plans; now and then one that reaches the limits of 12 dishes and 80 steps. */
const arbPair = fc.oneof(
  { weight: 9, arbitrary: arbPlanAndKitchen() },
  { weight: 1, arbitrary: arbPlanAndKitchen({ large: true }) },
);

describe('share-link properties', () => {
  it('P-UI1 round trip: decodeShare(encodeShare(d)) is the canonical plan, kitchen and serving time', async () => {
    await fc.assert(
      fc.asyncProperty(arbPair, arbServeTime(), async ({ plan, kitchen }, serve) => {
        const encoded = await encodeShare({ plan, kitchen, serve });
        expect(encoded.ok).toBe(true);
        if (!encoded.ok) return;
        expect(encoded.value.startsWith('1.')).toBe(true);
        const decoded = await decodeShare(1, encoded.value.slice(2));
        expect(decoded).toEqual({
          ok: true,
          value: { plan: canonicalPlan(plan), kitchen, serve },
        });
      }),
      fcParams(),
    );
  });

  /** Total, and sound when it says yes: a plan that comes out has no error issue. */
  async function expectTotal(version: number, payload: string): Promise<void> {
    const result = await decodeShare(version, payload);
    if (result.ok) {
      const check = validatePlan(result.value.plan);
      expect(check.plan).not.toBeNull();
      expect(hasErrors(check.issues)).toBe(false);
    } else {
      expect(KINDS).toContain(result.error.kind);
    }
  }

  it('P-UI2 decode is total: any string, any version', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -2, max: 999 }),
        fc.string({ unit: 'binary' }),
        expectTotal,
      ),
      fcParams(),
    );
  });

  it('P-UI2 decode is total: strings of base64url characters (past the character check)', async () => {
    const arbText = fc
      .array(fc.constantFrom(...BASE64URL), { maxLength: 300 })
      .map((chars) => chars.join(''));
    await fc.assert(
      fc.asyncProperty(arbText, (text) => expectTotal(1, text)),
      fcParams(),
    );
  });

  it('P-UI2 decode is total: a real payload with one character replaced, removed or added', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPair,
        arbServeTime(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom(...BASE64URL, '*', ' ', '\u0000'),
        fc.constantFrom('replace', 'remove', 'insert'),
        async ({ plan, kitchen }, serve, where, char, how) => {
          const encoded = await encodeShare({ plan, kitchen, serve });
          if (!encoded.ok) throw new Error('the generator gave an invalid plan');
          const payload = encoded.value.slice(2);
          const at = Math.min(payload.length - 1, Math.floor(where * payload.length));
          const mutated =
            how === 'replace'
              ? payload.slice(0, at) + char + payload.slice(at + 1)
              : how === 'remove'
                ? payload.slice(0, at) + payload.slice(at + 1)
                : payload.slice(0, at) + char + payload.slice(at);
          await expectTotal(1, mutated);
        },
      ),
      fcParams(),
    );
  });
});
