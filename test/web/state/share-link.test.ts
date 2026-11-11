import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../../src/core/index.js';
import type { Plan } from '../../../src/core/index.js';
import { loadSampleLibrary } from '../../../src/server/parse/recordings.js';
import {
  decodeShare,
  encodeShare,
  SHARE_URL_MAX,
  shareBody,
  shareUrl,
} from '../../../src/web/state/share-link.js';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../../support/fixtures.js';

/** Two steps in one dish, written out by hand; ids are in canonical order already. */
const TOAST: Plan = {
  title: 'Toast',
  dishes: [{ id: 'toast', name: 'Toast' }],
  steps: [
    {
      id: 'toast.toast',
      dish: 'toast',
      title: 'Toast it',
      minutes: 3,
      appliance: 'oven',
      handsOn: false,
      after: ['toast.slice'],
      holdMin: 5,
      detail: 'Until golden.',
    },
    {
      id: 'toast.slice',
      dish: 'toast',
      title: 'Slice the bread',
      minutes: 2,
      appliance: 'none',
      handsOn: true,
      after: [],
      holdMin: null,
    },
  ],
};
const TOAST_KITCHEN = { burners: 2, ovens: 1, cooks: 1 };

/** The version 1 body of TOAST, worked out by hand from the design (steps sorted by id). */
const TOAST_BODY: unknown[] = [
  'Toast',
  [['toast', 'Toast']],
  [
    ['toast.slice', 0, 'Slice the bread', 2, 2, 1, [], null],
    ['toast.toast', 0, 'Toast it', 3, 1, 0, [0], 5, 'Until golden.'],
  ],
  [2, 1, 1],
  '08:15',
];

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** A payload as the design writes it: JSON, UTF-8, raw deflate, base64url. */
function payloadOf(body: unknown): string {
  return base64url(deflateRawSync(Buffer.from(JSON.stringify(body), 'utf8')));
}

async function decodeBody(body: unknown) {
  return decodeShare(1, payloadOf(body));
}

describe('shareBody and encodeShare (R8.3)', () => {
  it('R8.3 the version 1 body of a two-step plan is the hand-written array', () => {
    expect(shareBody(TOAST, TOAST_KITCHEN, '08:15')).toEqual(TOAST_BODY);
  });

  it('R8.3 the payload inflates to that body, behind "1."', async () => {
    const encoded = await encodeShare({ plan: TOAST, kitchen: TOAST_KITCHEN, serve: '08:15' });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value.startsWith('1.')).toBe(true);
    const json = inflateRawSync(Buffer.from(encoded.value.slice(2), 'base64url')).toString('utf8');
    expect(JSON.parse(json)).toEqual(TOAST_BODY);
  });

  it('R8.4 a plan with an error has no link: invalid_plan', async () => {
    const broken: Plan = {
      ...TOAST,
      steps: TOAST.steps.map((s) =>
        s.id === 'toast.toast' ? { ...s, after: ['toast.slise'] } : s,
      ),
    };
    expect(await encodeShare({ plan: broken, kitchen: TOAST_KITCHEN, serve: '08:15' })).toEqual({
      ok: false,
      error: 'invalid_plan',
    });
  });

  it('R8.9 decodeShare gives back the canonical plan, the kitchen and the serving time', async () => {
    const encoded = await encodeShare({ plan: TOAST, kitchen: TOAST_KITCHEN, serve: '08:15' });
    if (!encoded.ok) throw new Error('expected a link');
    const decoded = await decodeShare(1, encoded.value.slice(2));
    expect(decoded).toEqual({
      ok: true,
      value: {
        plan: { ...TOAST, steps: [TOAST.steps[1], TOAST.steps[0]] },
        kitchen: TOAST_KITCHEN,
        serve: '08:15',
      },
    });
  });
});

