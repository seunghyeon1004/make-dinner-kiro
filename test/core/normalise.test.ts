import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseRecipeText } from '../../src/core/normalise.js';

describe('normaliseRecipeText, one rule at a time (R9.1)', () => {
  it('R9.1 applies Unicode NFC: e plus a combining acute becomes é', () => {
    expect(normaliseRecipeText('Cafe\u0301 au lait')).toBe('Caf\u00e9 au lait');
  });
  it('R9.1 turns CRLF into LF', () => {
    expect(normaliseRecipeText('Chop\r\nStir')).toBe('Chop\nStir');
  });
  it('R9.1 turns a lone CR into LF', () => {
    expect(normaliseRecipeText('Chop\rStir')).toBe('Chop\nStir');
  });
  it('R9.1 removes trailing spaces and tabs from every line', () => {
    expect(normaliseRecipeText('Chop \t\nStir\t\t\nServe  ')).toBe('Chop\nStir\nServe');
  });
  it('R9.1 collapses three blank lines into one', () => {
    expect(normaliseRecipeText('Chop\n\n\n\nStir')).toBe('Chop\n\nStir');
  });
  it('R9.1 counts a line of only spaces and tabs as blank', () => {
    expect(normaliseRecipeText('Chop\n  \n\t\n\nStir')).toBe('Chop\n\nStir');
  });
  it('R9.1 trims the whole text at both ends', () => {
    expect(normaliseRecipeText('\n\n  Chop\nStir\n\n \n')).toBe('Chop\nStir');
  });
  it('R9.1 keeps the indentation of lines after the first', () => {
    expect(normaliseRecipeText('Method\n  1. Chop\n\t2. Stir')).toBe(
      'Method\n  1. Chop\n\t2. Stir',
    );
  });
});

describe('the samples normalise (R9.1, R9.2)', () => {
  const dir = join(import.meta.dirname, '../../samples');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));

  it('there are sample files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });
  it.each(files)('R9.2 %s normalises to non-empty text and is idempotent', (file) => {
    const once = normaliseRecipeText(readFileSync(join(dir, file), 'utf8'));
    expect(once.length).toBeGreaterThan(0);
    expect(normaliseRecipeText(once)).toBe(once);
  });
});
