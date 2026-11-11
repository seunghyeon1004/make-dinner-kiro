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

describe('README section (KM6.3)', () => {
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const start = readme.indexOf('## Use the scheduler from your MCP client');
  const end = readme.indexOf('\n## ', start + 1);
  const section = start === -1 ? '' : readme.slice(start, end === -1 ? undefined : end);

  it('KM6.3 has the section, naming npm run build, dist/mcp/index.js and an absolute path', () => {
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain('npm run build');
    expect(section).toContain('dist/mcp/index.js');
    expect(section).toContain('"command": "node"');
    expect(section).toContain('/absolute/path/to/makedinner/dist/mcp/index.js');
  });

  it('KM6.3 names all seven tools and no longer calls itself a slice', () => {
    for (const tool of [
      'check_plan',
      'schedule_plan',
      'rebuild_plan',
      'export_dinnerfile',
      'import_dinnerfile',
      'list_samples',
      'get_sample',
    ]) {
      expect(section, tool).toContain(`\`${tool}\``);
    }
    expect(section).not.toContain('slice');
    expect(readme).not.toContain('The scheduler as an MCP tool');
  });
});

// Added by hand with .kiro/agents/taster.json (the builder agent cannot write under .kiro/agents).
describe('the taster agent (KM7.1, KM7.2)', () => {
  const agent = JSON.parse(readFileSync(path.join(root, '.kiro/agents/taster.json'), 'utf8')) as {
    tools: string[];
    allowedTools: string[];
    includeMcpJson: boolean;
    prompt: string;
    permissions: { rules: { capability: string; match: string[]; effect: string }[] };
    hooks?: unknown;
  };

  it('KM7.1 can only read and call the make-dinner server', () => {
    expect(agent.tools).toEqual(['read', '@make-dinner']);
    expect(agent.allowedTools).toEqual(['read', '@make-dinner']);
    expect(agent.includeMcpJson).toBe(true);
    expect(agent.hooks).toBeUndefined();
    expect(agent.permissions.rules).toEqual([
      { capability: 'fs_write', match: ['**'], effect: 'deny' },
      { capability: 'shell', match: ['*'], effect: 'deny' },
    ]);
  });

  it('KM7.2 the prompt names the three kitchens and the three checks', () => {
    for (const word of ['K1', 'K2', 'K3', 'hold_exceeded', 'double-booked', 'more than 4 hours']) {
      expect(agent.prompt).toContain(word);
    }
    expect(agent.prompt).toContain('never call a schedule optimal');
  });
});
