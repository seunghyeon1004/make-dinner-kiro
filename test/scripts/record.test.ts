import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli, runRecord } from '../../scripts/record.js';
import { err, ok } from '../../src/core/index.js';
import type { ModelClient, ModelError } from '../../src/server/parse/anthropic-client.js';
import { fakeModelClient } from '../support/fakes.js';
import { FIXTURE_PATHS } from '../support/server.js';

// Hand-worked values from test/fixtures/not-a-recording/README.md.
const ROAST_TEXT =
  'Tiny roast (a test fixture, not a real sample)\n\n' +
  'Roast chicken\n' +
  'Heat the oven to 200C, 15 minutes. Rub the chicken with butter, 10 minutes. Roast for 75 minutes. Let it rest under foil for 20 minutes; it stays hot for 30.\n\n' +
  'Peas\n' +
  'Boil the peas for 4 minutes and serve straight away.';
const SALAD_TEXT =
  'Tiny salad (a test fixture, not a real sample)\n\n' +
  'Green salad\n' +
  'Wash and dry the leaves, 5 minutes. Whisk a dressing, 2 minutes; it keeps. Toss just before serving, 1 minute.';
const ROAST_SHA = '68bbcf6bdabe7257c48aa13ffcbc491e442b10de7a125cb70d993d1655f8566a';
const NOW = new Date('2026-11-11T09:00:00.000Z');

function fixtureRaw(id: string): unknown {
  const file = join(FIXTURE_PATHS.recordingsDir, `${id}.json`);
  return (JSON.parse(readFileSync(file, 'utf8')) as { raw: unknown }).raw;
}
const ROAST_RAW = fixtureRaw('tiny-roast');
const SALAD_RAW = fixtureRaw('tiny-salad');

