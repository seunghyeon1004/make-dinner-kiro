import { describe, expect, it } from 'vitest';
import {
  buildRecording,
  buildSampleLibrary,
  buildSampleTexts,
  formatStartupFailure,
  loadSampleLibrary,
  readLibrarySource,
  serialiseRecording,
} from '../../../src/server/parse/recordings.js';
import type { LibrarySource } from '../../../src/server/parse/recordings.js';
import { FIXTURE_PATHS } from '../../support/server.js';

// Hand-worked values come from test/fixtures/not-a-recording/README.md.
const ROAST_TEXT =
  'Tiny roast (a test fixture, not a real sample)\n\n' +
  'Roast chicken\n' +
  'Heat the oven to 200C, 15 minutes. Rub the chicken with butter, 10 minutes. Roast for 75 minutes. Let it rest under foil for 20 minutes; it stays hot for 30.\n\n' +
  'Peas\n' +
  'Boil the peas for 4 minutes and serve straight away.';
const ROAST_SHA = '68bbcf6bdabe7257c48aa13ffcbc491e442b10de7a125cb70d993d1655f8566a';
const SALAD_SHA = 'bfa43cdb7952384cde4e1ececc569692f4cbada28598cee2363c2a7eb0fa5b4e';

const base = readLibrarySource(FIXTURE_PATHS);

interface Index {
  id: string;
  kitchen: { burners: number; ovens: number; cooks: number };
  servingTime: string;
}

/** A copy of the fixture source with changes applied. */
function changed(
  change: (parts: {
    indexText: string | null;
    sampleTexts: Map<string, string>;
    recordingTexts: Map<string, string>;
    index: Index[];
    recording: (id: string) => Record<string, unknown>;
    setRecording: (id: string, value: unknown) => void;
  }) => void,
): LibrarySource {
  const parts = {
    indexText: base.indexText,
    sampleTexts: new Map(base.sampleTexts),
    recordingTexts: new Map(base.recordingTexts),
    index: JSON.parse(base.indexText ?? '[]') as Index[],
    recording(id: string): Record<string, unknown> {
      return JSON.parse(parts.recordingTexts.get(id) ?? '{}') as Record<string, unknown>;
    },
    setRecording(id: string, value: unknown): void {
      parts.recordingTexts.set(id, JSON.stringify(value));
    },
  };
  change(parts);
  return {
    indexText: parts.indexText,
    sampleTexts: parts.sampleTexts,
    recordingTexts: parts.recordingTexts,
  };
}

function problemsOf(source: LibrarySource): string[] {
  const result = buildSampleLibrary(source);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.error;
}

function textProblemsOf(source: LibrarySource): string[] {
  const result = buildSampleTexts(source);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.error;
}

describe('R2.1 readLibrarySource and loadSampleLibrary on the fixture', () => {
  it('R2.1 reads index.json, both texts and both recordings by file stem', () => {
    expect(base.indexText).toContain('"id": "tiny-roast"');
    expect([...base.sampleTexts.keys()]).toEqual(['tiny-roast', 'tiny-salad']);
    expect([...base.recordingTexts.keys()]).toEqual(['tiny-roast', 'tiny-salad']);
    expect(base.sampleTexts.get('tiny-salad')).toContain('Whisk a dressing, 2 minutes');
  });

  it('R2.1 missing directories read as an empty source', () => {
    const source = readLibrarySource({
      samplesDir: '/nonexistent-samples',
      recordingsDir: '/nonexistent-recordings',
    });
    expect(source.indexText).toBeNull();
    expect(source.sampleTexts.size).toBe(0);
    expect(source.recordingTexts.size).toBe(0);
  });

  it('R2.1 loadSampleLibrary on the fixture directories is ok', () => {
    expect(loadSampleLibrary(FIXTURE_PATHS).ok).toBe(true);
  });

  it('R2.3 loadSampleLibrary on missing directories reports the missing index', () => {
    const result = loadSampleLibrary({
      samplesDir: '/nonexistent-samples',
      recordingsDir: '/nonexistent-recordings',
    });
    expect(result).toEqual({ ok: false, error: ['samples/index.json is missing.'] });
  });
});

