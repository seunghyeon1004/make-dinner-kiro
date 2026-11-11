import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const eslint = new ESLint({ cwd: root });

/** The rule ids that fire on `code` as if it were a file in src/mcp. */
async function rulesFiredOn(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, 'src/mcp/probe.ts') });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
}

describe('src/mcp lint boundaries (KM6.1)', () => {
  it('KM6.1 fetch is rejected by no-restricted-globals', async () => {
    expect(await rulesFiredOn("export const x = fetch('x');\n")).toContain('no-restricted-globals');
  });

  it('KM6.1 process.env is rejected by no-restricted-properties', async () => {
    expect(await rulesFiredOn("export const x = process.env['X'];\n")).toContain(
      'no-restricted-properties',
    );
  });

  it('KM6.1 process.stdout and process.argv are rejected by no-restricted-properties', async () => {
    expect(await rulesFiredOn('export const x = process.stdout;\n')).toContain(
      'no-restricted-properties',
    );
    expect(await rulesFiredOn('export const x = process.argv;\n')).toContain(
      'no-restricted-properties',
    );
  });

  it('KM6.1 importing writeFileSync from node:fs is rejected by no-restricted-imports', async () => {
    expect(
      await rulesFiredOn("import { writeFileSync } from 'node:fs';\nvoid writeFileSync;\n"),
    ).toContain('no-restricted-imports');
  });

  it('KM6.1 importing node:child_process is rejected by no-restricted-imports', async () => {
    expect(await rulesFiredOn("import 'node:child_process';\n")).toContain('no-restricted-imports');
  });

  it('KM6.1 the network modules, node:fs/promises and the Anthropic SDK are rejected', async () => {
    for (const name of [
      'node:http',
      'node:https',
      'node:net',
      'node:tls',
      'node:dgram',
      'node:worker_threads',
      'node:fs/promises',
      'child_process',
      'fs/promises',
      '@anthropic-ai/sdk',
      'hono',
      '@hono/node-server',
    ]) {
      expect(await rulesFiredOn(`import '${name}';\n`), name).toContain('no-restricted-imports');
    }
  });

  it('KM6.1 readFileSync from node:fs is allowed', async () => {
    const fired = await rulesFiredOn(
      "import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n",
    );
    expect(fired).toEqual([]);
  });

  it('KM6.1 the MCP SDK server modules and core through its index are still allowed', async () => {
    const fired = await rulesFiredOn(
      "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';\nimport { schedule } from '../core/index.js';\nexport const x = [McpServer, schedule];\n",
    );
    expect(fired).toEqual([]);
  });
});
