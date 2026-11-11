import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normaliseRecipeText } from '../../src/core/normalise.js';
import { arbRecipeText } from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';
import { oracleNormalise } from '../support/oracles.js';

describe('P-RG7 normalise', () => {
  it('P-RG7 normalise: equals the oracle, is idempotent, and has the normal form of R9.1', () => {
    fc.assert(
      fc.property(arbRecipeText(), (text) => {
        const out = normaliseRecipeText(text);
        expect(out).toBe(oracleNormalise(text));
        expect(normaliseRecipeText(out)).toBe(out);
        expect(out.includes('\r')).toBe(false);
        for (const line of out.split('\n')) expect(/\s$/.test(line)).toBe(false);
        expect(out.includes('\n\n\n')).toBe(false);
        expect(/^\s|\s$/.test(out)).toBe(false);
        expect(out.normalize('NFC')).toBe(out);
      }),
      fcParams(),
    );
  });
});
