import { z } from 'zod';

export const LIMITS = {
  minutesMin: 1,
  minutesMax: 480,
  holdMin: 0,
  holdMax: 480,
  dishesMax: 12,
  stepsMax: 80,
  afterMax: 80,
  burnersMax: 8,
  ovensMax: 4,
  cooksMin: 1,
  cooksMax: 6,
  planTitleMax: 120,
  dishNameMax: 80,
  stepTitleMax: 120,
  detailMax: 1000,
  dishIdMax: 40,
  stepIdMax: 80,
  handsOnWarnOverMin: 45,
  handsFreeWarnUnderMin: 2,
} as const;

export const DISH_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const STEP_ID_PATTERN = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** Non-blank text of 1..max Unicode code points (what zod max counts). */
const text = (max: number) => z.string().max(max).regex(/\S/);

export const DishIdSchema = z.string().max(LIMITS.dishIdMax).regex(DISH_ID_PATTERN);
export const StepIdSchema = z.string().max(LIMITS.stepIdMax).regex(STEP_ID_PATTERN);
export const ApplianceSchema = z.enum(['burner', 'oven', 'none']);

export const StepSchema = z.strictObject({
  id: StepIdSchema,
  dish: DishIdSchema,
  title: text(LIMITS.stepTitleMax),
  detail: text(LIMITS.detailMax).optional(),
  minutes: z.int().min(LIMITS.minutesMin).max(LIMITS.minutesMax),
  appliance: ApplianceSchema,
  handsOn: z.boolean(),
  after: z.array(StepIdSchema).max(LIMITS.afterMax),
  holdMin: z.int().min(LIMITS.holdMin).max(LIMITS.holdMax).nullable(),
});

export const DishSchema = z.strictObject({
  id: DishIdSchema,
  name: text(LIMITS.dishNameMax),
});

export const PlanSchema = z.strictObject({
  title: text(LIMITS.planTitleMax),
  dishes: z.array(DishSchema).min(1).max(LIMITS.dishesMax),
  steps: z.array(StepSchema).min(1).max(LIMITS.stepsMax),
});

export const KitchenSchema = z.strictObject({
  burners: z.int().min(0).max(LIMITS.burnersMax),
  ovens: z.int().min(0).max(LIMITS.ovensMax),
  cooks: z.int().min(LIMITS.cooksMin).max(LIMITS.cooksMax),
});

/** A 24-hour clock time from 00:00 to 23:59 (decided here). */
export const SERVE_TIME_PATTERN = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
export const ServeTimeSchema = z.string().regex(SERVE_TIME_PATTERN);

export type Appliance = z.infer<typeof ApplianceSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Dish = z.infer<typeof DishSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Kitchen = z.infer<typeof KitchenSchema>;
export type ServeTime = z.infer<typeof ServeTimeSchema>;

const message = z.string().min(1);

/** One issue variant: fixed severity and code, plus the extra fields of its code. */
const variant = <S extends 'error' | 'warning', C extends string, F extends z.ZodRawShape>(
  severity: S,
  code: C,
  fields: F,
) =>
  z.strictObject({
    severity: z.literal(severity),
    code: z.literal(code),
    message,
    ...fields,
  });

const HoldExceededIssueSchema = variant('warning', 'hold_exceeded', {
  stepId: StepIdSchema,
  waitMin: z.int().min(1),
  holdMin: z.int().min(0),
});

export const IssueSchema = z.discriminatedUnion('code', [
  variant('error', 'invalid_field', {
    field: z.string().min(1),
    stepId: StepIdSchema.optional(),
    dishId: DishIdSchema.optional(),
  }),
  variant('error', 'minutes_out_of_range', {
    field: z.string().min(1),
    stepId: StepIdSchema.optional(),
  }),
  variant('error', 'empty_plan', {}),
  variant('error', 'too_many_dishes', {
    count: z.int().min(LIMITS.dishesMax + 1),
    limit: z.literal(LIMITS.dishesMax),
  }),
  variant('error', 'too_many_steps', {
    count: z.int().min(LIMITS.stepsMax + 1),
    limit: z.literal(LIMITS.stepsMax),
  }),
  variant('error', 'unknown_dependency', { stepId: StepIdSchema, ref: StepIdSchema }),
  variant('error', 'self_dependency', { stepId: StepIdSchema }),
  variant('error', 'cycle', { stepId: StepIdSchema, path: z.array(StepIdSchema).min(2) }),
  variant('error', 'duplicate_step_id', { stepId: StepIdSchema, count: z.int().min(2) }),
  variant('error', 'duplicate_dish_id', { dishId: DishIdSchema, count: z.int().min(2) }),
  variant('error', 'unknown_dish', { stepId: StepIdSchema, dishId: DishIdSchema }),
  variant('error', 'dish_without_steps', { dishId: DishIdSchema }),
  variant('error', 'missing_appliance', {
    stepId: StepIdSchema,
    appliance: z.enum(['burner', 'oven']),
  }),
  variant('warning', 'appliance_mismatch', {
    stepId: StepIdSchema,
    word: z.string().min(1),
    suggested: z.enum(['burner', 'oven']),
  }),
  variant('warning', 'long_hands_on', { stepId: StepIdSchema, minutes: z.int() }),
  variant('warning', 'short_hands_free', { stepId: StepIdSchema, minutes: z.int() }),
  HoldExceededIssueSchema,
]);

export type Issue = z.infer<typeof IssueSchema>;
export type HoldExceededIssue = Extract<Issue, { code: 'hold_exceeded' }>;
export type IssueCode = Issue['code'];
export type ErrorCode = Extract<Issue, { severity: 'error' }>['code'];
export type WarningCode = Extract<Issue, { severity: 'warning' }>['code'];

