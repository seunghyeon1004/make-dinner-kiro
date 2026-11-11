import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SamplesResponseSchema } from '../../../src/core/index.js';
import { makeTestApp } from '../../support/server.js';

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

function fixtureRaw(id: string): unknown {
  const file = new URL(`../../fixtures/not-a-recording/recordings/${id}.json`, import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { raw: unknown }).raw;
}

describe('R3 GET /api/samples', () => {
  it('R3.1 answers 200 with JSON { samples } holding the two fixture items in index order', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/api/samples');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await res.json()) as { samples: Record<string, unknown>[] };
    expect(Object.keys(body)).toEqual(['samples']);
    expect(body.samples.map((s) => s.id)).toEqual(['tiny-roast', 'tiny-salad']);
    expect(SamplesResponseSchema.safeParse(body).success).toBe(true);
  });

  it('R3.2 each item has the index fields, the normalised text, the recorded plan and its issues, in the documented key order', async () => {
    const { app } = makeTestApp();
    const body = (await (await app.request('/api/samples')).json()) as {
      samples: Record<string, unknown>[];
    };
    const [roast, salad] = body.samples;
    expect(Object.keys(roast ?? {})).toEqual([
      'id',
      'title',
      'blurb',
      'dishes',
      'kitchen',
      'servingTime',
      'text',
      'plan',
      'issues',
    ]);
    expect(roast).toEqual({
      id: 'tiny-roast',
      title: 'Tiny roast',
      blurb: 'A hand-made test sample, not a real recording.',
      dishes: ['Roast chicken', 'Peas'],
      kitchen: { burners: 1, ovens: 1, cooks: 1 },
      servingTime: '13:00',
      text: ROAST_TEXT,
      plan: fixtureRaw('tiny-roast'),
      issues: [
        {
          severity: 'warning',
          code: 'appliance_mismatch',
          stepId: 'chicken.rest',
          word: 'roast',
          suggested: 'oven',
          message:
            'Step chicken.rest mentions "roast" but uses no appliance. If it needs the oven, set its appliance to oven.',
        },
      ],
    });
    expect(salad).toEqual({
      id: 'tiny-salad',
      title: 'Tiny salad',
      blurb: 'A second hand-made test sample, with no appliances.',
      dishes: ['Green salad'],
      kitchen: { burners: 0, ovens: 0, cooks: 1 },
      servingTime: '19:00',
      text: SALAD_TEXT,
      plan: fixtureRaw('tiny-salad'),
      issues: [],
    });
  });

  it('R3.2 an item does not carry the text hash', async () => {
    const { app } = makeTestApp();
    const text = await (await app.request('/api/samples')).text();
    expect(text).not.toContain('textSha256');
  });

  it('R3.3 answers without a model client, a key or any limit consumed', async () => {
    const { app, rateLimiter, dailyCap, clock } = makeTestApp({ modelClient: null });
    for (let i = 0; i < 10; i++) {
      expect((await app.request('/api/samples')).status).toBe(200);
    }
    expect(rateLimiter.size()).toEqual({ clients: 0, timestamps: 0 });
    expect(dailyCap.usedToday(clock.nowMs())).toBe(0);
  });
});
