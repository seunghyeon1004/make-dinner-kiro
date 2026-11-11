import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { hasErrors, IssueSchema, schedule, validatePlan } from '../core/index.js';
import type { Issue, Kitchen, Plan, Schedule, ScheduleError } from '../core/index.js';
import { z } from 'zod';
import { planList } from './text.js';

export type ToolErrorCode = ScheduleError['kind'] | 'internal';
export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details: Record<string, unknown>;
}
export type ToolOutcome<T> = { ok: true; data: T; text: string } | { ok: false; error: ToolError };

export const CheckPlanOutputSchema = z.object({
  valid: z.boolean(),
  issues: z.array(IssueSchema),
});

const issueLine = (i: Issue): string => {
  const where =
    ('stepId' in i && i.stepId !== undefined ? i.stepId : undefined) ??
    ('dishId' in i && i.dishId !== undefined ? i.dishId : undefined) ??
    'plan';
  return `${i.severity} ${i.code} ${where}: ${i.message}`;
};

export function toCallToolResult<T extends Record<string, unknown>>(
  outcome: ToolOutcome<T>,
): CallToolResult {
  if (outcome.ok) {
    return {
      structuredContent: outcome.data,
      content: [
        { type: 'text', text: outcome.text },
        { type: 'text', text: JSON.stringify(outcome.data) },
      ],
    };
  }
  const { code, message, details } = outcome.error;
  const lines = Array.isArray(details['issues'])
    ? (details['issues'] as Issue[]).map(issueLine)
    : [];
  return {
    isError: true,
    content: [
      { type: 'text', text: [message, ...lines].join('\n') },
      { type: 'text', text: JSON.stringify({ error: { code, message, ...details } }) },
    ],
  };
}

/** Runs a handler; a throw goes to the log as a stack and comes back as the fixed `internal` error. */
export function guarded(log: (line: string) => void, run: () => CallToolResult): CallToolResult {
  try {
    return run();
  } catch (e) {
    log(`tool call failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return toCallToolResult({
      ok: false,
      error: {
        code: 'internal',
        message: 'The kitchen server failed on this call. Its log has the details.',
        details: {},
      },
    });
  }
}

export function checkPlanTool(plan: unknown): ToolOutcome<z.infer<typeof CheckPlanOutputSchema>> {
  const checked = validatePlan(plan);
  const errors = checked.issues.filter((i) => i.severity === 'error').length;
  const warnings = checked.issues.length - errors;
  const valid = !hasErrors(checked.issues);
  const head = valid
    ? `Valid: ${errors} errors, ${warnings} warnings.`
    : `Not valid: ${errors} errors, ${warnings} warnings.`;
  return {
    ok: true,
    data: { valid, issues: checked.issues },
    text: [head, ...checked.issues.map(issueLine)].join('\n'),
  };
}

const SCHEDULE_ERROR_MESSAGES: Record<ScheduleError['kind'], (n: number) => string> = {
  invalid_plan: (n) => `The plan has ${n} error(s). Fix them, then try again:`,
  invalid_kitchen: () => 'The kitchen is not valid:',
  missing_appliance: () => 'The kitchen lacks an appliance these steps need:',
};

export function schedulePlanTool(plan: unknown, kitchen: Kitchen): ToolOutcome<Schedule> {
  // `schedule` validates whatever it is given and never throws (S1), so an unchecked value is safe.
  const result = schedule(plan as Plan, kitchen);
  if (!result.ok) {
    const { kind, issues } = result.error;
    return {
      ok: false,
      error: {
        code: kind,
        message: SCHEDULE_ERROR_MESSAGES[kind](issues.length),
        details: { issues },
      },
    };
  }
  return { ok: true, data: result.value, text: planList(result.value) };
}
