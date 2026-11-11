import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkKitchen, normaliseRecipeText, validatePlan } from '../../../src/core/index.js';

const DIR = new URL('../../fixtures/not-a-recording/', import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, DIR), 'utf8'));
}

interface Recording {
  sampleId: string;
  textSha256: string;
  model: string;
  recordedAt: string;
  raw: unknown;
}

const recordings = {
  'tiny-roast': readJson('recordings/tiny-roast.json') as Recording,
  'tiny-salad': readJson('recordings/tiny-salad.json') as Recording,
};

describe('R15.1 the hand-made fixture (README: hand-worked facts)', () => {
  it('R15.1 tiny-roast: the one issue is the appliance_mismatch warning on chicken.rest', () => {
    const check = validatePlan(recordings['tiny-roast'].raw);
    expect(check.issues).toEqual([
      {
        severity: 'warning',
        code: 'appliance_mismatch',
        stepId: 'chicken.rest',
        word: 'roast',
        suggested: 'oven',
        message:
          'Step chicken.rest mentions "roast" but uses no appliance. If it needs the oven, set its appliance to oven.',
      },
    ]);
    expect(check.plan?.steps.map((s) => s.id)).toEqual([
      'chicken.preheat',
      'chicken.rub',
      'chicken.roast',
      'chicken.rest',
      'peas.boil',
    ]);
    expect(check.plan?.dishes.map((d) => d.name)).toEqual(['Roast chicken', 'Peas']);
  });

  it('R15.1 tiny-roast: its kitchen (1 burner, 1 oven, 1 cook) has every appliance', () => {
    const { plan } = validatePlan(recordings['tiny-roast'].raw);
    expect(plan).not.toBeNull();
    if (plan === null) return;
    expect(checkKitchen(plan, { burners: 1, ovens: 1, cooks: 1 })).toEqual([]);
  });

  it('R15.1 tiny-salad: no issues, and its kitchen (0 burners, 0 ovens) needs none', () => {
    const check = validatePlan(recordings['tiny-salad'].raw);
    expect(check.issues).toEqual([]);
    expect(check.plan?.steps.map((s) => s.id)).toEqual([
      'salad.wash',
      'salad.dressing',
      'salad.toss',
    ]);
    if (check.plan === null) return;
    expect(checkKitchen(check.plan, { burners: 0, ovens: 0, cooks: 1 })).toEqual([]);
  });

  it.each(['tiny-roast', 'tiny-salad'] as const)(
    'R2.2 %s: textSha256 is the SHA-256 of the normalised text, and the model says it is not a recording',
    (id) => {
      const text = normaliseRecipeText(readFileSync(new URL(`samples/${id}.md`, DIR), 'utf8'));
      const recording = recordings[id];
      expect(recording.sampleId).toBe(id);
      expect(recording.model).toBe('hand-made-not-a-recording');
      expect(recording.textSha256).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    },
  );
});
