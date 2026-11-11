import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { Plan } from '../../src/core/index.js';
import { canonicalPlan } from '../../src/core/schema.js';
import { planList } from '../../src/mcp/text.js';
import {
  BURNER_ONLY_KITCHEN,
  H1_SCHEDULE,
  HOME_KITCHEN,
  RB_A_NOW,
  RB_A_PROGRESS,
  SUNDAY_ROAST,
  SUNDAY_ROAST_DINNERFILE,
} from '../support/fixtures.js';
import { connectInProcess, memorySamples, textsOf, throwingSamples } from '../support/mcp.js';

type Connected = Awaited<ReturnType<typeof connectInProcess>>;
let connected: Connected | undefined;
const open = async (
  deps: Parameters<typeof connectInProcess>[0] = {},
): Promise<Connected['client']> => {
  connected = await connectInProcess(deps);
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

describe('kitchen server', () => {
  it('KM1.1 tools/list has exactly the seven tools, each fully described with its required inputs', async () => {
    const client = await open();
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
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.outputSchema?.type).toBe('object');
    }
    const required = (name: string): string[] | undefined =>
      tools.find((t) => t.name === name)?.inputSchema.required;
    expect(required('check_plan')).toEqual(['plan']);
    expect(required('schedule_plan')).toEqual(['plan', 'kitchen']);
    expect(required('rebuild_plan')).toEqual(['schedule', 'progress', 'now']);
    expect(required('export_dinnerfile')).toEqual(['plan']);
    expect(required('import_dinnerfile')).toEqual(['text']);
    expect(required('list_samples') ?? []).toEqual([]);
    expect(required('get_sample')).toEqual(['id']);
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

  // Kiro's client drops empty arrays and nulls from object arguments, so schedule and progress
  // also arrive as JSON strings (docs/kiro-evidence/mcp-use-session.txt).
  it('accepts the schedule as a JSON string in rebuild_plan and gives the same result', async () => {
    const client = await open();
    const asObject = await client.callTool({
      name: 'rebuild_plan',
      arguments: { schedule: H1_SCHEDULE, progress: RB_A_PROGRESS, now: RB_A_NOW },
    });
    const asString = await client.callTool({
      name: 'rebuild_plan',
      arguments: {
        schedule: JSON.stringify(H1_SCHEDULE),
        progress: RB_A_PROGRESS,
        now: RB_A_NOW,
      },
    });
    expect(asString.isError).toBeUndefined();
    expect(asString.structuredContent).toEqual(asObject.structuredContent);
  });

  it('accepts the progress as a JSON string in rebuild_plan and gives the same result', async () => {
    const client = await open();
    const asObject = await client.callTool({
      name: 'rebuild_plan',
      arguments: { schedule: H1_SCHEDULE, progress: RB_A_PROGRESS, now: RB_A_NOW },
    });
    const asString = await client.callTool({
      name: 'rebuild_plan',
      arguments: {
        schedule: H1_SCHEDULE,
        progress: JSON.stringify(RB_A_PROGRESS),
        now: RB_A_NOW,
      },
    });
    expect(asString.isError).toBeUndefined();
    expect(asString.structuredContent).toEqual(asObject.structuredContent);
  });

  it('accepts the plan as a JSON string in export_dinnerfile', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'export_dinnerfile',
      arguments: { plan: JSON.stringify(SUNDAY_ROAST) },
    });
    expect(result.structuredContent).toEqual({ dinnerfile: SUNDAY_ROAST_DINNERFILE });
  });
});

const rebuildCall = async (
  client: Awaited<ReturnType<typeof open>>,
  args: Record<string, unknown>,
) => {
  const result = await client.callTool({ name: 'rebuild_plan', arguments: args });
  const json = JSON.parse(textsOf(result)[1] ?? 'null') as {
    error?: { code: string } & Record<string, unknown>;
  };
  return { result, message: textsOf(result)[0], error: json.error };
};

