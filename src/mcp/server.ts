import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { KitchenSchema, PlanSchema, ScheduleSchema } from '../core/index.js';
import {
  checkPlanTool,
  CheckPlanOutputSchema,
  guarded,
  schedulePlanTool,
  toCallToolResult,
} from './tools.js';
import { z } from 'zod';

export interface KitchenServerDeps {
  log: (line: string) => void;
}

export const SERVER_INFO = { name: 'make-dinner', version: '0.1.0' } as const;
export const MAX_TOOL_INPUT_ELEMENTS = 20_000;

/**
 * A plan may arrive as an object or as a JSON string. Some MCP clients drop empty arrays and
 * nulls from object arguments (seen with Kiro CLI 3.2.0), which breaks `after: []` and
 * `holdMin: null`; a string arrives intact. Text that is not JSON stays a string, and the
 * plan checks then report it as an invalid plan.
 */
function planFromArgument(plan: unknown): unknown {
  if (typeof plan !== 'string') return plan;
  try {
    return JSON.parse(plan) as unknown;
  } catch {
    return plan;
  }
}

const PLAN_AS_STRING = ' The plan may be passed as an object or as a JSON string.';

const ANNOTATIONS = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

/** No I/O until the caller connects a transport. Slice: only check_plan and schedule_plan. */
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

  return server;
}