describe('R2.1 R2.2 R3.2 the fixture library', () => {
  const result = buildSampleLibrary(base);
  const library = result.ok ? result.value : null;

  it('R2.1 holds the samples in index order with the hand-worked fields', () => {
    expect(library?.samples.map((s) => s.id)).toEqual(['tiny-roast', 'tiny-salad']);
    const roast = library?.samples[0];
    expect(roast?.title).toBe('Tiny roast');
    expect(roast?.blurb).toBe('A hand-made test sample, not a real recording.');
    expect(roast?.dishes).toEqual(['Roast chicken', 'Peas']);
    expect(roast?.kitchen).toEqual({ burners: 1, ovens: 1, cooks: 1 });
    expect(roast?.servingTime).toBe('13:00');
    expect(roast?.text).toBe(ROAST_TEXT);
    expect(roast?.textSha256).toBe(ROAST_SHA);
    expect(roast?.plan.steps.map((s) => s.id)).toEqual([
      'chicken.preheat',
      'chicken.rub',
      'chicken.roast',
      'chicken.rest',
      'peas.boil',
    ]);
    expect(roast?.issues.map((i) => [i.code, 'stepId' in i ? i.stepId : null])).toEqual([
      ['appliance_mismatch', 'chicken.rest'],
    ]);
    const salad = library?.samples[1];
    expect(salad?.textSha256).toBe(SALAD_SHA);
    expect(salad?.plan.steps.map((s) => s.id)).toEqual([
      'salad.wash',
      'salad.dressing',
      'salad.toss',
    ]);
    expect(salad?.issues).toEqual([]);
  });

  it('R5.1 findByText finds a sample by its normalised text', () => {
    expect(library?.findByText(ROAST_TEXT)?.id).toBe('tiny-roast');
  });

  it('R5.1 findByText misses on a one-character change, and on text that is not normalised', () => {
    expect(library?.findByText(ROAST_TEXT.replace('200C', '201C'))).toBeUndefined();
    expect(library?.findByText(`${ROAST_TEXT} `)).toBeUndefined();
    expect(library?.findByText('')).toBeUndefined();
  });
});

