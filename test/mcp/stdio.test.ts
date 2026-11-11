import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ScheduleSchema } from '../../src/core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'dist', 'mcp', 'index.js');

describe('stdio entry point (KM6.2, KM8.1)', () => {
  beforeAll(() => {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.mcp.json'], { cwd: root, stdio: 'pipe' });
  }, 120_000);

  it('KM8.1 dist/mcp/index.js lists seven tools, reads the samples and schedules sunday-roast from another directory', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: os.tmpdir(),
      env: { PATH: process.env['PATH'] ?? '' },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        'check_plan',
        'export_dinnerfile',
        'get_sample',
        'import_dinnerfile',
        'list_samples',
        'rebuild_plan',
        'schedule_plan',
      ]);
      const listed = await client.callTool({ name: 'list_samples', arguments: {} });
      const ids = (listed.structuredContent as { samples: { id: string }[] }).samples.map(
        (x) => x.id,
      );
      expect(ids).toEqual([
        'sunday-roast',
        'halloween-party',
        'weeknight-curry',
        'vegetarian-feast',
        'korean-table',
      ]);
      const sample = await client.callTool({
        name: 'get_sample',
        arguments: { id: 'sunday-roast' },
      });
      const { plan, kitchen } = sample.structuredContent as {
        plan: { steps: { id: string }[] };
        kitchen: unknown;
      };
      const result = await client.callTool({
        name: 'schedule_plan',
        arguments: { plan, kitchen },
      });
      const schedule = ScheduleSchema.parse(result.structuredContent);
      expect(schedule.steps.map((s) => s.id).sort()).toEqual(plan.steps.map((s) => s.id).sort());
    } finally {
      await client.close();
    }
    expect(stderr).toBe('make-dinner MCP server ready\n');
  }, 30_000);
});
