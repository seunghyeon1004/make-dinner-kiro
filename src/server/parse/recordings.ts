import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  RECIPE_TEXT_MAX,
  DishIdSchema,
  SampleEntrySchema,
  checkKitchen,
  compareIds,
  err,
  normaliseRecipeText,
  ok,
  validatePlan,
} from '../../core/index.js';
import type { Issue, Kitchen, Plan, Result, SampleEntry } from '../../core/index.js';
import { MODEL_ID } from './anthropic-client.js';
import { countChars } from './limits.js';

export { SampleEntrySchema };
export type { SampleEntry };

export const SampleIndexSchema = z.array(SampleEntrySchema).min(1).max(12);

export const RecordingSchema = z.strictObject({
  sampleId: DishIdSchema,
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
  model: z.string().max(100).regex(/\S/),
  recordedAt: z.iso.datetime(),
  raw: z.unknown(),
});
export type Recording = z.infer<typeof RecordingSchema>;

export interface LibraryPaths {
  samplesDir: string;
  recordingsDir: string;
}

/** File contents by file stem; `indexText` is null when samples/index.json is missing. */
export interface LibrarySource {
  indexText: string | null;
  /** Every *.md in samplesDir. */
  sampleTexts: ReadonlyMap<string, string>;
  /** Every *.json in recordingsDir. */
  recordingTexts: ReadonlyMap<string, string>;
}

export interface SampleText {
  entry: SampleEntry;
  /** Normalised. */
  text: string;
  textSha256: string;
}

export interface LoadedSample extends SampleEntry {
  /** Normalised. */
  text: string;
  textSha256: string;
  plan: Plan;
  /** From validatePlan; warnings only, because errors refuse the start. */
  issues: Issue[];
}

export interface SampleLibrary {
  readonly samples: readonly LoadedSample[];
  findByText(normalisedText: string): LoadedSample | undefined;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function readStems(dir: string, extension: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(extension)) continue;
    const text = readFileOrNull(join(dir, name));
    if (text !== null) files.set(name.slice(0, -extension.length), text);
  }
  return files;
}

/** The only function here that touches the file system (node:fs). */
export function readLibrarySource(paths: LibraryPaths): LibrarySource {
  return {
    indexText: readFileOrNull(join(paths.samplesDir, 'index.json')),
    sampleTexts: readStems(paths.samplesDir, '.md'),
    recordingTexts: readStems(paths.recordingsDir, '.json'),
  };
}

/** `[1].servingTime`; the root is called `root`. */
function pathText(path: readonly PropertyKey[], root: string): string {
  if (path.length === 0) return root;
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
}

function location(issue: Issue): string | undefined {
  if ('field' in issue) return issue.field;
  if ('stepId' in issue && issue.stepId !== undefined) return issue.stepId;
  if ('dishId' in issue && issue.dishId !== undefined) return issue.dishId;
  return undefined;
}

function sanityItem(issue: Issue): string {
  const where = location(issue);
  return where === undefined ? issue.code : `${issue.code} ${where}`;
}

/**
 * Runs a model's raw value through the same checks as any plan source and the suggested
 * kitchen, and describes what is wrong in lines that name codes and fields, never values.
 * `scripts/record.ts` and the startup check share it. No problems and a plan means usable.
 */
export function checkPlanForKitchen(
  raw: unknown,
  kitchen: Kitchen,
): { plan: Plan | null; issues: Issue[]; problems: string[] } {
  const check = validatePlan(raw);
  if (check.plan === null) {
    const items = check.issues.map((issue) => `${issue.code} at ${location(issue) ?? 'plan'}`);
    return {
      plan: null,
      issues: check.issues,
      problems: [`the plan fails the schema: ${items.join(', ')}`],
    };
  }
  const problems: string[] = [];
  const errors = check.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) problems.push(`the plan has errors: ${errors.map(sanityItem).join(', ')}`);
  const kitchenErrors = checkKitchen(check.plan, kitchen).filter(
    (issue) => issue.severity === 'error',
  );
  if (kitchenErrors.length > 0) {
    problems.push(
      `the suggested kitchen lacks an appliance: ${kitchenErrors.map(sanityItem).join(', ')}`,
    );
  }
  return { plan: check.plan, issues: check.issues, problems };
}

function checkRecording(
  entry: SampleEntry,
  sample: SampleText,
  recordingText: string | undefined,
  problems: string[],
): LoadedSample | null {
  const file = `recordings/${entry.id}.json`;
  if (recordingText === undefined) {
    problems.push(`${file} is missing.`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(recordingText);
  } catch {
    problems.push(`${file} is not valid JSON.`);
    return null;
  }
  const shape = RecordingSchema.safeParse(parsed);
  const shapePaths = shape.success
    ? []
    : shape.error.issues.map((issue) => pathText(issue.path, 'recording'));
  // z.unknown() alone would accept a missing key, so ask for the own key.
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    !Object.hasOwn(parsed, 'raw') &&
    !shapePaths.includes('raw')
  ) {
    shapePaths.push('raw');
  }
  if (!shape.success || shapePaths.length > 0) {
    for (const path of [...new Set(shapePaths)]) problems.push(`${file}: ${path} is not valid.`);
    return null;
  }
  const recording = shape.data;
  if (recording.sampleId !== entry.id) {
    problems.push(`${file} is for sample ${recording.sampleId}, not ${entry.id}.`);
    return null;
  }
  if (recording.textSha256 !== sample.textSha256) {
    problems.push(`${file} is stale: samples/${entry.id}.md has changed since it was recorded.`);
    return null;
  }
  const checked = checkPlanForKitchen(recording.raw, entry.kitchen);
  for (const line of checked.problems) problems.push(`${file}: ${line}`);
  if (checked.plan === null || checked.problems.length > 0) return null;
  return {
    ...entry,
    text: sample.text,
    textSha256: sample.textSha256,
    plan: checked.plan,
    issues: checked.issues,
  };
}

