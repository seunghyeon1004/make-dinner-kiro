import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, context } from 'esbuild';
import type { BuildOptions, Plugin } from 'esbuild';

export interface ForbiddenHit {
  file: string;
  needle: string;
}

/** Markers that must never reach the browser bundle (tech.md, The API key). */
const FORBIDDEN = ['ANTHROPIC', 'sk-ant-'];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Lists every forbidden marker found in every file under `dir`. */
export function findForbidden(dir: string): ForbiddenHit[] {
  if (!existsSync(dir)) return [];
  return filesUnder(dir)
    .sort()
    .flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return FORBIDDEN.filter((needle) => text.includes(needle)).map((needle) => ({
        file,
        needle,
      }));
    });
}

const OUT_DIR = 'public/assets';

/**
 * zod's entry point re-exports every locale as a namespace, which esbuild cannot drop, so
 * about 240 kB of translations reach the bundle. The app speaks English only (product.md),
 * so the locale index is replaced by one that exports English alone. Nothing in `src/` uses
 * `z.locales`.
 */
export const zodEnglishOnly: Plugin = {
  name: 'zod-english-only',
  setup(b) {
    b.onLoad({ filter: /zod[\\/]v4[\\/]locales[\\/]index\.js$/ }, () => ({
      contents: 'export { default as en } from "./en.js";',
      loader: 'js',
    }));
  },
};

/** The esbuild options of the web bundle; production is minified, watch mode is not. */
export function webBuildOptions(watch: boolean): BuildOptions {
  return {
    entryPoints: ['src/web/main.tsx'],
    outdir: OUT_DIR,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    tsconfig: 'tsconfig.web.json',
    minify: !watch,
    plugins: [zodEnglishOnly],
    logLevel: 'info',
  };
}

async function main(): Promise<number> {
  const watch = process.argv.includes('--watch');
  rmSync(OUT_DIR, { recursive: true, force: true });
  if (watch) {
    const ctx = await context(webBuildOptions(true));
    await ctx.watch();
    return 0;
  }
  await build(webBuildOptions(false));
  const hits = findForbidden(OUT_DIR);
  for (const hit of hits) {
    console.error(`Forbidden marker "${hit.needle}" found in ${hit.file}`);
  }
  return hits.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
