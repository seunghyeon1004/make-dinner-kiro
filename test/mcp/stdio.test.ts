import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ScheduleSchema } from '../../src/core/index.js';
import { HOME_KITCHEN, SUNDAY_ROAST } from '../support/fixtures.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'dist', 'mcp', 'index.js');

// slice: only check_plan and schedule_plan are built, and no sample tools, so the plan comes
// from test/support/fixtures.ts.
describe('stdio entry point (KM6.2, KM8.1)', () => {
  beforeAll(() => {
    execFileSync('npx', ['tsc', '-p', 'tsconfig.mcp.json'], { cwd: root, stdio: 'pipe' });
  }, 120_000);

  it('KM8.1 dist/mcp/index.js lists two tools and schedules SUNDAY_ROAST from another directory', async () => {
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
      expect(tools.map((t) => t.name).sort()).toEqual(['check_plan', 'schedule_plan']);
      const result = await client.callTool({
        name: 'schedule_plan',
        arguments: { plan: SUNDAY_ROAST, kitchen: HOME_KITCHEN },
      });
      const schedule = ScheduleSchema.parse(result.structuredContent);
      expect(schedule.steps.map((s) => s.id).sort()).toEqual(
        SUNDAY_ROAST.steps.map((s) => s.id).sort(),
      );
      expect(schedule.spanMin).toBe(110);
    } finally {
      await client.close();
    }
    expect(stderr).toBe('make-dinner MCP server ready\n');
  }, 30_000);
});