describe('rebuild_plan (KM2.3)', () => {
  it('KM2.3 RB-a: the roast needs 15 more minutes at -60 gives the hand-worked rebuild', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'rebuild_plan',
      arguments: { schedule: H1_SCHEDULE, progress: RB_A_PROGRESS, now: RB_A_NOW },
    });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as {
      schedule: {
        servingMin: number;
        spanMin: number;
        steps: { id: string; startMin: number; endMin: number }[];
      };
      diff: {
        servingShiftMin: number;
        moved: { stepId: string; fromStartMin: number; toStartMin: number }[];
      };
    };
    // Worked out by hand in the rebuild design (fixtures.ts, RB-a).
    expect(out.schedule.servingMin).toBe(15);
    expect(out.schedule.spanMin).toBe(125);
    expect(out.diff.servingShiftMin).toBe(15);
    expect(out.diff.moved.toSorted((a, b) => (a.stepId < b.stepId ? -1 : 1))).toEqual([
      { stepId: 'chicken.carve', fromStartMin: -5, toStartMin: 10 },
      { stepId: 'chicken.rest', fromStartMin: -25, toStartMin: -10 },
      { stepId: 'gravy.roux', fromStartMin: -20, toStartMin: -4 },
      { stepId: 'gravy.simmer', fromStartMin: -18, toStartMin: -2 },
      { stepId: 'gravy.strain', fromStartMin: -8, toStartMin: 8 },
      { stepId: 'greens.boil', fromStartMin: -10, toStartMin: 3 },
      { stepId: 'greens.toss', fromStartMin: -6, toStartMin: 7 },
    ]);
    const roast = out.schedule.steps.find((s) => s.id === 'chicken.roast');
    expect([roast?.startMin, roast?.endMin]).toEqual([-100, -10]);
    const [text, json] = textsOf(result);
    expect(text?.split('\n').slice(0, 2)).toEqual([
      'Serving moves 15 min later, to minute 15.',
      'Moved: chicken.carve -5 to 10, chicken.rest -25 to -10, gravy.roux -20 to -4, gravy.simmer -18 to -2, gravy.strain -8 to 8, greens.boil -10 to 3, greens.toss -6 to 7.',
    ]);
    expect(JSON.parse(json ?? 'null')).toEqual(result.structuredContent);
  });

  it('KM5.2 RB-a: pinned steps read done and running in place of the slack mark', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'rebuild_plan',
      arguments: { schedule: H1_SCHEDULE, progress: RB_A_PROGRESS, now: RB_A_NOW },
    });
    const lines = textsOf(result)[0]?.split('\n') ?? [];
    expect(lines).toContain(
      '-110 to -100  chicken.prep  Season and truss the chicken  Cook 1  done',
    );
    expect(lines).toContain('-100 to -10  chicken.roast  Roast the chicken  Oven 1  running');
    // Minutes after serving print without a sign; the toss ends at 8 and waits 7 for a hold of 5.
    const toss = lines.find((l) => l.startsWith('7 to 8'));
    expect(toss?.startsWith('7 to 8  greens.toss  ')).toBe(true);
    expect(toss?.endsWith(', waits 7 min (hold 5 min)')).toBe(true);
    expect(lines.filter((l) => l.startsWith('Warning: '))).toHaveLength(1);
  });

  it('KM2.3 the rebuilt schedule is accepted back, and a rebuild with no slip moves nothing', async () => {
    const client = await open();
    const first = await client.callTool({
      name: 'rebuild_plan',
      arguments: { schedule: H1_SCHEDULE, progress: RB_A_PROGRESS, now: RB_A_NOW },
    });
    const rebuilt = (first.structuredContent as { schedule: unknown }).schedule;
    const second = await client.callTool({
      name: 'rebuild_plan',
      arguments: {
        schedule: rebuilt,
        progress: {
          ...RB_A_PROGRESS,
          'chicken.roast': { state: 'running', startMin: -100, extraMin: 0 },
        },
        now: RB_A_NOW,
      },
    });
    expect(second.isError).toBeUndefined();
    const out = second.structuredContent as {
      diff: { moved: unknown[] };
      schedule: { servingMin: number };
    };
    expect(out.diff.moved).toEqual([]);
    expect(out.schedule.servingMin).toBe(15);
    expect(textsOf(second)[0]?.split('\n').slice(0, 2)).toEqual([
      'Serving stays at minute 15.',
      'Moved: none.',
    ]);
  });

  it('KM2.3 invalid_schedule with reason step_ids when the rows do not match the plan', async () => {
    const client = await open();
    const { result, message, error } = await rebuildCall(client, {
      schedule: { ...H1_SCHEDULE, steps: H1_SCHEDULE.steps.slice(1) },
      progress: {},
      now: -60,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(message).toBe('The schedule is not valid (step_ids).');
    expect(error).toEqual({
      code: 'invalid_schedule',
      message: 'The schedule is not valid (step_ids).',
      reason: 'step_ids',
      issues: [],
    });
  });

  it('KM2.3 invalid_schedule with reason shape when the schedule string is not JSON', async () => {
    const client = await open();
    const { error } = await rebuildCall(client, { schedule: '{nope', progress: {}, now: -60 });
    expect(error?.code).toBe('invalid_schedule');
    expect(error?.['reason']).toBe('shape');
  });

  it('KM2.3 invalid_now when now is far outside the axis', async () => {
    const client = await open();
    const { result, message, error } = await rebuildCall(client, {
      schedule: H1_SCHEDULE,
      progress: {},
      now: -100_000_000,
    });
    expect(result.isError).toBe(true);
    expect(message).toBe('now is outside the minutes rebuild accepts for this schedule.');
    expect(error).toEqual({
      code: 'invalid_now',
      message: 'now is outside the minutes rebuild accepts for this schedule.',
    });
  });

  it('KM2.3 invalid_progress when the progress string is not JSON', async () => {
    const client = await open();
    const { message, error } = await rebuildCall(client, {
      schedule: H1_SCHEDULE,
      progress: '{nope',
      now: -60,
    });
    expect(message).toBe('The progress is not valid.');
    expect(error?.code).toBe('invalid_progress');
  });

  it('KM2.3 unknown_step names the step', async () => {
    const client = await open();
    const { message, error } = await rebuildCall(client, {
      schedule: H1_SCHEDULE,
      progress: { 'chicken.nope': { state: 'done', startMin: -110, endMin: -100 } },
      now: -60,
    });
    expect(message).toBe('Progress names step chicken.nope, which is not in the schedule.');
    expect(error).toEqual({
      code: 'unknown_step',
      message: 'Progress names step chicken.nope, which is not in the schedule.',
      stepId: 'chicken.nope',
    });
  });

  it('KM2.3 done_ends_before_start names the step', async () => {
    const client = await open();
    const { message, error } = await rebuildCall(client, {
      schedule: H1_SCHEDULE,
      progress: { 'chicken.prep': { state: 'done', startMin: -100, endMin: -110 } },
      now: -60,
    });
    expect(message).toBe('Step chicken.prep is done but ends before it starts.');
    expect(error?.code).toBe('done_ends_before_start');
    expect(error?.['stepId']).toBe('chicken.prep');
  });

  it('KM2.3 done_after_now names the step', async () => {
    const client = await open();
    const { message, error } = await rebuildCall(client, {
      schedule: H1_SCHEDULE,
      progress: { 'chicken.prep': { state: 'done', startMin: -110, endMin: -50 } },
      now: -60,
    });
    expect(message).toBe('Step chicken.prep is done but ends after now.');
    expect(error?.code).toBe('done_after_now');
    expect(error?.['stepId']).toBe('chicken.prep');
  });

  it('KM2.3 running_starts_after_now names the step', async () => {
    const client = await open();
    const { message, error } = await rebuildCall(client, {
      schedule: H1_SCHEDULE,
      progress: { 'chicken.roast': { state: 'running', startMin: -50, extraMin: 0 } },
      now: -60,
    });
    expect(message).toBe('Step chicken.roast is running but starts after now.');
    expect(error?.code).toBe('running_starts_after_now');
    expect(error?.['stepId']).toBe('chicken.roast');
  });

  it('KM2.3 serving_out_of_range when the slip would move serving past a day', async () => {
    const client = await open();
    // The roast starts at minute 100 and needs 1,440 more: carve ends at 100 + 75 + 1440 + 20 + 5.
    const { message, error } = await rebuildCall(client, {
      schedule: H1_SCHEDULE,
      progress: { 'chicken.roast': { state: 'running', startMin: 100, extraMin: 1440 } },
      now: 100,
    });
    expect(message).toBe('Serving would move to minute 1640, more than a day after the plan.');
    expect(error?.code).toBe('serving_out_of_range');
    expect(error?.['servingMin']).toBe(1640);
  });
});