describe('R2.3 R2.5 R2.7 one problem line per rule (design table)', () => {
  it('index missing', () => {
    const source = changed((p) => {
      p.indexText = null;
    });
    expect(problemsOf(source)).toEqual(['samples/index.json is missing.']);
    expect(textProblemsOf(source)).toEqual(['samples/index.json is missing.']);
  });

  it('index not JSON', () => {
    const source = changed((p) => {
      p.indexText = '[{';
    });
    expect(problemsOf(source)).toEqual(['samples/index.json is not valid JSON.']);
  });

  it('index schema: one line per zod issue with the path', () => {
    const source = changed((p) => {
      p.indexText = JSON.stringify(
        p.index.map((e, i) => (i === 1 ? { ...e, servingTime: '25:00' } : e)),
      );
    });
    expect(problemsOf(source)).toEqual(['samples/index.json: [1].servingTime is not valid.']);
  });

  it('index schema: the root is named index', () => {
    const source = changed((p) => {
      p.indexText = '[]';
    });
    expect(problemsOf(source)).toEqual(['samples/index.json: index is not valid.']);
  });

  it('id listed twice', () => {
    const source = changed((p) => {
      p.indexText = JSON.stringify([...p.index, ...p.index.slice(0, 1)]);
    });
    expect(problemsOf(source)).toEqual(['samples/index.json lists tiny-roast more than once.']);
  });

  it('text missing', () => {
    const source = changed((p) => {
      p.sampleTexts.delete('tiny-salad');
    });
    expect(problemsOf(source)).toEqual(['samples/tiny-salad.md is missing.']);
    expect(textProblemsOf(source)).toEqual(['samples/tiny-salad.md is missing.']);
  });

  it('text too long: 12,001 characters after normalisation, but 12,000 is accepted', () => {
    const long = changed((p) => {
      p.sampleTexts.set('tiny-roast', 'a'.repeat(12_001));
    });
    expect(textProblemsOf(long)).toEqual([
      'samples/tiny-roast.md is longer than 12,000 characters after normalisation.',
    ]);
    const exact = changed((p) => {
      p.sampleTexts.set('tiny-roast', 'a'.repeat(12_000));
    });
    expect(buildSampleTexts(exact).ok).toBe(true);
    // Trailing spaces that normalisation removes do not count.
    const padded = changed((p) => {
      p.sampleTexts.set('tiny-roast', `${'a'.repeat(12_000)}${' '.repeat(50)}`);
    });
    expect(buildSampleTexts(padded).ok).toBe(true);
  });

  it('same text is reported on the later sample', () => {
    const source = changed((p) => {
      p.sampleTexts.set('tiny-salad', `${p.sampleTexts.get('tiny-roast') ?? ''}\n\n`);
    });
    expect(textProblemsOf(source)).toEqual([
      'samples/tiny-salad.md has the same text as samples/tiny-roast.md.',
    ]);
  });

  it('unlisted text', () => {
    const source = changed((p) => {
      p.sampleTexts.set('extra', 'Another recipe.');
    });
    expect(problemsOf(source)).toEqual(['samples/extra.md is not listed in samples/index.json.']);
    expect(textProblemsOf(source)).toEqual([
      'samples/extra.md is not listed in samples/index.json.',
    ]);
  });

  it('recording missing', () => {
    const source = changed((p) => {
      p.recordingTexts.delete('tiny-salad');
    });
    expect(problemsOf(source)).toEqual(['recordings/tiny-salad.json is missing.']);
    expect(buildSampleTexts(source).ok).toBe(true);
  });

  it('recording not JSON', () => {
    const source = changed((p) => {
      p.recordingTexts.set('tiny-roast', '{"sampleId":');
    });
    expect(problemsOf(source)).toEqual(['recordings/tiny-roast.json is not valid JSON.']);
  });

  it('recording shape: a bad field, a missing raw key, an extra key and a non-object', () => {
    const badHash = changed((p) => {
      p.setRecording('tiny-roast', { ...p.recording('tiny-roast'), textSha256: 'xyz' });
    });
    expect(problemsOf(badHash)).toEqual(['recordings/tiny-roast.json: textSha256 is not valid.']);

    const noRaw = changed((p) => {
      const recording = p.recording('tiny-roast');
      delete recording.raw;
      p.setRecording('tiny-roast', recording);
    });
    expect(problemsOf(noRaw)).toEqual(['recordings/tiny-roast.json: raw is not valid.']);

    const extra = changed((p) => {
      p.setRecording('tiny-roast', { ...p.recording('tiny-roast'), note: 'hand edited' });
    });
    expect(problemsOf(extra)).toEqual(['recordings/tiny-roast.json: recording is not valid.']);

    const array = changed((p) => {
      p.recordingTexts.set('tiny-roast', '[]');
    });
    expect(problemsOf(array)).toEqual(['recordings/tiny-roast.json: recording is not valid.']);
  });

  it('recording for another sample', () => {
    const source = changed((p) => {
      p.setRecording('tiny-roast', { ...p.recording('tiny-roast'), sampleId: 'tiny-salad' });
    });
    expect(problemsOf(source)).toEqual([
      'recordings/tiny-roast.json is for sample tiny-salad, not tiny-roast.',
    ]);
  });

  it('stale recording: the text changed since it was recorded', () => {
    const source = changed((p) => {
      p.sampleTexts.set('tiny-salad', `${p.sampleTexts.get('tiny-salad') ?? ''}\nAdd salt.`);
    });
    expect(problemsOf(source)).toEqual([
      'recordings/tiny-salad.json is stale: samples/tiny-salad.md has changed since it was recorded.',
    ]);
  });

  it('the plan fails the schema', () => {
    const empty = changed((p) => {
      p.setRecording('tiny-roast', { ...p.recording('tiny-roast'), raw: {} });
    });
    expect(problemsOf(empty)).toEqual([
      'recordings/tiny-roast.json: the plan fails the schema: invalid_field at dishes, invalid_field at steps, invalid_field at title',
    ]);

    const zeroMinutes = changed((p) => {
      const recording = p.recording('tiny-roast') as { raw: { steps: { minutes: number }[] } };
      const step = recording.raw.steps[3];
      if (step) step.minutes = 0;
      p.setRecording('tiny-roast', recording);
    });
    expect(problemsOf(zeroMinutes)).toEqual([
      'recordings/tiny-roast.json: the plan fails the schema: minutes_out_of_range at steps[3].minutes',
    ]);
  });

  it('the plan has sanity errors (a warning alone is not a problem)', () => {
    const source = changed((p) => {
      const recording = p.recording('tiny-roast') as { raw: { steps: { after: string[] }[] } };
      const step = recording.raw.steps[1];
      if (step) step.after = ['chicken.nope'];
      p.setRecording('tiny-roast', recording);
    });
    expect(problemsOf(source)).toEqual([
      'recordings/tiny-roast.json: the plan has errors: unknown_dependency chicken.rub',
    ]);
  });

  it('the suggested kitchen lacks an appliance', () => {
    const source = changed((p) => {
      p.indexText = JSON.stringify(
        p.index.map((e) =>
          e.id === 'tiny-roast' ? { ...e, kitchen: { burners: 1, ovens: 0, cooks: 1 } } : e,
        ),
      );
    });
    expect(problemsOf(source)).toEqual([
      'recordings/tiny-roast.json: the suggested kitchen lacks an appliance: missing_appliance chicken.preheat, missing_appliance chicken.roast',
    ]);
  });

  it('orphan recording', () => {
    const source = changed((p) => {
      p.recordingTexts.set('ghost', '{}');
    });
    expect(problemsOf(source)).toEqual([
      'recordings/ghost.json does not belong to any sample in samples/index.json.',
    ]);
  });

  it('R2.6 several problems at once: every line, in the design order', () => {
    const source = changed((p) => {
      p.sampleTexts.set('tiny-roast', `${p.sampleTexts.get('tiny-roast') ?? ''}\nAdd pepper.`);
      p.sampleTexts.delete('tiny-salad');
      p.sampleTexts.set('zeta', 'Z.');
      p.sampleTexts.set('alpha', 'A.');
      p.recordingTexts.set('ghost', '{}');
      p.recordingTexts.set('beta', '{}');
    });
    expect(problemsOf(source)).toEqual([
      'recordings/tiny-roast.json is stale: samples/tiny-roast.md has changed since it was recorded.',
      'samples/tiny-salad.md is missing.',
      'samples/alpha.md is not listed in samples/index.json.',
      'samples/zeta.md is not listed in samples/index.json.',
      'recordings/beta.json does not belong to any sample in samples/index.json.',
      'recordings/ghost.json does not belong to any sample in samples/index.json.',
    ]);
  });

  it('R2.7 no problem line contains recipe text or model output', () => {
    const source = changed((p) => {
      p.sampleTexts.set('tiny-roast', `${'a'.repeat(12_001)} SECRET-RECIPE-WORDS`);
      p.setRecording('tiny-salad', {
        ...p.recording('tiny-salad'),
        raw: { title: 'SECRET-MODEL-WORDS' },
      });
    });
    const text = problemsOf(source).join('\n');
    expect(text).not.toContain('SECRET-RECIPE-WORDS');
    expect(text).not.toContain('SECRET-MODEL-WORDS');
  });
});

