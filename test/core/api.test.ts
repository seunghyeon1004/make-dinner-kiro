import { describe, expect, it } from 'vitest';
import {
  API_ERROR_CODES,
  ApiErrorSchema,
  ParseRequestSchema,
  ParseResponseSchema,
  RECIPE_TEXT_MAX,
  SampleEntrySchema,
  SampleItemSchema,
  SamplesResponseSchema,
} from '../../src/core/api.js';

// Hand-written values. The codes are the ten of tech.md, "Error handling".
const TEN_CODES = [
  'bad_request',
  'input_too_long',
  'invalid_plan',
  'rate_limited',
  'daily_cap_reached',
  'model_unavailable',
  'model_refused',
  'model_output_invalid',
  'not_found',
  'internal',
];

const entry = {
  id: 'sunday-roast',
  title: 'Sunday roast',
  blurb: 'Roast chicken with crisp potatoes.',
  dishes: ['Roast chicken', 'Gravy'],
  kitchen: { burners: 4, ovens: 2, cooks: 1 },
  servingTime: '13:30',
};

const plan = {
  title: 'Boiled egg',
  dishes: [{ id: 'egg', name: 'Egg' }],
  steps: [
    {
      id: 'egg.boil',
      dish: 'egg',
      title: 'Boil the egg',
      minutes: 8,
      appliance: 'burner',
      handsOn: false,
      after: [],
      holdMin: 5,
    },
  ],
};

const warning = {
  severity: 'warning',
  code: 'short_hands_free',
  stepId: 'egg.boil',
  minutes: 1,
  message: 'Step egg.boil is short.',
};

describe('R15.3 / review Q5: shared API schemas in src/core/api.ts', () => {
  it('RECIPE_TEXT_MAX is 12,000 (R4.6)', () => {
    expect(RECIPE_TEXT_MAX).toBe(12_000);
  });

  it('API_ERROR_CODES are exactly the ten codes of tech.md', () => {
    expect([...API_ERROR_CODES]).toEqual(TEN_CODES);
  });

  describe('ApiErrorSchema', () => {
    it('accepts every code with a message', () => {
      for (const code of TEN_CODES) {
        expect(ApiErrorSchema.safeParse({ error: { code, message: 'Text.' } }).success).toBe(true);
      }
    });

    it.each([
      ['an unknown code', { error: { code: 'teapot', message: 'm' } }],
      ['a missing message', { error: { code: 'internal' } }],
      ['an extra key inside error', { error: { code: 'internal', message: 'm', extra: 1 } }],
      ['an extra top-level key', { error: { code: 'internal', message: 'm' }, extra: 1 }],
      ['no error key', { code: 'internal', message: 'm' }],
    ])('rejects %s', (_name, value) => {
      expect(ApiErrorSchema.safeParse(value).success).toBe(false);
    });
  });

  describe('SampleEntrySchema (R1.2)', () => {
    it('accepts a well-formed entry', () => {
      expect(SampleEntrySchema.safeParse(entry).success).toBe(true);
    });

    const bad: [string, Record<string, unknown>][] = [
      ['an uppercase id', { id: 'Sunday' }],
      ['an id of 41 characters', { id: 'a'.repeat(41) }],
      ['an empty title', { title: '' }],
      ['a blank title', { title: '   ' }],
      ['a title of 81 characters', { title: 'a'.repeat(81) }],
      ['a blurb with a line break', { blurb: 'one\ntwo' }],
      ['a blank blurb', { blurb: ' ' }],
      ['a blurb of 161 characters', { blurb: 'a'.repeat(161) }],
      ['no dishes', { dishes: [] }],
      ['13 dishes', { dishes: Array.from({ length: 13 }, (_v, i) => `Dish ${i}`) }],
      ['a dish name of 81 characters', { dishes: ['a'.repeat(81)] }],
      ['five ovens', { kitchen: { burners: 4, ovens: 5, cooks: 1 } }],
      ['serving time 24:00', { servingTime: '24:00' }],
      ['serving time 7:30', { servingTime: '7:30' }],
      ['an extra key', { extra: true }],
    ];
    it.each(bad)('rejects %s', (_name, change) => {
      expect(SampleEntrySchema.safeParse({ ...entry, ...change }).success).toBe(false);
    });

    it('accepts the bounds: 80-character title, 160-character blurb, 12 dishes', () => {
      const edge = {
        ...entry,
        title: 'a'.repeat(80),
        blurb: 'b'.repeat(160),
        dishes: Array.from({ length: 12 }, (_v, i) => `Dish ${i}`),
      };
      expect(SampleEntrySchema.safeParse(edge).success).toBe(true);
    });
  });

  describe('SampleItemSchema and SamplesResponseSchema (R3.2)', () => {
    const item = { ...entry, text: 'Boil an egg, 8 minutes.', plan, issues: [warning] };

    it('accepts an entry plus text, plan and issues, and a response of items', () => {
      expect(SampleItemSchema.safeParse(item).success).toBe(true);
      expect(SamplesResponseSchema.safeParse({ samples: [item] }).success).toBe(true);
    });

    it.each([
      ['no text', { ...item, text: undefined }],
      ['no plan', { ...item, plan: undefined }],
      ['an invalid plan', { ...item, plan: { ...plan, steps: [] } }],
      ['an unknown issue code', { ...item, issues: [{ ...warning, code: 'nope' }] }],
      ['an extra key', { ...item, extra: 1 }],
    ])('rejects an item with %s', (_name, value) => {
      expect(SampleItemSchema.safeParse(value).success).toBe(false);
      expect(SamplesResponseSchema.safeParse({ samples: [value] }).success).toBe(false);
    });

    it('rejects a response with an extra key', () => {
      expect(SamplesResponseSchema.safeParse({ samples: [item], extra: 1 }).success).toBe(false);
    });
  });

  describe('ParseRequestSchema (R4.3)', () => {
    it('accepts exactly one string key text', () => {
      expect(ParseRequestSchema.safeParse({ text: 'Boil an egg.' }).success).toBe(true);
      expect(ParseRequestSchema.safeParse({ text: '' }).success).toBe(true);
    });

    it.each([
      ['no text', {}],
      ['a number', { text: 1 }],
      ['an extra key', { text: 'a', more: 1 }],
      ['null', null],
      ['an array', ['a']],
    ])('rejects %s', (_name, value) => {
      expect(ParseRequestSchema.safeParse(value).success).toBe(false);
    });
  });

  describe('ParseResponseSchema (R10.3)', () => {
    it('accepts a plan, issues and either source', () => {
      for (const source of ['recording', 'model']) {
        expect(ParseResponseSchema.safeParse({ plan, issues: [warning], source }).success).toBe(
          true,
        );
      }
    });

    it.each([
      ['an unknown source', { plan, issues: [], source: 'cache' }],
      ['no source', { plan, issues: [] }],
      ['a null plan', { plan: null, issues: [], source: 'model' }],
      ['an extra key', { plan, issues: [], source: 'model', extra: 1 }],
    ])('rejects %s', (_name, value) => {
      expect(ParseResponseSchema.safeParse(value).success).toBe(false);
    });
  });
});