describe('Dinnerfile tools (KM2.4, KM2.5)', () => {
  it('KM2.4 export_dinnerfile(SUNDAY_ROAST) gives SUNDAY_ROAST_DINNERFILE, with the summary and the file', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'export_dinnerfile',
      arguments: { plan: SUNDAY_ROAST },
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ dinnerfile: SUNDAY_ROAST_DINNERFILE });
    expect(textsOf(result)[0]).toBe(
      `Dinnerfile for "Sunday roast" (10 steps). Check it with make -n -f Dinnerfile dinner.\n\n${SUNDAY_ROAST_DINNERFILE}`,
    );
  });

  it('KM2.4 options add the # kitchen and # serve lines', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'export_dinnerfile',
      arguments: { plan: SUNDAY_ROAST, options: { kitchen: HOME_KITCHEN, serve: '13:30' } },
    });
    const file = (result.structuredContent as { dinnerfile: string }).dinnerfile;
    const lines = file.split('\n');
    expect(lines).toContain('# kitchen burners=4 ovens=1 cooks=1');
    expect(lines).toContain('# serve 13:30');
  });

  it('KM2.4 a plan that fails the schema (sent as a JSON string) is invalid_plan with the issues', async () => {
    const client = await open();
    const zeroMinutes = {
      ...SUNDAY_ROAST,
      steps: SUNDAY_ROAST.steps.map((s) => (s.id === 'chicken.prep' ? { ...s, minutes: 0 } : s)),
    };
    const result = await client.callTool({
      name: 'export_dinnerfile',
      arguments: { plan: JSON.stringify(zeroMinutes) },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const error = (
      JSON.parse(textsOf(result)[1] ?? 'null') as {
        error: { code: string; issues: { code: string }[] };
      }
    ).error;
    expect(error.code).toBe('invalid_plan');
    expect(error.issues.length).toBeGreaterThan(0);
    expect(textsOf(result)[0]?.startsWith(`The plan has ${error.issues.length} error(s)`)).toBe(
      true,
    );
  });

  it('KM2.5 import_dinnerfile reads the export back to the plan, with options and no issues', async () => {
    const client = await open();
    const exported = await client.callTool({
      name: 'export_dinnerfile',
      arguments: { plan: SUNDAY_ROAST, options: { kitchen: HOME_KITCHEN, serve: '13:30' } },
    });
    const text = (exported.structuredContent as { dinnerfile: string }).dinnerfile;
    const result = await client.callTool({ name: 'import_dinnerfile', arguments: { text } });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      plan: canonicalPlan(SUNDAY_ROAST),
      options: { kitchen: HOME_KITCHEN, serve: '13:30' },
      issues: [],
    });
    expect(textsOf(result)[0]).toBe(
      'Imported "Sunday roast": 3 dishes, 10 steps, 0 errors, 0 warnings.',
    );
  });

  it('KM2.5 a Dinnerfile without its # plan line is invalid_dinnerfile with missing_plan on line null', async () => {
    const client = await open();
    const text = SUNDAY_ROAST_DINNERFILE.split('\n')
      .filter((l) => !l.startsWith('# plan '))
      .join('\n');
    const result = await client.callTool({ name: 'import_dinnerfile', arguments: { text } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const error = (
      JSON.parse(textsOf(result)[1] ?? 'null') as {
        error: { code: string; errors: Record<string, unknown>[] };
      }
    ).error;
    expect(error.code).toBe('invalid_dinnerfile');
    expect(error.errors.find((e) => e['code'] === 'missing_plan')).toMatchObject({ line: null });
    expect(
      textsOf(result)[0]?.startsWith(`The Dinnerfile has ${error.errors.length} error(s):`),
    ).toBe(true);
  });

  it('KM2.5 one broken line is reported with its line number', async () => {
    const client = await open();
    const lines = SUNDAY_ROAST_DINNERFILE.split('\n');
    const at = lines.indexOf('chicken.rest: chicken.roast');
    lines[at] = 'chicken.rest : chicken.roast';
    const result = await client.callTool({
      name: 'import_dinnerfile',
      arguments: { text: lines.join('\n') },
    });
    expect(result.isError).toBe(true);
    const error = (
      JSON.parse(textsOf(result)[1] ?? 'null') as { error: { errors: Record<string, unknown>[] } }
    ).error;
    expect(error.errors.find((e) => e['line'] === at + 1)).toMatchObject({
      code: 'unsupported_line',
      reason: 'space_before_colon',
    });
    expect(textsOf(result)[0]).toContain(`Line ${at + 1}: `);
  });

  it('KM2.5 a plan that parses but breaks a sanity rule is a success carrying the error issue', async () => {
    const client = await open();
    // chicken.prep now waits for chicken.rest, which waits (through roast) for prep: a cycle.
    // The terminal steps stay the same, so the dinner rule still matches.
    const text = SUNDAY_ROAST_DINNERFILE.replace('chicken.prep:\n', 'chicken.prep: chicken.rest\n');
    const result = await client.callTool({ name: 'import_dinnerfile', arguments: { text } });
    expect(result.isError).toBeUndefined();
    const out = result.structuredContent as { issues: { code: string; severity: string }[] };
    expect(out.issues.map((i) => i.code)).toEqual(['cycle']);
    expect(textsOf(result)[0]?.split('\n')[0]).toBe(
      'Imported "Sunday roast": 3 dishes, 10 steps, 1 error, 0 warnings.',
    );
  });

  it('KM2.5 a step the plan schema rejects is invalid_plan', async () => {
    const client = await open();
    const text = SUNDAY_ROAST_DINNERFILE.replaceAll('"Carve the chicken"', `"${'a'.repeat(130)}"`);
    const result = await client.callTool({ name: 'import_dinnerfile', arguments: { text } });
    expect(result.isError).toBe(true);
    const error = (
      JSON.parse(textsOf(result)[1] ?? 'null') as { error: { code: string; message: string } }
    ).error;
    expect(error.code).toBe('invalid_plan');
    expect(error.message).toBe("The Dinnerfile's steps fail the plan schema:");
  });
});

