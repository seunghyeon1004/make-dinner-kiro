import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  DISH_ID_PATTERN,
  DishIdSchema,
  RecordingSchema,
  SampleIndexSchema,
  checkKitchen,
  err,
  normaliseRecipeText,
  ok,
  validatePlan,
} from '../core/index.js';
import type { Issue, Kitchen, Plan, Result, SampleEntry } from '../core/index.js';
import type { ToolError } from './errors.js';

export type SamplePath =
  'samples/index.json' | `samples/${string}.md` | `recordings/${string}.json`;

/** `readText` gives null when there is no such file; any other read error throws. */
export interface SampleSource {
  readText(path: SamplePath): string | null;
}

// Type aliases, not interfaces: they are structured content, which needs an index signature.
export type SampleSummary = {
  id: string;
  title: string;
  dishes: string[];
  kitchen: Kitchen;
  servingTime: string;
};
export type SampleDetail = SampleSummary & { plan: Plan; issues: Issue[] };

/** Reads under `root` with readFileSync only; a stem that is not a dish id is "no such file". */
export function fileSampleSource(root: URL): SampleSource {
  return {
    readText(samplePath) {
      if (samplePath !== 'samples/index.json') {
        const stem = /^(?:samples|recordings)\/(.*)\.(?:md|json)$/.exec(samplePath)?.[1];
        if (stem === undefined || !DISH_ID_PATTERN.test(stem)) return null;
      }
      try {
        return readFileSync(new URL(samplePath, root), 'utf8');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}

const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** `[1].servingTime`, as the server's problem lines write it. */
function pathText(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out;
}

const fail = (code: ToolError['code'], problem: string, details: object = {}): ToolError => ({
  code,
  message: problem,
  details: { ...details, problem },
});

function readIndex(source: SampleSource): Result<SampleEntry[], ToolError> {
  const text = source.readText('samples/index.json');
  if (text === null) return err(fail('samples_unavailable', 'samples/index.json is missing.'));
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return err(fail('samples_unavailable', 'samples/index.json is not valid JSON.'));
  }
  const parsed = SampleIndexSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first === undefined || first.path.length === 0 ? 'index' : pathText(first.path);
    return err(fail('samples_unavailable', `samples/index.json: ${where} is not valid.`));
  }
  return ok(parsed.data);
}

export function listSamples(source: SampleSource): Result<SampleSummary[], ToolError> {
  const index = readIndex(source);
  if (!index.ok) return index;
  return ok(index.value.map(summary));
}

const summary = (e: SampleEntry): SampleSummary => ({
  id: e.id,
  title: e.title,
  dishes: e.dishes,
  kitchen: e.kitchen,
  servingTime: e.servingTime,
});

const where = (issue: Issue): string => {
  if ('field' in issue) return issue.field;
  if ('stepId' in issue && issue.stepId !== undefined) return issue.stepId;
  if ('dishId' in issue && issue.dishId !== undefined) return issue.dishId;
  return 'plan';
};
const item = (issue: Issue): string => `${issue.code} ${where(issue)}`;

/** Stops at the first problem, in the order of the design. */
export function getSample(source: SampleSource, id: string): Result<SampleDetail, ToolError> {
  const index = readIndex(source);
  if (!index.ok) return index;
  const entry = DishIdSchema.safeParse(id).success
    ? index.value.find((e) => e.id === id)
    : undefined;
  if (entry === undefined) {
    return err({
      code: 'not_found',
      message: `There is no sample ${id}. Call list_samples for the ids.`,
      details: { id },
    });
  }
  const bad = (problem: string): Result<SampleDetail, ToolError> =>
    err(fail('sample_unavailable', problem, { id }));

  const mdPath = `samples/${entry.id}.md` as const;
  const recPath = `recordings/${entry.id}.json` as const;
  const md = source.readText(mdPath);
  if (md === null) return bad(`${mdPath} is missing.`);
  const recText = source.readText(recPath);
  if (recText === null) {
    return bad(`${recPath} is missing. Run npm run record (needs the user's key).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(recText);
  } catch {
    return bad(`${recPath} is not valid JSON.`);
  }
  const shape = RecordingSchema.safeParse(parsed);
  const hasRaw = typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, 'raw');
  if (!shape.success) {
    const first = shape.error.issues[0];
    return bad(
      `${recPath}: ${first === undefined ? 'recording' : pathText(first.path)} is not valid.`,
    );
  }
  // z.unknown() accepts a missing key, so ask for the own key.
  if (!hasRaw) return bad(`${recPath}: raw is not valid.`);
  const recording = shape.data;
  if (recording.sampleId !== entry.id) {
    return bad(`${recPath} is for sample ${recording.sampleId}, not ${entry.id}.`);
  }
  if (recording.textSha256 !== sha256Hex(normaliseRecipeText(md))) {
    return bad(`${recPath} is stale: ${mdPath} has changed since it was recorded.`);
  }
  const checked = validatePlan(recording.raw);
  if (checked.plan === null) {
    return bad(
      `${recPath}: the plan fails the schema: ${checked.issues.map((i) => `${i.code} at ${where(i)}`).join(', ')}`,
    );
  }
  const errors = checked.issues.filter((i) => i.severity === 'error');
  if (errors.length > 0) {
    return bad(`${recPath}: the plan has errors: ${errors.map(item).join(', ')}`);
  }
  const kitchenErrors = checkKitchen(checked.plan, entry.kitchen).filter(
    (i) => i.severity === 'error',
  );
  if (kitchenErrors.length > 0) {
    return bad(
      `${recPath}: the suggested kitchen lacks an appliance: ${kitchenErrors.map(item).join(', ')}`,
    );
  }
  return ok({ ...summary(entry), plan: checked.plan, issues: checked.issues });
}
