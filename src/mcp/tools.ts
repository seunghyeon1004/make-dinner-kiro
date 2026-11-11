import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  DishIdSchema,
  hasErrors,
  IssueSchema,
  KitchenSchema,
  PlanSchema,
  fromDinnerfile,
  rebuild,
  schedule,
  ServeTimeSchema,
  toDinnerfile,
  validatePlan,
} from '../core/index.js';
import type {
  DinnerfileError,
  DinnerfileOptions,
  Issue,
  Kitchen,
  Plan,
  Progress,
  RebuildError,
  Rebuilt,
  Schedule,
  ScheduleError,
} from '../core/index.js';
import { z } from 'zod';
import { getSample, listSamples } from './samples.js';
import type { SampleDetail, SampleSource, SampleSummary } from './samples.js';
import {
  exportText,
  getSampleText,
  importText,
  issueLine,
  listSamplesText,
  planList,
  rebuildText,
} from './text.js';
import type { ToolError, ToolErrorCode } from './errors.js';

export type { ToolError, ToolErrorCode };
export type ToolOutcome<T> = { ok: true; data: T; text: string } | { ok: false; error: ToolError };

export const CheckPlanOutputSchema = z.object({
  valid: z.boolean(),
  issues: z.array(IssueSchema),
});

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
  const issues = Array.isArray(details['issues']) ? (details['issues'] as Issue[]) : [];
  const errors = Array.isArray(details['errors']) ? (details['errors'] as DinnerfileError[]) : [];
  const lines = [
    ...issues.map(issueLine),
    ...errors.map((e) => (e.line === null ? e.message : `Line ${e.line}: ${e.message}`)),
  ];
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

const REBUILD_MESSAGES: Record<RebuildError['kind'], (e: never) => string> = {
  invalid_schedule: (e: Extract<RebuildError, { kind: 'invalid_schedule' }>) =>
    `The schedule is not valid (${e.reason}).`,
  invalid_now: () => 'now is outside the minutes rebuild accepts for this schedule.',
  invalid_progress: () => 'The progress is not valid.',
  unknown_step: (e: { stepId: string }) =>
    `Progress names step ${e.stepId}, which is not in the schedule.`,
  done_ends_before_start: (e: { stepId: string }) =>
    `Step ${e.stepId} is done but ends before it starts.`,
  done_after_now: (e: { stepId: string }) => `Step ${e.stepId} is done but ends after now.`,
  running_starts_after_now: (e: { stepId: string }) =>
    `Step ${e.stepId} is running but starts after now.`,
  serving_out_of_range: (e: { servingMin: number }) =>
    `Serving would move to minute ${e.servingMin}, more than a day after the plan.`,
};

export function rebuildPlanTool(
  scheduleArg: unknown,
  progress: unknown,
  now: number,
): ToolOutcome<Rebuilt> {
  // `rebuild` parses both arguments itself and never throws on any value, so unchecked values
  // (for example text that was not JSON) come back as a typed error.
  const result = rebuild(scheduleArg as Schedule, progress as Progress, now);
  if (!result.ok) {
    const { kind, ...details } = result.error;
    return {
      ok: false,
      error: {
        code: kind,
        message: (REBUILD_MESSAGES[kind] as (e: RebuildError) => string)(result.error),
        details,
      },
    };
  }
  return {
    ok: true,
    data: result.value,
    text: rebuildText(result.value, progress as Progress),
  };
}

export const OptionsSchema = z.strictObject({
  kitchen: KitchenSchema.optional(),
  serve: ServeTimeSchema.optional(),
});
export const ExportOutputSchema = z.object({ dinnerfile: z.string() });
export const ImportOutputSchema = z.object({
  plan: PlanSchema,
  options: OptionsSchema,
  issues: z.array(IssueSchema),
});
export const IMPORT_TEXT_MAX = 1_000_000;

export function exportDinnerfileTool(
  plan: unknown,
  options: z.infer<typeof OptionsSchema> | undefined,
): ToolOutcome<z.infer<typeof ExportOutputSchema>> {
  const chosen: DinnerfileOptions = {};
  if (options?.kitchen !== undefined) chosen.kitchen = options.kitchen;
  if (options?.serve !== undefined) chosen.serve = options.serve;
  // `toDinnerfile` validates the plan itself and returns the issues; it does not throw.
  const result = toDinnerfile(plan as Plan, chosen);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: 'invalid_plan',
        message: SCHEDULE_ERROR_MESSAGES.invalid_plan(result.error.length),
        details: { issues: result.error },
      },
    };
  }
  return {
    ok: true,
    data: { dinnerfile: result.value },
    text: exportText(plan as Plan, result.value),
  };
}

export function importDinnerfileTool(
  text: string,
): ToolOutcome<z.infer<typeof ImportOutputSchema>> {
  const imported = fromDinnerfile(text);
  if (!imported.ok) {
    return {
      ok: false,
      error: {
        code: 'invalid_dinnerfile',
        message: `The Dinnerfile has ${imported.error.length} error(s):`,
        details: { errors: imported.error },
      },
    };
  }
  const checked = validatePlan(imported.value.plan);
  if (checked.plan === null) {
    return {
      ok: false,
      error: {
        code: 'invalid_plan',
        message: "The Dinnerfile's steps fail the plan schema:",
        details: { issues: checked.issues },
      },
    };
  }
  return {
    ok: true,
    data: { plan: checked.plan, options: imported.value.options, issues: checked.issues },
    text: importText(checked.plan, checked.issues),
  };
}

export const SampleSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  dishes: z.array(z.string()),
  kitchen: KitchenSchema,
  servingTime: ServeTimeSchema,
});
export const ListSamplesOutputSchema = z.object({ samples: z.array(SampleSummarySchema) });
export const SampleDetailSchema = SampleSummarySchema.extend({
  plan: PlanSchema,
  issues: z.array(IssueSchema),
});
export const GetSampleInputShape = { id: DishIdSchema };

export function listSamplesTool(source: SampleSource): ToolOutcome<{ samples: SampleSummary[] }> {
  const result = listSamples(source);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: { samples: result.value }, text: listSamplesText(result.value) };
}

export function getSampleTool(source: SampleSource, id: string): ToolOutcome<SampleDetail> {
  const result = getSample(source, id);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, data: result.value, text: getSampleText(result.value) };
}
