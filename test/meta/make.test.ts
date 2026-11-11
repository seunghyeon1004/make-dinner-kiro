import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fcMakeParams, fcParams } from '../support/fc-params.js';
import { gnuMakeVersion, makeDir, runMake } from '../support/make.js';

// The Make runner and the run count of the properties that spawn make (dinnerfile spec, T1.6).
// These tests need GNU Make on PATH and fail, not skip, without it (R9.3).

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const freshDir = (): string => {
  const dir = makeDir();
  dirs.push(dir);
  return dir;
};

const TWO_RULES = ['.PHONY: dinner a.b', 'dinner: a.b', 'a.b:', "\t@echo 'hi' # a.b", ''].join(
  '\n',
);

describe('R9.3 gnuMakeVersion', () => {
  it('the first line of make --version starts with GNU Make', () => {
    expect(gnuMakeVersion().startsWith('GNU Make')).toBe(true);
  });
  it('an empty PATH finds no make and throws a message that says D2 needs GNU Make on PATH', () => {
    expect(() => gnuMakeVersion('')).toThrowError(/D2 needs GNU Make on PATH/);
  });
  it('a make that is not GNU Make throws, and the message shows what it printed', () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-make-'));
    dirs.push(bin);
    const script = join(bin, 'make');
    writeFileSync(script, '#!/bin/sh\necho "BSD make 1.0"\n');
    chmodSync(script, 0o755);
    expect(() => gnuMakeVersion(bin)).toThrowError(/D2 needs GNU Make on PATH.*BSD make 1\.0/);
  });
  it('a make that is GNU Make is accepted from another PATH', () => {
    const bin = mkdtempSync(join(tmpdir(), 'fake-make-'));
    dirs.push(bin);
    const script = join(bin, 'make');
    writeFileSync(script, '#!/bin/sh\necho "GNU Make 9.9"\necho second line\n');
    chmodSync(script, 0o755);
    expect(gnuMakeVersion(bin)).toBe('GNU Make 9.9');
  });
});

describe('R10.4 makeDir and runMake', () => {
  it('makeDir gives a new empty directory under the system temp directory each time', () => {
    const a = freshDir();
    const b = freshDir();
    expect(a).not.toBe(b);
    expect(a.startsWith(tmpdir())).toBe(true);
    expect(existsSync(a)).toBe(true);
    expect(readdirSync(a)).toEqual([]);
  });
  it('runMake on a two-rule text prints the one echo line, status 0, empty stderr', () => {
    const run = runMake(freshDir(), TWO_RULES, ['-n', 'dinner']);
    expect(run).toEqual({ status: 0, stdout: "echo 'hi' # a.b\n", stderr: '' });
  });
  it('runMake writes the text as Dinnerfile and nothing else into the directory', () => {
    const dir = freshDir();
    runMake(dir, TWO_RULES, ['-n', 'dinner']);
    expect(readdirSync(dir)).toEqual(['Dinnerfile']);
  });
  it('runMake runs without -n when asked: the shell prints the word', () => {
    expect(runMake(freshDir(), TWO_RULES, ['dinner'])).toEqual({
      status: 0,
      stdout: 'hi\n',
      stderr: '',
    });
  });
  it('runMake reports a failing make: status 2 and a message on stderr', () => {
    const run = runMake(freshDir(), TWO_RULES, ['-n', 'no-such-target']);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('No rule to make target');
  });
  it('runMake passes only PATH: MAKEFLAGS in the environment does not change the result', () => {
    const saved = process.env.MAKEFLAGS;
    process.env.MAKEFLAGS = '-n';
    try {
      expect(runMake(freshDir(), TWO_RULES, ['dinner']).stdout).toBe('hi\n');
    } finally {
      if (saved === undefined) delete process.env.MAKEFLAGS;
      else process.env.MAKEFLAGS = saved;
    }
  });
  it('runMake throws, rather than returning, when the process cannot run', () => {
    expect(() => runMake(join(tmpdir(), 'dinnerfile-no-such-dir-xyz'), TWO_RULES, [])).toThrow();
  });
});

describe('R10.5 fcMakeParams', () => {
  const withEnv = (values: Record<string, string | undefined>, body: () => void): void => {
    const saved = Object.fromEntries(Object.keys(values).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      body();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  it('is 50 runs by default', () => {
    withEnv({ FC_MAKE_RUNS: undefined, FC_NUM_RUNS: undefined }, () => {
      expect(fcMakeParams()).toEqual({ numRuns: 50 });
    });
  });
  it('FC_MAKE_RUNS=7 gives 7', () => {
    withEnv({ FC_MAKE_RUNS: '7' }, () => {
      expect(fcMakeParams()).toEqual({ numRuns: 7 });
    });
  });
  it.each(['0', '-3', '2.5', 'x', ''])('FC_MAKE_RUNS=%j is not a positive integer: 50', (value) => {
    withEnv({ FC_MAKE_RUNS: value }, () => {
      expect(fcMakeParams()).toEqual({ numRuns: 50 });
    });
  });
  it('FC_NUM_RUNS does not change it, and FC_MAKE_RUNS does not change fcParams', () => {
    withEnv({ FC_MAKE_RUNS: '7', FC_NUM_RUNS: '9' }, () => {
      expect(fcMakeParams()).toEqual({ numRuns: 7 });
      expect(fcParams()).toEqual({ numRuns: 9 });
    });
    withEnv({ FC_MAKE_RUNS: undefined, FC_NUM_RUNS: '9' }, () => {
      expect(fcMakeParams()).toEqual({ numRuns: 50 });
    });
  });
});