// Index and recording written by the test: the recipe text is already normalised, so the hash of
// the file is the hash of the normalised text.
const RECIPE = 'Roast the chicken. Make gravy. Cook the greens.';
const sampleFiles = (): Record<string, string> => ({
  'samples/index.json': JSON.stringify([
    {
      id: 'sunday-roast',
      title: 'Sunday roast',
      blurb: 'Chicken, gravy and greens.',
      dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
      kitchen: HOME_KITCHEN,
      servingTime: '13:30',
    },
  ]),
  'samples/sunday-roast.md': RECIPE,
  'recordings/sunday-roast.json': JSON.stringify({
    sampleId: 'sunday-roast',
    textSha256: createHash('sha256').update(RECIPE, 'utf8').digest('hex'),
    model: 'test-model',
    recordedAt: '2026-01-01T00:00:00.000Z',
    raw: SUNDAY_ROAST,
  }),
});

describe('sample tools (KM2.6, KM3.1, KM3.2, KM4.2, KM6.1)', () => {
  it('KM2.6 list_samples gives the index entries and one line each', async () => {
    const client = await open({ samples: memorySamples(sampleFiles()) });
    const result = await client.callTool({ name: 'list_samples', arguments: {} });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      samples: [
        {
          id: 'sunday-roast',
          title: 'Sunday roast',
          dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
          kitchen: { burners: 4, ovens: 1, cooks: 1 },
          servingTime: '13:30',
        },
      ],
    });
    expect(textsOf(result)[0]).toBe(
      'sunday-roast: Sunday roast (Roast chicken; Gravy; Spring greens). Kitchen: 4 burners, 1 oven, 1 cook. Serving 13:30.',
    );
  });

  it('KM4.2 list_samples without an index is samples_unavailable', async () => {
    const client = await open({ samples: memorySamples({}) });
    const result = await client.callTool({ name: 'list_samples', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(textsOf(result)[0]).toBe('samples/index.json is missing.');
    expect(JSON.parse(textsOf(result)[1] ?? 'null')).toEqual({
      error: {
        code: 'samples_unavailable',
        message: 'samples/index.json is missing.',
        problem: 'samples/index.json is missing.',
      },
    });
  });

  it('KM2.6 get_sample gives the entry, the recorded plan and its issues', async () => {
    const client = await open({ samples: memorySamples(sampleFiles()) });
    const result = await client.callTool({ name: 'get_sample', arguments: { id: 'sunday-roast' } });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      id: 'sunday-roast',
      title: 'Sunday roast',
      dishes: ['Roast chicken', 'Gravy', 'Spring greens'],
      kitchen: { burners: 4, ovens: 1, cooks: 1 },
      servingTime: '13:30',
      plan: SUNDAY_ROAST,
      issues: [],
    });
    expect(textsOf(result)[0]).toBe(
      'Sunday roast (sunday-roast): 3 dishes, 10 steps. Suggested kitchen: 4 burners, 1 oven, 1 cook. Serving 13:30.',
    );
  });

  it('KM4.2 get_sample for an unlisted id is not_found', async () => {
    const client = await open({ samples: memorySamples(sampleFiles()) });
    const result = await client.callTool({ name: 'get_sample', arguments: { id: 'nope' } });
    expect(result.isError).toBe(true);
    expect(textsOf(result)[0]).toBe('There is no sample nope. Call list_samples for the ids.');
    expect(JSON.parse(textsOf(result)[1] ?? 'null')).toEqual({
      error: {
        code: 'not_found',
        message: 'There is no sample nope. Call list_samples for the ids.',
        id: 'nope',
      },
    });
  });

  it('KM4.2 get_sample without its recording is sample_unavailable', async () => {
    const files = sampleFiles();
    delete files['recordings/sunday-roast.json'];
    const client = await open({ samples: memorySamples(files) });
    const result = await client.callTool({ name: 'get_sample', arguments: { id: 'sunday-roast' } });
    expect(result.isError).toBe(true);
    const error = (JSON.parse(textsOf(result)[1] ?? 'null') as { error: Record<string, unknown> })
      .error;
    expect(error['code']).toBe('sample_unavailable');
    expect(error['id']).toBe('sunday-roast');
    expect(error['problem']).toBe(
      "recordings/sunday-roast.json is missing. Run npm run record (needs the user's key).",
    );
  });

  it('KM3.2 a throwing source is internal with a fixed message, and the stack goes to the log only', async () => {
    const logged: string[] = [];
    const client = await open({ samples: throwingSamples(), log: (l) => logged.push(l) });
    for (const name of ['list_samples', 'get_sample']) {
      const result = await client.callTool({
        name,
        arguments: name === 'get_sample' ? { id: 'sunday-roast' } : {},
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      const texts = textsOf(result);
      expect(texts[0]).toBe('The kitchen server failed on this call. Its log has the details.');
      expect(JSON.parse(texts[1] ?? 'null')).toEqual({
        error: {
          code: 'internal',
          message: 'The kitchen server failed on this call. Its log has the details.',
        },
      });
      for (const t of texts) {
        expect(t).not.toContain('/');
        expect(t).not.toContain('    at ');
        expect(t).not.toContain('EIO');
      }
    }
    expect(logged).toHaveLength(2);
    expect(logged[0]).toContain('EIO');
    expect(logged[0]).toContain('    at ');
  });

  it('KM6.1 arguments of 20,001 elements are rejected with isError', async () => {
    const client = await open();
    const result = await client.callTool({
      name: 'check_plan',
      arguments: { plan: new Array<number>(20_001).fill(0) },
    });
    expect(result.isError).toBe(true);
  });
});
