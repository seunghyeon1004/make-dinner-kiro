import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv } from '../src/server/env.js';
import { createLogger } from '../src/server/log.js';
import { createAnthropicModelClient } from '../src/server/parse/anthropic-client.js';
import type { ModelClient } from '../src/server/parse/anthropic-client.js';
import { isNotARecipe } from '../src/server/parse/prompt.js';
import {
  buildRecording,
  buildSampleTexts,
  checkPlanForKitchen,
  readLibrarySource,
  serialiseRecording,
} from '../src/server/parse/recordings.js';
import type { LibraryPaths } from '../src/server/parse/recordings.js';

export interface RecordDeps {
  client: ModelClient;
  paths: LibraryPaths;
  /** Empty: every sample in index order. */
  ids: readonly string[];
  now: () => Date;
  /** One line of output. */
  write: (line: string) => void;
}

const API_CODE = {
  unavailable: 'model_unavailable',
  refused: 'model_refused',
  output_invalid: 'model_output_invalid',
} as const;

/**
 * Records the selected samples from the model, one call each, in index order (R12.1). A sample
 * that cannot be recorded is not written and the run goes on (R12.3). Returns the exit code.
 * Nothing printed carries the key, recipe text or model output (R12.4); the script bypasses the
 * rate limit and the daily cap because the user runs it, not visitors.
 */
export async function runRecord(deps: RecordDeps): Promise<number> {
  const { write } = deps;
  const texts = buildSampleTexts(readLibrarySource(deps.paths));
  if (!texts.ok) {
    for (const problem of texts.error) write(problem);
    return 1;
  }
  const known = texts.value.map((sample) => sample.entry.id);
  const unknown = deps.ids.filter((id) => !known.includes(id));
  if (unknown.length > 0) {
    for (const id of unknown) {
      write(`Unknown sample: ${id}. Known samples: ${known.join(', ')}.`);
    }
    return 1;
  }
  const selected =
    deps.ids.length === 0
      ? texts.value
      : texts.value.filter((sample) => deps.ids.includes(sample.entry.id));

  let recorded = 0;
  for (const sample of selected) {
    const id = sample.entry.id;
    let read;
    try {
      read = await deps.client.readRecipes(sample.text);
    } catch {
      // Whatever was thrown may quote the request; print nothing of it.
      write(`${id}: not recorded: unexpected error`);
      continue;
    }
    if (!read.ok) {
      const error = read.error;
      const detail = error.kind === 'refused' ? (error.category ?? 'none') : error.reason;
      write(`${id}: not recorded: ${API_CODE[error.kind]} (${error.kind}, ${detail})`);
      continue;
    }

    const checked = checkPlanForKitchen(read.value, sample.entry.kitchen);
    if (checked.plan !== null && isNotARecipe(checked.plan)) {
      write(`${id}: not recorded: the model did not read this as a recipe (not-a-recipe).`);
      continue;
    }
    if (checked.plan === null || checked.problems.length > 0) {
      for (const problem of checked.problems) write(`${id}: not recorded: ${problem}`);
      continue;
    }

    mkdirSync(deps.paths.recordingsDir, { recursive: true });
    const recording = buildRecording(id, sample.text, read.value, deps.now());
    writeFileSync(join(deps.paths.recordingsDir, `${id}.json`), serialiseRecording(recording));
    const warnings = checked.issues.filter((issue) => issue.severity === 'warning').length;
    const warningsText = `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`;
    write(`${id}: recorded, ${checked.plan.steps.length} steps, ${warningsText}.`);
    recorded += 1;
  }

  write(`Recorded ${recorded} of ${selected.length} samples.`);
  return recorded === selected.length ? 0 : 1;
}

/**
 * The command line behind `npm run record [id...]`. Builds the real client, so it is the one
 * place besides src/server/index.ts that may (R9.1). Never prints the key.
 */
export async function runCli(
  env: Record<string, string | undefined>,
  argv: readonly string[],
  write: (line: string) => void,
): Promise<number> {
  const parsed = loadEnv(env);
  if (!parsed.ok) {
    write('Invalid environment:');
    for (const line of parsed.error) write(`  ${line}`);
    return 1;
  }
  const apiKey = parsed.value.anthropicApiKey;
  if (apiKey === undefined) {
    write(
      'ANTHROPIC_API_KEY is not set. npm run record makes one model call per sample; set the key and run it again.',
    );
    return 1;
  }
  const logger = createLogger(parsed.value.logLevel, (line) => process.stderr.write(`${line}\n`));
  const client = createAnthropicModelClient({
    apiKey,
    timeoutMs: parsed.value.parseTimeoutMs,
    logger,
  });
  return runRecord({
    client,
    paths: {
      samplesDir: fileURLToPath(new URL('../samples', import.meta.url)),
      recordingsDir: fileURLToPath(new URL('../recordings', import.meta.url)),
    },
    ids: argv,
    now: () => new Date(),
    write,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.env, process.argv.slice(2), (line) => console.log(line)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // The error may quote the request; print its class only.
      console.error(error instanceof Error ? error.name : 'Unexpected error');
      process.exitCode = 1;
    },
  );
}
