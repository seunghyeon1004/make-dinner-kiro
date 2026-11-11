import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  KitchenSchema,
  PlanSchema,
  ProgressSchema,
  RebuiltScheduleSchema,
  RebuiltSchema,
  ScheduleSchema,
} from '../core/index.js';
import type { SampleSource } from './samples.js';
import {
  checkPlanTool,
  CheckPlanOutputSchema,
  exportDinnerfileTool,
  ExportOutputSchema,
  getSampleTool,
  GetSampleInputShape,
  guarded,
  IMPORT_TEXT_MAX,
  importDinnerfileTool,
  ImportOutputSchema,
  listSamplesTool,
  ListSamplesOutputSchema,
  OptionsSchema,
  rebuildPlanTool,
  SampleDetailSchema,
  schedulePlanTool,
  toCallToolResult,
} from './tools.js';
import { z } from 'zod';

export interface KitchenServerDeps {
  samples: SampleSource;
  log: (line: string) => void;
}

export const SERVER_INFO = { name: 'make-dinner', version: '0.1.0' } as const;
export const MAX_TOOL_INPUT_ELEMENTS = 20_000;

/**
 * A plan, a schedule or progress may arrive as an object or as a JSON string. Some MCP clients
 * drop empty arrays and nulls from object arguments (seen with Kiro CLI 3.2.0), which breaks
 * `after: []` and `holdMin: null`; a string arrives intact. Text that is not JSON stays a
 * string, and the core checks then report it as invalid.
 */
function planFromArgument(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

const PLAN_AS_STRING = ' The plan may be passed as an object or as a JSON string.';
const JSON_AS_STRING = ' Each of schedule and progress may be an object or a JSON string.';

const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/** No I/O until the caller connects a transport. */
export function createKitchenServer(deps: KitchenServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO, { maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS });

  server.registerTool(
    'check_plan',
    {
      title: 'Check a plan',
      description:
        'Checks a plan (any JSON value) against the schema and the sanity rules and returns every issue. valid is true when no issue is an error. Use it before schedule_plan.' +
        PLAN_AS_STRING,
      inputSchema: { plan: z.unknown() },
      outputSchema: CheckPlanOutputSchema,
      annotations: ANNOTATIONS,
    },
    ({ plan }) => guarded(deps.log, () => toCallToolResult(checkPlanTool(planFromArgument(plan)))),
  );

  server.registerTool(
    'schedule_plan',
    {
      title: 'Schedule a plan',
      description:
        'Schedules a plan in a kitchen (burners, ovens, cooks) backward from serving. Minute 0 is serving; earlier minutes are negative. Returns every step with start, end, lanes and slack, plus hold warnings. The plan comes from check_plan-valid JSON.' +
        PLAN_AS_STRING,
      inputSchema: { plan: z.union([PlanSchema, z.string()]), kitchen: KitchenSchema },
      outputSchema: ScheduleSchema,
      annotations: ANNOTATIONS,
    },
    ({ plan, kitchen }) =>
      guarded(deps.log, () => toCallToolResult(schedulePlanTool(planFromArgument(plan), kitchen))),
  );

  server.registerTool(
    'rebuild_plan',
    {
      title: 'Rebuild a schedule',
      description:
        'Recomputes a schedule while cooking. Done and running steps (progress) are pinned; pending steps move only as far as they must. now is a minute on the schedule axis (0 is serving, earlier minutes are negative). Returns the new schedule, the new serving minute and what moved. The schedule comes from schedule_plan or an earlier rebuild_plan; progress maps a step id to {state:"done",startMin,endMin} or {state:"running",startMin,extraMin}.' +
        JSON_AS_STRING,
      inputSchema: {
        schedule: z.union([RebuiltScheduleSchema, z.string()]),
        progress: z.union([ProgressSchema, z.string()]),
        now: z.int(),
      },
      outputSchema: RebuiltSchema,
      annotations: ANNOTATIONS,
    },
    ({ schedule, progress, now }) =>
      guarded(deps.log, () =>
        toCallToolResult(
          rebuildPlanTool(planFromArgument(schedule), planFromArgument(progress), now),
        ),
      ),
  );

  server.registerTool(
    'export_dinnerfile',
    {
      title: 'Export a Dinnerfile',
      description:
        'Writes a plan as a Dinnerfile, a Makefile that GNU Make accepts (make -n -f Dinnerfile dinner prints the steps in a valid order) and that import_dinnerfile reads back. options may add the kitchen and the serving time.' +
        PLAN_AS_STRING,
      inputSchema: { plan: z.union([PlanSchema, z.string()]), options: OptionsSchema.optional() },
      outputSchema: ExportOutputSchema,
      annotations: ANNOTATIONS,
    },
    ({ plan, options }) =>
      guarded(deps.log, () =>
        toCallToolResult(exportDinnerfileTool(planFromArgument(plan), options)),
      ),
  );

  server.registerTool(
    'import_dinnerfile',
    {
      title: 'Import a Dinnerfile',
      description:
        'Reads a Dinnerfile (from export_dinnerfile) back into a plan, with the kitchen and serving time if it carries them, and checks the plan. A plan with sanity errors is returned with its issues so it can be fixed and passed to check_plan.',
      inputSchema: { text: z.string().max(IMPORT_TEXT_MAX) },
      outputSchema: ImportOutputSchema,
      annotations: ANNOTATIONS,
    },
    ({ text }) => guarded(deps.log, () => toCallToolResult(importDinnerfileTool(text))),
  );

  server.registerTool(
    'list_samples',
    {
      title: 'List sample dinners',
      description:
        'Lists the built-in sample dinners with id, title, dishes, suggested kitchen and serving time. Pass an id to get_sample.',
      outputSchema: ListSamplesOutputSchema,
      annotations: ANNOTATIONS,
    },
    () => guarded(deps.log, () => toCallToolResult(listSamplesTool(deps.samples))),
  );

  server.registerTool(
    'get_sample',
    {
      title: 'Get a sample dinner',
      description:
        'Returns one sample dinner (id from list_samples) with its recorded plan, the plan issues, the suggested kitchen and the serving time. Pass plan and kitchen to schedule_plan.',
      inputSchema: GetSampleInputShape,
      outputSchema: SampleDetailSchema,
      annotations: ANNOTATIONS,
    },
    ({ id }) => guarded(deps.log, () => toCallToolResult(getSampleTool(deps.samples, id))),
  );

  return server;
}
