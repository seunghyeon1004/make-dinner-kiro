import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildSampleTexts,
  readLibrarySource,
  SampleIndexSchema,
} from '../../../src/server/parse/recordings.js';

const SAMPLES_DIR = fileURLToPath(new URL('../../../samples', import.meta.url));
const RECORDINGS_DIR = fileURLToPath(new URL('../../../recordings', import.meta.url));

// R1.3: exactly these five, in the menu order of the design.
const FIVE = [
  'sunday-roast',
  'halloween-party',
  'weeknight-curry',
  'vegetarian-feast',
  'korean-table',
];

function readIndex(): unknown {
  return JSON.parse(readFileSync(`${SAMPLES_DIR}/index.json`, 'utf8'));
}

describe('R1 the real samples/index.json', () => {
  it('R1.2 passes SampleIndexSchema', () => {
    expect(SampleIndexSchema.safeParse(readIndex()).success).toBe(true);
  });

  it('R1.3 lists exactly the five samples, in the design order', () => {
    const ids = (readIndex() as { id: string }[]).map((entry) => entry.id);
    expect(ids).toEqual(FIVE);
  });

  it('R1.3 the ids equal the stems of the .md files in samples/', () => {
    const stems = readdirSync(SAMPLES_DIR)
      .filter((name) => name.endsWith('.md'))
      .map((name) => name.slice(0, -'.md'.length))
      .sort();
    expect(stems).toEqual([...FIVE].sort());
  });

  it('R1.2 the dish names of each entry are the headings in its text (counts as written in the design)', () => {
    const counts = Object.fromEntries(
      (readIndex() as { id: string; dishes: string[] }[]).map((e) => [e.id, e.dishes.length]),
    );
    expect(counts).toEqual({
      'sunday-roast': 4,
      'halloween-party': 5,
      'weeknight-curry': 4,
      'vegetarian-feast': 5,
      'korean-table': 5,
    });
  });

  it('R2.5 buildSampleTexts on the real directory is ok: every text is at most 12,000 characters and the texts are distinct', () => {
    const result = buildSampleTexts(
      readLibrarySource({ samplesDir: SAMPLES_DIR, recordingsDir: RECORDINGS_DIR }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((s) => s.entry.id)).toEqual(FIVE);
  });
});
