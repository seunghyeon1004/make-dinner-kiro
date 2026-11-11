import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { connectInProcess } from '../support/mcp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(root, file), 'utf8')) as Record<string, unknown>;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

// slice: only check_plan and schedule_plan are built, so autoApprove lists those two.
describe('workspace registration (KM6.2)', () => {
  it('KM6.2 .kiro/settings/mcp.json registers make-dinner with tsx and auto-approves the tools', async () => {
    const config = readJson('.kiro/settings/mcp.json') as {
      mcpServers: Record<string, { command: string; args: string[]; autoApprove: string[] }>;
    };
    expect(Object.keys(config.mcpServers)).toEqual(['make-dinner']);
    const server = config.mcpServers['make-dinner'];
    expect(server?.command).toBe('npx');
    expect(server?.args).toEqual(['--no-install', 'tsx', 'src/mcp/index.ts']);

    const connected = await connectInProcess();
    close = connected.close;
    const { tools } = await connected.client.listTools();
    expect([...(server?.autoApprove ?? [])].sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it('KM6.2 the mcp script runs src/mcp/index.ts with tsx', () => {
    const pkg = readJson('package.json') as { scripts: Record<string, string> };
    expect(pkg.scripts['mcp']).toBe('tsx src/mcp/index.ts');
  });
});