interface Analysis {
  problems: string[];
  texts: SampleText[];
  loaded: LoadedSample[];
}

/** Collects every problem, in the order of the design table; throws nothing. */
function analyse(source: LibrarySource, withRecordings: boolean): Analysis {
  const analysis: Analysis = { problems: [], texts: [], loaded: [] };
  const { problems } = analysis;

  if (source.indexText === null) {
    problems.push('samples/index.json is missing.');
    return analysis;
  }
  let indexJson: unknown;
  try {
    indexJson = JSON.parse(source.indexText);
  } catch {
    problems.push('samples/index.json is not valid JSON.');
    return analysis;
  }
  const index = SampleIndexSchema.safeParse(indexJson);
  if (!index.success) {
    for (const issue of index.error.issues) {
      problems.push(`samples/index.json: ${pathText(issue.path, 'index')} is not valid.`);
    }
    return analysis;
  }

  const listed = new Set<string>();
  const reportedTwice = new Set<string>();
  const entries: SampleEntry[] = [];
  for (const entry of index.data) {
    if (!listed.has(entry.id)) {
      listed.add(entry.id);
      entries.push(entry);
    } else if (!reportedTwice.has(entry.id)) {
      reportedTwice.add(entry.id);
      problems.push(`samples/index.json lists ${entry.id} more than once.`);
    }
  }

  const idByHash = new Map<string, string>();
  for (const entry of entries) {
    const fileText = source.sampleTexts.get(entry.id);
    if (fileText === undefined) {
      problems.push(`samples/${entry.id}.md is missing.`);
      continue;
    }
    const text = normaliseRecipeText(fileText);
    const textSha256 = sha256Hex(text);
    if (countChars(text) > RECIPE_TEXT_MAX) {
      problems.push(`samples/${entry.id}.md is longer than 12,000 characters after normalisation.`);
    }
    const other = idByHash.get(textSha256);
    if (other !== undefined) {
      problems.push(`samples/${entry.id}.md has the same text as samples/${other}.md.`);
    } else {
      idByHash.set(textSha256, entry.id);
    }
    const sample: SampleText = { entry, text, textSha256 };
    analysis.texts.push(sample);
    if (withRecordings) {
      const loaded = checkRecording(entry, sample, source.recordingTexts.get(entry.id), problems);
      if (loaded !== null) analysis.loaded.push(loaded);
    }
  }

  for (const stem of [...source.sampleTexts.keys()].sort(compareIds)) {
    if (!listed.has(stem)) problems.push(`samples/${stem}.md is not listed in samples/index.json.`);
  }
  if (withRecordings) {
    for (const stem of [...source.recordingTexts.keys()].sort(compareIds)) {
      if (!listed.has(stem)) {
        problems.push(
          `recordings/${stem}.json does not belong to any sample in samples/index.json.`,
        );
      }
    }
  }
  return analysis;
}

/** The index and text checks only; scripts/record.ts uses it before any recording exists. */
export function buildSampleTexts(source: LibrarySource): Result<SampleText[], string[]> {
  const { problems, texts } = analyse(source, false);
  return problems.length > 0 ? err(problems) : ok(texts);
}

export function buildSampleLibrary(source: LibrarySource): Result<SampleLibrary, string[]> {
  const { problems, loaded } = analyse(source, true);
  if (problems.length > 0) return err(problems);
  const byHash = new Map(loaded.map((sample) => [sample.textSha256, sample]));
  return ok({
    samples: loaded,
    findByText(normalisedText) {
      const sample = byHash.get(sha256Hex(normalisedText));
      return sample !== undefined && sample.text === normalisedText ? sample : undefined;
    },
  });
}

export function loadSampleLibrary(paths: LibraryPaths): Result<SampleLibrary, string[]> {
  return buildSampleLibrary(readLibrarySource(paths));
}

export function formatStartupFailure(problems: readonly string[]): string {
  return [
    'Cannot start: the sample dinners are not ready.',
    ...problems,
    'Fix the files above. To record the samples again, run: npm run record (needs ANTHROPIC_API_KEY; it makes one model call per sample).',
  ].join('\n');
}

export function buildRecording(
  sampleId: string,
  normalisedText: string,
  raw: unknown,
  recordedAt: Date,
): Recording {
  return {
    sampleId,
    textSha256: sha256Hex(normalisedText),
    model: MODEL_ID,
    recordedAt: recordedAt.toISOString(),
    raw,
  };
}

export function serialiseRecording(recording: Recording): string {
  return `${JSON.stringify(recording, null, 2)}\n`;
}