describe('R2.6 formatStartupFailure', () => {
  it('R2.6 prints the heading, every problem on its own line, and the command that fixes recordings', () => {
    expect(
      formatStartupFailure(['samples/a.md is missing.', 'recordings/b.json is missing.']),
    ).toBe(
      'Cannot start: the sample dinners are not ready.\n' +
        'samples/a.md is missing.\n' +
        'recordings/b.json is missing.\n' +
        'Fix the files above. To record the samples again, run: npm run record (needs ANTHROPIC_API_KEY; it makes one model call per sample).',
    );
  });
});

describe('R12.1 buildRecording and serialiseRecording', () => {
  // SHA-256 of the UTF-8 bytes "Boil an egg.", worked with `printf 'Boil an egg.' | shasum -a 256`.
  const EGG_SHA = 'a33be4f53eccd930154bfcfa08f1cd0b8cf407196623083c5aa182b6b08afa7e';

  it('R12.1 builds { sampleId, textSha256, model, recordedAt, raw } with the raw value unchanged', () => {
    const raw = { title: 'Egg', anything: [1, 2] };
    expect(
      buildRecording('egg', 'Boil an egg.', raw, new Date('2026-11-11T08:30:15.123Z')),
    ).toEqual({
      sampleId: 'egg',
      textSha256: EGG_SHA,
      model: 'claude-opus-5-5',
      recordedAt: '2026-11-11T08:30:15.123Z',
      raw: { title: 'Egg', anything: [1, 2] },
    });
  });

  it('R12.1 serialises with two-space indentation and a final newline, keys in order', () => {
    const recording = buildRecording(
      'egg',
      'Boil an egg.',
      { a: 1 },
      new Date('2026-11-11T00:00:00.000Z'),
    );
    expect(serialiseRecording(recording)).toBe(
      '{\n' +
        '  "sampleId": "egg",\n' +
        `  "textSha256": "${EGG_SHA}",\n` +
        '  "model": "claude-opus-5-5",\n' +
        '  "recordedAt": "2026-11-11T00:00:00.000Z",\n' +
        '  "raw": {\n' +
        '    "a": 1\n' +
        '  }\n' +
        '}\n',
    );
  });
});
