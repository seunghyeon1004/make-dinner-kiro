import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fileSampleSource, getSample, listSamples } from '../../src/mcp/samples.js';
import { HOME_KITCHEN, SUNDAY_ROAST, BURNER_ONLY_KITCHEN } from '../support/fixtures.js';
import { memorySamples } from '../support/mcp.js';

// The recipe text is already normalised (no trailing whitespace), so its hash is the hash of
// the normalised text.
const RECIPE = 'Roast the chicken at 180C for 75 minutes. Make gravy. Cook the greens.';
const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const ENTRY = {
  id: 'sunday-roast',
  title: 'Sunday roast',
  blurb: 'Chicken, gravy and greens.',
  dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
  kitchen: HOME_KITCHEN,
  servingTime: '13:30',
};
const OTHER = { ...ENTRY, id: 'weeknight-curry', title: 'Weeknight curry' };
const recording = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    sampleId: 'sunday-roast',
    textSha256: sha(RECIPE),
    model: 'test-model',
    recordedAt: '2026-01-01T00:00:00.000Z',
    raw: SUNDAY_ROAST,
    ...over,
  });
const files = (over: Record<string, string> = {}): Record<string, string> => ({
  'samples/index.json': JSON.stringify([ENTRY, OTHER]),
  'samples/sunday-roast.md': RECIPE,
  'recordings/sunday-roast.json': recording(),
  ...over,
});

const errorOf = (r: ReturnType<typeof getSample> | ReturnType<typeof listSamples>) =>
  r.ok ? null : r.error;

describe('listSamples (KM2.6)', () => {
  it('KM2.6 lists the index entries in order with id, title, dishes, kitchen and servingTime only', () => {
    const r = listSamples(memorySamples(files()));
    expect(r).toEqual({
      ok: true,
      value: [
        {
          id: 'sunday-roast',
          title: 'Sunday roast',
          dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
          kitchen: { burners: 4, ovens: 1, cooks: 1 },
          servingTime: '13:30',
        },
        {
          id: 'weeknight-curry',
          title: 'Weeknight curry',
          dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
          kitchen: { burners: 4, ovens: 1, cooks: 1 },
          servingTime: '13:30',
        },
      ],
    });
  });

  it('KM4.2 a missing index is samples_unavailable with the problem line', () => {
    const error = errorOf(listSamples(memorySamples({})));
    expect(error?.code).toBe('samples_unavailable');
    expect(error?.message).toBe('samples/index.json is missing.');
    expect(error?.details).toEqual({ problem: 'samples/index.json is missing.' });
  });

  it('KM4.2 an index that is not JSON is samples_unavailable', () => {
    const error = errorOf(listSamples(memorySamples({ 'samples/index.json': '{nope' })));
    expect(error?.code).toBe('samples_unavailable');
    expect(error?.message).toBe('samples/index.json is not valid JSON.');
  });

  it('KM4.2 an index that fails the schema is samples_unavailable naming the path', () => {
    const bad = JSON.stringify([{ ...ENTRY, servingTime: 'noon' }]);
    const error = errorOf(listSamples(memorySamples({ 'samples/index.json': bad })));
    expect(error?.code).toBe('samples_unavailable');
    expect(error?.message).toBe('samples/index.json: [0].servingTime is not valid.');
  });
});

