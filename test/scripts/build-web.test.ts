import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { findForbidden, webBuildOptions } from '../../scripts/build-web.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'make-dinner-assets-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('findForbidden (tech.md, The API key: the build fails if a key marker is in the bundle)', () => {
  it('finds nothing in a clean bundle', () => {
    writeFileSync(join(dir, 'main.js'), 'console.log("Make Dinner")');
    writeFileSync(join(dir, 'main.css'), 'body{color:red}');
    expect(findForbidden(dir)).toEqual([]);
  });

  it('finds "sk-ant-" and names the file', () => {
    writeFileSync(join(dir, 'main.js'), 'const k="sk-ant-api03-abc";');
    expect(findForbidden(dir)).toEqual([{ file: join(dir, 'main.js'), needle: 'sk-ant-' }]);
  });

  it('finds "ANTHROPIC" in a nested file, for example a source map', () => {
    mkdirSync(join(dir, 'maps'));
    writeFileSync(join(dir, 'maps', 'main.js.map'), '{"names":["process.env.ANTHROPIC_API_KEY"]}');
    expect(findForbidden(dir)).toEqual([
      { file: join(dir, 'maps', 'main.js.map'), needle: 'ANTHROPIC' },
    ]);
  });

  it('reports each marker in each file', () => {
    writeFileSync(join(dir, 'a.js'), 'ANTHROPIC and sk-ant-');
    expect(findForbidden(dir).map((hit) => hit.needle)).toEqual(['ANTHROPIC', 'sk-ant-']);
  });

  it('a missing directory has nothing to find', () => {
    expect(findForbidden(join(dir, 'does-not-exist'))).toEqual([]);
  });
});

describe('webBuildOptions (plan-ui review D)', () => {
  it('D production is minified and watch mode is not', () => {
    expect(webBuildOptions(false).minify).toBe(true);
    expect(webBuildOptions(true).minify).toBe(false);
  });

  it('D the real bundle has zod English messages and no other zod locale', async () => {
    const result = await build({
      ...webBuildOptions(false),
      write: false,
      outdir: 'unused',
      logLevel: 'silent',
    });
    const js = result.outputFiles.filter((file) => file.path.endsWith('.js'));
    expect(js).toHaveLength(1);
    const text = js[0]?.text ?? '';
    expect(text).toContain('Invalid input');
    // Hebrew letters appear only in the Hebrew locale's messages.
    expect(text).not.toMatch(/[\u0590-\u05FF]/);
    expect(text.length).toBeLessThan(400_000);
  }, 60_000);
});
