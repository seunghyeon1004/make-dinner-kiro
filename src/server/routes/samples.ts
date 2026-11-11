import { Hono } from 'hono';
import type { SamplesResponse } from '../../core/index.js';
import type { SampleLibrary } from '../parse/recordings.js';

/**
 * `GET /api/samples` (R3): every sample with its text, plan and issues. The body is built once;
 * the route reads no file, calls no model and consumes no limit.
 */
export function createSamplesRoute(library: SampleLibrary): Hono {
  const body: SamplesResponse = {
    samples: library.samples.map((sample) => ({
      id: sample.id,
      title: sample.title,
      blurb: sample.blurb,
      dishes: sample.dishes,
      kitchen: sample.kitchen,
      servingTime: sample.servingTime,
      text: sample.text,
      plan: sample.plan,
      issues: sample.issues,
    })),
  };
  return new Hono().get('/', (c) => c.json(body));
}