describe('getSample (KM2.6, KM4.2)', () => {
  it('KM2.6 returns the entry fields, the recorded plan and its issues', () => {
    const r = getSample(memorySamples(files()), 'sunday-roast');
    expect(r).toEqual({
      ok: true,
      value: {
        id: 'sunday-roast',
        title: 'Sunday roast',
        dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
        kitchen: { burners: 4, ovens: 1, cooks: 1 },
        servingTime: '13:30',
        plan: SUNDAY_ROAST,
        issues: [],
      },
    });
  });

  it('KM4.2 an id that is not listed is not_found', () => {
    const error = errorOf(getSample(memorySamples(files()), 'nope'));
    expect(error).toEqual({
      code: 'not_found',
      message: 'There is no sample nope. Call list_samples for the ids.',
      details: { id: 'nope' },
    });
  });

  it('KM4.1 an id that is not a dish id is not_found without reading a path', () => {
    const error = errorOf(getSample(memorySamples(files()), '../index'));
    expect(error?.code).toBe('not_found');
  });

  it('KM4.2 a missing index is samples_unavailable', () => {
    expect(errorOf(getSample(memorySamples({}), 'sunday-roast'))?.code).toBe('samples_unavailable');
  });

  const unavailable = (over: Record<string, string>, id = 'sunday-roast') =>
    errorOf(getSample(memorySamples(files(over)), id));

  it('KM4.2 a missing recipe text is sample_unavailable', () => {
    const f = files();
    delete f['samples/sunday-roast.md'];
    const error = errorOf(getSample(memorySamples(f), 'sunday-roast'));
    expect(error).toEqual({
      code: 'sample_unavailable',
      message: 'samples/sunday-roast.md is missing.',
      details: { id: 'sunday-roast', problem: 'samples/sunday-roast.md is missing.' },
    });
  });

  it('KM4.2 a missing recording says to run npm run record', () => {
    const f = files();
    delete f['recordings/sunday-roast.json'];
    const error = errorOf(getSample(memorySamples(f), 'sunday-roast'));
    expect(error?.code).toBe('sample_unavailable');
    expect(error?.message).toBe(
      "recordings/sunday-roast.json is missing. Run npm run record (needs the user's key).",
    );
  });

  it('KM4.2 a recording that is not JSON is sample_unavailable', () => {
    expect(unavailable({ 'recordings/sunday-roast.json': '{' })?.message).toBe(
      'recordings/sunday-roast.json is not valid JSON.',
    );
  });

  it('KM4.2 a recording failing its schema names the field', () => {
    expect(unavailable({ 'recordings/sunday-roast.json': recording({ model: '' }) })?.message).toBe(
      'recordings/sunday-roast.json: model is not valid.',
    );
  });

  it('KM4.2 a recording for another sample is sample_unavailable', () => {
    expect(
      unavailable({ 'recordings/sunday-roast.json': recording({ sampleId: 'weeknight-curry' }) })
        ?.message,
    ).toBe('recordings/sunday-roast.json is for sample weeknight-curry, not sunday-roast.');
  });

  it('KM4.2 a recording made from different text is stale', () => {
    expect(unavailable({ 'samples/sunday-roast.md': `${RECIPE} Extra line.` })?.message).toBe(
      'recordings/sunday-roast.json is stale: samples/sunday-roast.md has changed since it was recorded.',
    );
  });

  it('KM4.2 a null plan is sample_unavailable naming the schema issue', () => {
    const error = unavailable({ 'recordings/sunday-roast.json': recording({ raw: null }) });
    expect(error?.code).toBe('sample_unavailable');
    expect(
      error?.message.startsWith('recordings/sunday-roast.json: the plan fails the schema: '),
    ).toBe(true);
  });

  it('KM4.2 a plan with a sanity error is sample_unavailable naming the code and step', () => {
    const broken = {
      ...SUNDAY_ROAST,
      steps: SUNDAY_ROAST.steps.map((s) =>
        s.id === 'chicken.prep' ? { ...s, after: ['chicken.nope'] } : s,
      ),
    };
    const error = unavailable({ 'recordings/sunday-roast.json': recording({ raw: broken }) });
    expect(error?.message).toContain('the plan has errors: unknown_dependency chicken.prep');
  });

  it('KM4.2 a suggested kitchen without the needed appliance is sample_unavailable', () => {
    const index = JSON.stringify([{ ...ENTRY, kitchen: BURNER_ONLY_KITCHEN }]);
    const error = unavailable({ 'samples/index.json': index });
    expect(error?.code).toBe('sample_unavailable');
    expect(error?.message).toContain('the suggested kitchen lacks an appliance: ');
    expect(error?.message).toContain('chicken.roast');
  });
});

describe('fileSampleSource (KM4.1)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mcp-samples-'));
  mkdirSync(path.join(dir, 'samples'));
  mkdirSync(path.join(dir, 'recordings'));
  writeFileSync(path.join(dir, 'samples', 'index.json'), '[]');
  writeFileSync(path.join(dir, 'samples', 'a-b.md'), 'text');
  writeFileSync(path.join(dir, 'recordings', 'a-b.json'), '{}');
  writeFileSync(path.join(dir, 'x.md'), 'outside');
  writeFileSync(path.join(dir, 'samples', 'A.md'), 'upper');
  const source = fileSampleSource(pathToFileURL(`${dir}/`));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('KM4.1 reads the index, a sample and a recording under the root', () => {
    expect(source.readText('samples/index.json')).toBe('[]');
    expect(source.readText('samples/a-b.md')).toBe('text');
    expect(source.readText('recordings/a-b.json')).toBe('{}');
  });

  it('KM4.1 a file that does not exist is null', () => {
    expect(source.readText('samples/missing.md')).toBeNull();
  });

  it('KM4.1 refuses a stem that is not a dish id, even when the file exists', () => {
    expect(source.readText('samples/../x.md')).toBeNull();
    expect(source.readText('samples/A.md')).toBeNull();
  });
});
