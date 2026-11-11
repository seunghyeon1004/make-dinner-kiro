import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A GNU Make runner for the Dinnerfile tests (dinnerfile design, "Make runner"). Only `PATH`
// reaches make, so `MAKEFLAGS`, `MAKEFILES` or `SHELL` in a developer's environment cannot
// change a result. A missing or foreign make throws: D2 and P-DF7 fail, not skip (R9.3).

export interface MakeRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

const TIMEOUT_MS = 10_000;

/**
 * The first line of `make --version`. Throws when make is missing or the line does not start
 * with "GNU Make", with a message saying that D2 needs GNU Make on PATH. `path` is the value
 * of `PATH` to search; the default is the current one.
 */
export function gnuMakeVersion(path: string = process.env.PATH ?? ''): string {
  const result = spawnSync('make', ['--version'], {
    env: { PATH: path },
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    throw new Error(
      `D2 needs GNU Make on PATH, but make could not be run (${result.error.message}). Install GNU Make 3.81 or later.`,
    );
  }
  const first = result.stdout.split('\n')[0] ?? '';
  if (!first.startsWith('GNU Make')) {
    throw new Error(
      `D2 needs GNU Make on PATH, but "make --version" printed "${first}". Install GNU Make 3.81 or later.`,
    );
  }
  return first;
}

/** A fresh directory under os.tmpdir(); callers remove it in afterAll. */
export function makeDir(): string {
  return mkdtempSync(join(tmpdir(), 'dinnerfile-'));
}

let checked = false;

/** Writes dir/Dinnerfile and runs `make -f Dinnerfile ...args` there with env { PATH } only. */
export function runMake(dir: string, text: string, args: readonly string[]): MakeRun {
  if (!checked) {
    gnuMakeVersion();
    checked = true;
  }
  writeFileSync(join(dir, 'Dinnerfile'), text, 'utf8');
  const result = spawnSync('make', ['-f', 'Dinnerfile', ...args], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
