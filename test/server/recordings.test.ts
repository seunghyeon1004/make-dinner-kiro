import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkKitchen,
  KitchenSchema,
  normaliseRecipeText,
  ok,
  ParseResponseSchema,
  validatePlan,
} from '../../src/core/index.js';
import { isNotARecipe } from '../../src/server/parse/prompt.js';
import { loadSampleLibrary, RecordingSchema } from '../../src/server/parse/recordings.js';
import { fakeModelClient } from '../support/fakes.js';
import { makeTestApp, postParse } from '../support/server.js';

// T6.4: the real recordings of the five samples (R2.3, R2.4, R10.1, R10.3 and testing.md,
// "A test asserts each recording parses, passes the schema, and has no sanity errors").
// The files are read, never written. If one of these fails, report it; do not edit the file.

const SAMPLES_DIR = fileURLToPath(new URL('../../samples', import.meta.url));
const RECORDINGS_DIR = fileURLToPath(new URL('../../recordings', import.meta.url));

// R1.3, written by hand: the five samples in menu order.
const SAMPLE_IDS = [
  'sunday-roast',
  'halloween-party',
  'weeknight-curry',
  'vegetarian-feast',
  'korean-table',
] as const;

interface IndexEntry {
  id: string;
  dishes: string[];
  kitchen: unknown;
}
const INDEX = JSON.parse(readFileSync(`${SAMPLES_DIR}/index.json`, 'utf8')) as IndexEntry[];

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const entryOf = (id: string): IndexEntry => {
  const entry = INDEX.find((e) => e.id === id);
  if (entry === undefined) throw new Error(`samples/index.json has no ${id}`);
  return entry;
};
const recordingOf = (id: string) => RecordingSchema.parse(read(`${RECORDINGS_DIR}/${id}.json`));
const normalisedTextOf = (id: string): string =>
  normaliseRecipeText(readFileSync(`${SAMPLES_DIR}/${id}.md`, 'utf8'));

describe('T6.4 the recordings directory holds exactly the five samples', () => {
  it('R2.3 the index lists the five ids in order, and each has a recording', () => {
    expect(INDEX.map((e) => e.id)).toEqual([...SAMPLE_IDS]);
    for (const id of SAMPLE_IDS) {
      expect(RecordingSchema.safeParse(read(`${RECORDINGS_DIR}/${id}.json`)).success).toBe(true);
    }
  });
});

describe.each(SAMPLE_IDS)('T6.4 the recording of %s', (id) => {
  it('R12.1 has the recording shape, this sample id and the model claude-opus-5-5', () => {
    const recording = recordingOf(id);
    expect(recording.sampleId).toBe(id);
    expect(recording.model).toBe('claude-opus-5-5');
  });

  it('R2.2 R2.3 its textSha256 is the SHA-256 of the normalised sample text', () => {
    const expected = createHash('sha256').update(normalisedTextOf(id), 'utf8').digest('hex');
    expect(recordingOf(id).textSha256).toBe(expected);
  });

  it('R2.4 R10.1 raw passes the schema with no sanity error', () => {
    const check = validatePlan(recordingOf(id).raw);
    expect(check.plan).not.toBeNull();
    expect(check.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('R2.4 the plan has no checkKitchen error with the suggested kitchen', () => {
    const { plan } = validatePlan(recordingOf(id).raw);
    if (plan === null) throw new Error(`${id}: raw fails the schema`);
    expect(checkKitchen(plan, KitchenSchema.parse(entryOf(id).kitchen))).toEqual([]);
  });

  it('R2.4 the plan has as many dishes as samples/index.json lists', () => {
    const { plan } = validatePlan(recordingOf(id).raw);
    expect(plan?.dishes.length).toBe(entryOf(id).dishes.length);
  });

  it('R10.6 the plan is not the not-a-recipe sentinel', () => {
    const { plan } = validatePlan(recordingOf(id).raw);
    if (plan === null) throw new Error(`${id}: raw fails the schema`);
    expect(isNotARecipe(plan)).toBe(false);
  });
});

describe('T6.4 loadSampleLibrary on the real directories', () => {
  const loaded = loadSampleLibrary({ samplesDir: SAMPLES_DIR, recordingsDir: RECORDINGS_DIR });

  it('R2.1 R2.3 is ok, with the five samples in index order', () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.samples.map((s) => s.id)).toEqual([...SAMPLE_IDS]);
  });

  it('R2.1 each loaded sample carries the plan and issues validatePlan gives for its raw', () => {
    if (!loaded.ok) throw new Error(loaded.error.join('\n'));
    for (const sample of loaded.value.samples) {
      const check = validatePlan(recordingOf(sample.id).raw);
      expect(sample.plan).toEqual(check.plan);
      expect(sample.issues).toEqual(check.issues);
    }
  });
});

describe.each(SAMPLE_IDS)('T6.4 POST /api/parse with the sample %s', (id) => {
  const loaded = loadSampleLibrary({ samplesDir: SAMPLES_DIR, recordingsDir: RECORDINGS_DIR });
  if (!loaded.ok) throw new Error(loaded.error.join('\n'));
  const library = loaded.value;

  it('R5.1 the exact sample text is answered from the recording, with no model call', async () => {
    const client = fakeModelClient([]);
    const { app } = makeTestApp({ library, modelClient: client });
    const response = await postParse(app, { text: normalisedTextOf(id) });
    expect(response.status).toBe(200);
    const body = ParseResponseSchema.parse(await response.json());
    const check = validatePlan(recordingOf(id).raw);
    expect(body.source).toBe('recording');
    expect(body.plan).toEqual(check.plan);
    expect(body.issues).toEqual(check.issues);
    expect(client.calls).toEqual([]);
  });

  it('R10.1 R10.3 the sample text plus one extra line goes to the model, and its recorded raw comes back as the plan', async () => {
    const raw = recordingOf(id).raw as {
      title: string;
      dishes: { id: string }[];
      steps: unknown[];
    };
    const text = `${normalisedTextOf(id)}\nAdd a pinch of salt, 1 minute.`;
    const client = fakeModelClient([ok(raw)]);
    const { app } = makeTestApp({ library, modelClient: client });
    const response = await postParse(app, { text });
    expect(response.status).toBe(200);
    const body = ParseResponseSchema.parse(await response.json());
    expect(client.calls).toEqual([normaliseRecipeText(text)]);
    expect(body.source).toBe('model');
    expect(body.plan.title).toBe(raw.title);
    expect(body.plan.dishes.map((d) => d.id).sort()).toEqual(raw.dishes.map((d) => d.id).sort());
    expect(body.plan.steps).toHaveLength(raw.steps.length);
    expect(body.issues).toEqual(validatePlan(raw).issues);
  });
});