let root = '';
let samplesDir = '';
let recordingsDir = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'make-dinner-record-'));
  samplesDir = join(root, 'samples');
  recordingsDir = join(root, 'recordings');
  cpSync(FIXTURE_PATHS.samplesDir, samplesDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function record(client: ModelClient, ids: string[] = []) {
  const lines: string[] = [];
  const code = await runRecord({
    client,
    paths: { samplesDir, recordingsDir },
    ids,
    now: () => NOW,
    write: (line) => lines.push(line),
  });
  return { code, lines };
}

const recordingPath = (id: string) => join(recordingsDir, `${id}.json`);
const unavailable: ModelError = { kind: 'unavailable', reason: 'timeout', status: null };

describe('R12.1 runRecord writes recordings', () => {
  it('R12.1 records tiny-roast: the exact keys, hash, model, time and the raw value unchanged', async () => {
    const client = fakeModelClient([ok(ROAST_RAW)]);
    const { code, lines } = await record(client, ['tiny-roast']);
    expect(code).toBe(0);
    expect(lines).toEqual([
      'tiny-roast: recorded, 5 steps, 1 warnings.',
      'Recorded 1 of 1 samples.',
    ]);
    expect(client.calls).toEqual([ROAST_TEXT]);

    const file = readFileSync(recordingPath('tiny-roast'), 'utf8');
    expect(file.startsWith('{\n  "sampleId": "tiny-roast",\n  "textSha256": "')).toBe(true);
    expect(file.endsWith('\n}\n')).toBe(true);
    const written = JSON.parse(file) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(['sampleId', 'textSha256', 'model', 'recordedAt', 'raw']);
    expect(written).toEqual({
      sampleId: 'tiny-roast',
      textSha256: ROAST_SHA,
      model: 'claude-opus-5-5',
      recordedAt: '2026-11-11T09:00:00.000Z',
      raw: ROAST_RAW,
    });
    expect(existsSync(recordingPath('tiny-salad'))).toBe(false);
  });

  it('R12.1 with no ids it records every sample, one call each, in index order', async () => {
    const client = fakeModelClient([ok(ROAST_RAW), ok(SALAD_RAW)]);
    const { code, lines } = await record(client);
    expect(code).toBe(0);
    expect(client.calls).toEqual([ROAST_TEXT, SALAD_TEXT]);
    expect(lines).toEqual([
      'tiny-roast: recorded, 5 steps, 1 warnings.',
      'tiny-salad: recorded, 3 steps, 0 warnings.',
      'Recorded 2 of 2 samples.',
    ]);
    expect(existsSync(recordingPath('tiny-roast'))).toBe(true);
    expect(existsSync(recordingPath('tiny-salad'))).toBe(true);
  });

  it('R12.1 ids limits the samples to those named', async () => {
    const client = fakeModelClient([ok(SALAD_RAW)]);
    const { code, lines } = await record(client, ['tiny-salad']);
    expect(code).toBe(0);
    expect(client.calls).toEqual([SALAD_TEXT]);
    expect(lines).toEqual([
      'tiny-salad: recorded, 3 steps, 0 warnings.',
      'Recorded 1 of 1 samples.',
    ]);
  });

  it('R12.1 a new recording replaces the old file', async () => {
    mkdirSync(recordingsDir, { recursive: true });
    writeFileSync(recordingPath('tiny-salad'), 'OLD');
    await record(fakeModelClient([ok(SALAD_RAW)]), ['tiny-salad']);
    expect(readFileSync(recordingPath('tiny-salad'), 'utf8')).not.toBe('OLD');
  });
});

describe('R12.3 a sample that cannot be recorded is not written, the others go on, the exit code is 1', () => {
  const salad = ok(SALAD_RAW);

  it('R12.3 a model error: the id, the API code, the kind and the reason', async () => {
    const { code, lines } = await record(fakeModelClient([err(unavailable), salad]));
    expect(code).toBe(1);
    expect(lines).toEqual([
      'tiny-roast: not recorded: model_unavailable (unavailable, timeout)',
      'tiny-salad: recorded, 3 steps, 0 warnings.',
      'Recorded 1 of 2 samples.',
    ]);
    expect(existsSync(recordingPath('tiny-roast'))).toBe(false);
    expect(existsSync(recordingPath('tiny-salad'))).toBe(true);
  });

  it('R12.3 a refusal names its category; an invalid output names its reason', async () => {
    const { lines } = await record(
      fakeModelClient([
        err({ kind: 'refused', category: 'cyber' }),
        err({ kind: 'output_invalid', reason: 'not_json' }),
      ]),
    );
    expect(lines.slice(0, 2)).toEqual([
      'tiny-roast: not recorded: model_refused (refused, cyber)',
      'tiny-salad: not recorded: model_output_invalid (output_invalid, not_json)',
    ]);
  });

  it('R12.3 a refusal without a category says none', async () => {
    const { lines } = await record(fakeModelClient([err({ kind: 'refused', category: null })]), [
      'tiny-roast',
    ]);
    expect(lines[0]).toBe('tiny-roast: not recorded: model_refused (refused, none)');
  });

  it('R12.3 a raw value that fails the schema: codes and fields, and nothing from the value', async () => {
    const { code, lines } = await record(
      fakeModelClient([ok({ title: 'MODEL-MARKER-TEXT' }), salad]),
    );
    expect(code).toBe(1);
    expect(lines[0]).toBe(
      'tiny-roast: not recorded: the plan fails the schema: invalid_field at dishes, invalid_field at steps',
    );
    expect(existsSync(recordingPath('tiny-roast'))).toBe(false);
    expect(lines.join('\n')).not.toContain('MODEL-MARKER-TEXT');
  });

  it('R12.3 a plan with a sanity error', async () => {
    const raw = structuredClone(ROAST_RAW) as { steps: { after: string[] }[] };
    const rub = raw.steps[1];
    if (rub) rub.after = ['chicken.nope'];
    const { code, lines } = await record(fakeModelClient([ok(raw)]), ['tiny-roast']);
    expect(code).toBe(1);
    expect(lines).toEqual([
      'tiny-roast: not recorded: the plan has errors: unknown_dependency chicken.rub',
      'Recorded 0 of 1 samples.',
    ]);
    expect(existsSync(recordingPath('tiny-roast'))).toBe(false);
  });

  it('R12.3 a plan the suggested kitchen cannot cook', async () => {
    const indexPath = join(samplesDir, 'index.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { id: string; kitchen: object }[];
    const roast = index.find((e) => e.id === 'tiny-roast');
    if (roast) roast.kitchen = { burners: 1, ovens: 0, cooks: 1 };
    writeFileSync(indexPath, JSON.stringify(index));
    const { code, lines } = await record(fakeModelClient([ok(ROAST_RAW)]), ['tiny-roast']);
    expect(code).toBe(1);
    expect(lines[0]).toBe(
      'tiny-roast: not recorded: the suggested kitchen lacks an appliance: missing_appliance chicken.preheat, missing_appliance chicken.roast',
    );
    expect(existsSync(recordingPath('tiny-roast'))).toBe(false);
  });

  it('review Q4 the not-a-recipe answer is not recorded', async () => {
    const sentinel = {
      title: 'Not a recipe',
      dishes: [{ id: 'not-a-recipe', name: 'Not a recipe' }],
      steps: [
        {
          id: 'not-a-recipe.skip',
          dish: 'not-a-recipe',
          title: 'Not a recipe',
          minutes: 1,
          appliance: 'none',
          handsOn: false,
          after: [],
          holdMin: null,
        },
      ],
    };
    const { code, lines } = await record(fakeModelClient([ok(sentinel)]), ['tiny-roast']);
    expect(code).toBe(1);
    expect(lines[0]).toBe(
      'tiny-roast: not recorded: the model did not read this as a recipe (not-a-recipe).',
    );
    expect(existsSync(recordingPath('tiny-roast'))).toBe(false);
  });

  it('R12.3 a client that throws is reported without its message, and the run goes on', async () => {
    const { code, lines } = await record(fakeModelClient([new Error('boom-secret-detail'), salad]));
    expect(code).toBe(1);
    expect(lines).toEqual([
      'tiny-roast: not recorded: unexpected error',
      'tiny-salad: recorded, 3 steps, 0 warnings.',
      'Recorded 1 of 2 samples.',
    ]);
  });

  it('R12.5 a failed sample leaves its earlier recording untouched', async () => {
    mkdirSync(recordingsDir, { recursive: true });
    writeFileSync(recordingPath('tiny-roast'), 'EARLIER-RECORDING');
    await record(fakeModelClient([err(unavailable)]), ['tiny-roast']);
    expect(readFileSync(recordingPath('tiny-roast'), 'utf8')).toBe('EARLIER-RECORDING');
  });
});

describe('R12 before any call', () => {
  it('R12.3 an unknown id returns 1 before any call, and writes nothing', async () => {
    const client = fakeModelClient([]);
    const { code, lines } = await record(client, ['tiny-roast', 'nope']);
    expect(code).toBe(1);
    expect(lines).toEqual(['Unknown sample: nope. Known samples: tiny-roast, tiny-salad.']);
    expect(client.calls).toEqual([]);
    expect(existsSync(recordingsDir)).toBe(false);
  });

  it('R2.3 problems with the index or the texts are printed, one per line, and nothing is called', async () => {
    rmSync(join(samplesDir, 'tiny-salad.md'));
    writeFileSync(join(samplesDir, 'extra.md'), 'Another recipe.');
    const client = fakeModelClient([]);
    const { code, lines } = await record(client);
    expect(code).toBe(1);
    expect(lines).toEqual([
      'samples/tiny-salad.md is missing.',
      'samples/extra.md is not listed in samples/index.json.',
    ]);
    expect(client.calls).toEqual([]);
  });
});

describe('R12.4 output never carries the key, recipe text or model output', () => {
  it('R12.4 no output line of a full run contains recipe words or raw titles', async () => {
    const { lines } = await record(fakeModelClient([ok(ROAST_RAW), ok(SALAD_RAW)]));
    const text = lines.join('\n');
    for (const secret of [
      'Roast chicken',
      'Rub the chicken',
      'Green salad',
      'Whisk the dressing',
      'butter',
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('R12.2 the CLI', () => {
  it('R12.2 without a key it says so, exits 1, and builds no client', async () => {
    const lines: string[] = [];
    const code = await runCli({}, [], (line) => lines.push(line));
    expect(code).toBe(1);
    expect(lines).toEqual([
      'ANTHROPIC_API_KEY is not set. npm run record makes one model call per sample; set the key and run it again.',
    ]);
  });

  it('R12.2 an empty key counts as not set', async () => {
    const lines: string[] = [];
    const code = await runCli({ ANTHROPIC_API_KEY: '' }, ['tiny-roast'], (line) =>
      lines.push(line),
    );
    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
  });

  it('R12.2 an invalid environment is reported by variable name and exits 1', async () => {
    const lines: string[] = [];
    const code = await runCli({ PARSE_TIMEOUT_MS: 'abc' }, [], (line) => lines.push(line));
    expect(code).toBe(1);
    expect(lines[0]).toBe('Invalid environment:');
    expect(lines[1]?.trim().startsWith('PARSE_TIMEOUT_MS:')).toBe(true);
  });
});