export const ERROR_CODES: readonly ErrorCode[] = [
  'invalid_field',
  'minutes_out_of_range',
  'empty_plan',
  'too_many_dishes',
  'too_many_steps',
  'unknown_dependency',
  'self_dependency',
  'cycle',
  'duplicate_step_id',
  'duplicate_dish_id',
  'unknown_dish',
  'dish_without_steps',
  'missing_appliance',
];

export const WARNING_CODES: readonly WarningCode[] = [
  'appliance_mismatch',
  'long_hands_on',
  'short_hands_free',
  'hold_exceeded',
];

/** Order on ids by UTF-16 code units: -1, 0 or 1. Never localeCompare. */
export function compareIds(a: string, b: string): number {
  // String comparison operators compare UTF-16 code units, which is what R3.8 asks for.
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Dishes and steps sorted by id (stable), each after list sorted by id and deduplicated. */
export function canonicalPlan(plan: Plan): Plan {
  const byId = (a: { id: string }, b: { id: string }): number => compareIds(a.id, b.id);
  return {
    title: plan.title,
    dishes: plan.dishes.map((d) => ({ ...d })).toSorted(byId),
    steps: plan.steps
      .map((step): Step => {
        const { detail, ...rest } = step;
        const after = [...new Set(step.after)].sort(compareIds);
        // `detail` is written only when it has a value, so the key is absent otherwise.
        return detail === undefined ? { ...rest, after } : { ...rest, detail, after };
      })
      .toSorted(byId),
  };
}

/** Earliest minute on the scheduler axis: every step lasts at most 480 minutes (decided here). */
export const AXIS_MIN = -(LIMITS.stepsMax * LIMITS.minutesMax);

export const StepLanesSchema = z.strictObject({
  burner: z.int().min(1).max(LIMITS.burnersMax).nullable(),
  oven: z.int().min(1).max(LIMITS.ovensMax).nullable(),
  cook: z.int().min(1).max(LIMITS.cooksMax).nullable(),
});

export const ScheduledStepSchema = z.strictObject({
  id: StepIdSchema,
  startMin: z.int().min(AXIS_MIN).max(-1),
  endMin: z
    .int()
    .min(AXIS_MIN + 1)
    .max(0),
  lanes: StepLanesSchema,
  slackMin: z.int().min(0).max(-AXIS_MIN),
  critical: z.boolean(),
  waitMin: z.int().min(0).max(-AXIS_MIN).nullable(),
});

export const ScheduleSchema = z.strictObject({
  plan: PlanSchema,
  kitchen: KitchenSchema,
  steps: z.array(ScheduledStepSchema).min(1).max(LIMITS.stepsMax),
  spanMin: z.int().min(1).max(-AXIS_MIN),
  chainMin: z.int().min(1).max(-AXIS_MIN),
  warnings: z.array(HoldExceededIssueSchema),
});
export type StepLanes = z.infer<typeof StepLanesSchema>;
export type ScheduledStep = z.infer<typeof ScheduledStepSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;

/** Limits of the rebuild types: serving and extra minutes are at most a day (decided here). */
export const REBUILD_LIMITS = { servingMax: 1440, extraMax: 1440 } as const;
const rebuildMinute = z.int().min(AXIS_MIN).max(REBUILD_LIMITS.servingMax);
const rebuildLength = z
  .int()
  .min(0)
  .max(REBUILD_LIMITS.servingMax - AXIS_MIN);

export const ProgressEntrySchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('done'), startMin: rebuildMinute, endMin: rebuildMinute }),
  z.strictObject({
    state: z.literal('running'),
    startMin: rebuildMinute,
    extraMin: z.int().min(0).max(REBUILD_LIMITS.extraMax),
  }),
]);
/** Done and running steps by id; a step that is absent is pending. */
export const ProgressSchema = z.record(z.string(), ProgressEntrySchema);

export const RebuiltStepSchema = ScheduledStepSchema.extend({
  startMin: rebuildMinute,
  endMin: rebuildMinute,
  slackMin: rebuildLength,
  waitMin: rebuildLength.nullable(),
});

export const RebuiltScheduleSchema = ScheduleSchema.extend({
  servingMin: z.int().min(0).max(REBUILD_LIMITS.servingMax).default(0),
  steps: z.array(RebuiltStepSchema).min(1).max(LIMITS.stepsMax),
  spanMin: rebuildLength,
}).refine((s) => s.steps.every((t) => t.startMin <= t.endMin && t.endMin <= s.servingMin));

export const StepMoveSchema = z.strictObject({
  stepId: StepIdSchema,
  fromStartMin: rebuildMinute,
  toStartMin: rebuildMinute,
});
export const RebuildDiffSchema = z.strictObject({
  moved: z.array(StepMoveSchema),
  unchanged: z.array(StepIdSchema),
  servingShiftMin: z.int().min(0).max(REBUILD_LIMITS.servingMax),
});
export const RebuiltSchema = z.strictObject({
  schedule: RebuiltScheduleSchema,
  diff: RebuildDiffSchema,
});

export type ProgressEntry = z.infer<typeof ProgressEntrySchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type RebuiltStep = z.infer<typeof RebuiltStepSchema>;
export type RebuiltSchedule = z.infer<typeof RebuiltScheduleSchema>;
export type StepMove = z.infer<typeof StepMoveSchema>;
export type RebuildDiff = z.infer<typeof RebuildDiffSchema>;
export type Rebuilt = z.infer<typeof RebuiltSchema>;