describe('decodeShare errors (R8.5, R8.6)', () => {
  it('R8.6 version 2 is unknown_version 2', async () => {
    expect(await decodeShare(2, payloadOf(TOAST_BODY))).toEqual({
      ok: false,
      error: { kind: 'unknown_version', version: 2 },
    });
  });

  it('R8.6 a "*" character is bad_format', async () => {
    expect(await decodeShare(1, 'abc*def')).toEqual({ ok: false, error: { kind: 'bad_format' } });
  });

  it('R8.6 base64url of the wrong length is bad_format', async () => {
    expect(await decodeShare(1, 'A')).toEqual({ ok: false, error: { kind: 'bad_format' } });
  });

  it('R8.6 bytes that are not deflate are bad_format', async () => {
    expect(await decodeShare(1, base64url(Buffer.from('not deflate at all')))).toEqual({
      ok: false,
      error: { kind: 'bad_format' },
    });
  });

  it('R8.6 deflate of 300 KB of zeros is too_large (inflated limit)', async () => {
    const bomb = base64url(deflateRawSync(Buffer.alloc(300_000)));
    expect(bomb.length).toBeLessThan(65_536);
    expect(await decodeShare(1, bomb)).toEqual({ ok: false, error: { kind: 'too_large' } });
  });

  it('R8.6 a payload over 65,536 characters is too_large', async () => {
    expect(await decodeShare(1, 'A'.repeat(65_537))).toEqual({
      ok: false,
      error: { kind: 'too_large' },
    });
  });

  it('R8.6 JSON that is not JSON is bad_format', async () => {
    const payload = base64url(deflateRawSync(Buffer.from('{nope', 'utf8')));
    expect(await decodeShare(1, payload)).toEqual({ ok: false, error: { kind: 'bad_format' } });
  });

  it('R8.6 a body of the wrong shape is bad_format', async () => {
    expect(await decodeBody({ title: 'Toast' })).toEqual({
      ok: false,
      error: { kind: 'bad_format' },
    });
  });

  it('R8.6 an after index out of range is bad_format', async () => {
    const body = structuredClone(TOAST_BODY) as unknown[][][];
    (body[2]?.[1] as unknown[])[6] = [5];
    expect(await decodeBody(body)).toEqual({ ok: false, error: { kind: 'bad_format' } });
  });

  it('R8.6 a dish index out of range is bad_format', async () => {
    const body = structuredClone(TOAST_BODY) as unknown[][][];
    (body[2]?.[0] as unknown[])[1] = 3;
    expect(await decodeBody(body)).toEqual({ ok: false, error: { kind: 'bad_format' } });
  });

  it('R8.6 a bad serving time is bad_format', async () => {
    const body = [...TOAST_BODY.slice(0, 4), '25:00'];
    expect(await decodeBody(body)).toEqual({ ok: false, error: { kind: 'bad_format' } });
  });

  it('R8.6 a kitchen outside the limits is bad_format', async () => {
    const body = [...TOAST_BODY.slice(0, 3), [9, 1, 1], '08:15'];
    expect(await decodeBody(body)).toEqual({ ok: false, error: { kind: 'bad_format' } });
  });

  it('R8.6 a cycle is invalid_plan with the cycle issue', async () => {
    const body = structuredClone(TOAST_BODY) as unknown[][][];
    (body[2]?.[0] as unknown[])[6] = [1];
    const result = await decodeBody(body);
    expect(result.ok).toBe(false);
    if (result.ok || result.error.kind !== 'invalid_plan') throw new Error('expected invalid_plan');
    expect(result.error.issues.map((i) => i.code)).toContain('cycle');
  });
});

describe('shareUrl (R8.3)', () => {
  it('R8.3 puts the encoded payload after #/share/', () => {
    expect(shareUrl('http://127.0.0.1:65535/', '1.abc')).toBe(
      'http://127.0.0.1:65535/#/share/1.abc',
    );
  });
});

// Measured with base http://127.0.0.1:65535/ (link lengths in characters, from recordings/):
// sunday-roast 1015, halloween-party 1639, weeknight-curry 1063, vegetarian-feast 1429,
// korean-table 1395. The design expected the largest near 2,800; the limit is 8,000.
describe('every recorded sample fits in a link (R8.4)', () => {
  const library = loadSampleLibrary({ samplesDir: 'samples', recordingsDir: 'recordings' });

  it('R8.4 the library loads', () => {
    expect(library.ok).toBe(true);
  });

  const lengths: Record<string, number> = {};
  it('R8.4 each sample link is under SHARE_URL_MAX with base http://127.0.0.1:65535/', async () => {
    if (!library.ok) throw new Error('library did not load');
    expect(library.value.samples).toHaveLength(5);
    for (const sample of library.value.samples) {
      expect(validatePlan(sample.plan).plan).not.toBeNull();
      const encoded = await encodeShare({
        plan: sample.plan,
        kitchen: sample.kitchen,
        serve: sample.servingTime,
      });
      if (!encoded.ok) throw new Error(`${sample.id} has no link`);
      lengths[sample.id] = shareUrl('http://127.0.0.1:65535/', encoded.value).length;
      expect(lengths[sample.id]).toBeLessThan(SHARE_URL_MAX);
    }
    expect(Object.keys(lengths).sort()).toEqual([
      'halloween-party',
      'korean-table',
      'sunday-roast',
      'vegetarian-feast',
      'weeknight-curry',
    ]);
  });

  it('R8.4 the H1 plan with the home kitchen also fits', async () => {
    const encoded = await encodeShare({
      plan: SUNDAY_ROAST,
      kitchen: HOME_KITCHEN,
      serve: '19:30',
    });
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      expect(shareUrl('http://127.0.0.1:65535/', encoded.value).length).toBeLessThan(SHARE_URL_MAX);
    }
  });
});
