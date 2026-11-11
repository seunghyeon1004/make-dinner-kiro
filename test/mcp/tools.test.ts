import { afterEach, describe, expect, it } from 'vitest';
import type { Plan } from '../../src/core/index.js';
import { planList } from '../../src/mcp/text.js';
import {
  BURNER_ONLY_KITCHEN,
  H1_SCHEDULE,
  HOME_KITCHEN,
  SUNDAY_ROAST,
} from '../support/fixtures.js';
import { connectInProcess, textsOf } from '../support/mcp.js';

type Connected = Awaited<ReturnType<typeof connectInProcess>>;
let connected: Connected | undefined;
const open = async (): Promise<Connected['client']> => {
  connected = await connectInProcess();
  return connected.client;
};
afterEach(async () => {
  await connected?.close();
  connected = undefined;
});

const withStep = (patch: (steps: Plan['steps']) => Plan['steps']): Plan => ({
  ...SUNDAY_ROAST,
  steps: patch(SUNDAY_ROAST.steps),
});
// chicken.prep waits for chicken.carve, which (transitively) waits for chicken.prep: a cycle.
const CYCLE_PLAN = withStep((steps) =>
  steps.map((s) => (s.id === 'chicken.prep' ? { ...s, after: ['chicken.carve'] } : s)),
);
const UNKNOWN_DEP_PLAN = withStep((steps) =>
  steps.map((s) => (s.id === 'chicken.prep' ? { ...s, after: ['chicken.nope'] } : s)),
);

describe('kitchen server (slice: only check_plan and schedule_plan are built)', () => {
  it('KM1.1 tools/list has exactly check_plan and schedule_plan, each fully described', async () => {
    const client = await open();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['check_plan', 'schedule_plan']);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.outputSchema?.type).toBe('object');
    }
    const schedule = tools.find((t) => t.name === 'schedule_plan');
    expect(schedule?.inputSchema.required).toEqual(['plan', 'kitchen']);
  });

  it('KM2.1 check_plan on SUNDAY_ROAST is valid with no errors', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'check_plan',
      arguments: { plan: SUNDAY_ROAST },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ valid: true, issues: [] });
  });

  it('KM2.1 check_plan reports an unknown dependency with its code and step id', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'check_plan',
      arguments: { plan: UNKNOWN_DEP_PLAN },
    });
    const out = result.structuredContent as { valid: boolean; issues: Record<string, unknown>[] };
    expect(out.valid).toBe(false);
    const issue = out.issues.find((i) => i['code'] === 'unknown_dependency');
    expect(issue?.['stepId']).toBe('chicken.prep');
    expect(issue?.['ref']).toBe('chicken.nope');
  });

  it('KM2.1 check_plan on 42 is not valid and does not throw', async () => {
    const client = await open();
    const result = await client.callTool({ name: 'check_plan', arguments: { plan: 42 } });
    const out = result.structuredContent as { valid: boolean; issues: unknown[] };
    expect(out.valid).toBe(false);
    expect(out.issues.length).toBeGreaterThan(0);
  });

  it('KM2.2 / KM1.3 schedule_plan(SUNDAY_ROAST, HOME_KITCHEN) equals H1_SCHEDULE, with text then JSON', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'schedule_plan',
      arguments: { plan: SUNDAY_ROAST, kitchen: HOME_KITCHEN },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(H1_SCHEDULE);
    const [summary, json] = textsOf(result);
    expect(summary).toBe(planList(H1_SCHEDULE));
    expect(JSON.parse(json ?? 'null')).toEqual(H1_SCHEDULE);
  });

  it('KM2.2 / KM3.1 schedule_plan with BURNER_ONLY_KITCHEN is missing_appliance for chicken.roast', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'schedule_plan',
      arguments: { plan: SUNDAY_ROAST, kitchen: BURNER_ONLY_KITCHEN },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const [message, json] = textsOf(result);
    expect(message?.startsWith('The kitchen lacks an appliance these steps need:')).toBe(true);
    const error = (JSON.parse(json ?? 'null') as { error: { code: string; issues: unknown[] } })
      .error;
    expect(error.code).toBe('missing_appliance');
    expect(JSON.stringify(error.issues)).toContain('chicken.roast');
  });

  it('KM2.2 / KM3.1 schedule_plan on a cycle is invalid_plan with a cycle issue', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'schedule_plan',
      arguments: { plan: CYCLE_PLAN, kitchen: HOME_KITCHEN },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const [message, json] = textsOf(result);
    expect(message?.startsWith('The plan has ')).toBe(true);
    const error = (
      JSON.parse(json ?? 'null') as { error: { code: string; issues: { code: string }[] } }
    ).error;
    expect(error.code).toBe('invalid_plan');
    expect(error.issues.map((i) => i.code)).toContain('cycle');
  });

  it('KM3.3 a kitchen with 9 burners gives the SDK input validation error', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'schedule_plan',
      arguments: { plan: SUNDAY_ROAST, kitchen: { burners: 9, ovens: 1, cooks: 1 } },
    });
    expect(result.isError).toBe(true);
    expect(textsOf(result)).toHaveLength(1);
    expect(textsOf(result)[0]).toContain('Input validation error');
  });

  it('KM3.1 an unknown tool is an isError result, not a thrown protocol error', async () => {
    const client = await open();
    const result = await client.callTool({ name: 'nope', arguments: {} });
    expect(result.isError).toBe(true);
  });

  it('KM6.1 two equal calls give deep-equal results', async () => {
    const client = await open();
    const args = { plan: SUNDAY_ROAST, kitchen: HOME_KITCHEN };
    const a = await client.callTool({ name: 'schedule_plan', arguments: args });
    const b = await client.callTool({ name: 'schedule_plan', arguments: args });
    expect(b).toEqual(a);
  });
  // Added by hand after the first real use from a Kiro session: Kiro's MCP client dropped the
  // empty `after: []` lists and `holdMin: null` values of a plan passed as an object, so the
  // plan never arrived intact (docs/kiro-evidence/mcp-use-session.txt). A JSON string survives.
  it('accepts the plan as a JSON string in schedule_plan and gives the same schedule', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'schedule_plan',
      arguments: { plan: JSON.stringify(SUNDAY_ROAST), kitchen: HOME_KITCHEN },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(H1_SCHEDULE);
  });

  it('accepts the plan as a JSON string in check_plan', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'check_plan',
      arguments: { plan: JSON.stringify(SUNDAY_ROAST) },
    });
    expect(result.structuredContent).toEqual({ valid: true, issues: [] });
  });

  it('a plan string that is not JSON is an invalid_plan error, not a throw', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'schedule_plan',
      arguments: { plan: '{not json', kitchen: HOME_KITCHEN },
    });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textsOf(result)[1] ?? 'null')).toMatchObject({
      error: { code: 'invalid_plan' },
    });
  });
});
