import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../../src/core/index.js';
import * as api from '../../src/core/api.js';
import * as criticalPath from '../../src/core/critical-path.js';
import * as dinnerfile from '../../src/core/dinnerfile.js';
import * as graph from '../../src/core/graph.js';
import * as normalise from '../../src/core/normalise.js';
import * as result from '../../src/core/result.js';
import * as rebuilder from '../../src/core/rebuild.js';
import * as sanity from '../../src/core/sanity.js';
import * as scheduler from '../../src/core/schedule.js';
import * as schema from '../../src/core/schema.js';

// The names listed in the recipe-graph design, section `src/core/index.ts` (N4).
const VALUES = {
  ok: [result.ok, 'function'],
  err: [result.err, 'function'],
  LIMITS: [schema.LIMITS, 'object'],
  DISH_ID_PATTERN: [schema.DISH_ID_PATTERN, 'object'],
  STEP_ID_PATTERN: [schema.STEP_ID_PATTERN, 'object'],
  DishIdSchema: [schema.DishIdSchema, 'object'],
  StepIdSchema: [schema.StepIdSchema, 'object'],
  ApplianceSchema: [schema.ApplianceSchema, 'object'],
  StepSchema: [schema.StepSchema, 'object'],
  DishSchema: [schema.DishSchema, 'object'],
  PlanSchema: [schema.PlanSchema, 'object'],
  KitchenSchema: [schema.KitchenSchema, 'object'],
  IssueSchema: [schema.IssueSchema, 'object'],
  ERROR_CODES: [schema.ERROR_CODES, 'object'],
  WARNING_CODES: [schema.WARNING_CODES, 'object'],
  compareIds: [schema.compareIds, 'function'],
  canonicalPlan: [schema.canonicalPlan, 'function'],
  successors: [graph.successors, 'function'],
  terminalSteps: [graph.terminalSteps, 'function'],
  topologicalOrder: [graph.topologicalOrder, 'function'],
  findCycles: [graph.findCycles, 'function'],
  longestChainMinutes: [graph.longestChainMinutes, 'function'],
  parsePlan: [sanity.parsePlan, 'function'],
  parseKitchen: [sanity.parseKitchen, 'function'],
  checkPlan: [sanity.checkPlan, 'function'],
  checkKitchen: [sanity.checkKitchen, 'function'],
  validatePlan: [sanity.validatePlan, 'function'],
  sortIssues: [sanity.sortIssues, 'function'],
  hasErrors: [sanity.hasErrors, 'function'],
  // plan-ui, the critical path shown on screen.
  criticalPath: [criticalPath.criticalPath, 'function'],
  normaliseRecipeText: [normalise.normaliseRecipeText, 'function'],
  // The scheduler spec (N4): the entry point and the schedule schemas only.
  schedule: [scheduler.schedule, 'function'],
  StepLanesSchema: [schema.StepLanesSchema, 'object'],
  ScheduledStepSchema: [schema.ScheduledStepSchema, 'object'],
  ScheduleSchema: [schema.ScheduleSchema, 'object'],
  // The rebuild spec (N2): the entry point and the new schemas only.
  rebuild: [rebuilder.rebuild, 'function'],
  ProgressEntrySchema: [schema.ProgressEntrySchema, 'object'],
  ProgressSchema: [schema.ProgressSchema, 'object'],
  RebuiltStepSchema: [schema.RebuiltStepSchema, 'object'],
  RebuiltScheduleSchema: [schema.RebuiltScheduleSchema, 'object'],
  StepMoveSchema: [schema.StepMoveSchema, 'object'],
  RebuildDiffSchema: [schema.RebuildDiffSchema, 'object'],
  RebuiltSchema: [schema.RebuiltSchema, 'object'],
  // The dinnerfile spec (N4): export, import and the serving time schema.
  toDinnerfile: [dinnerfile.toDinnerfile, 'function'],
  fromDinnerfile: [dinnerfile.fromDinnerfile, 'function'],
  SERVE_TIME_PATTERN: [schema.SERVE_TIME_PATTERN, 'object'],
  ServeTimeSchema: [schema.ServeTimeSchema, 'object'],
  // The recipe-reader review (Q5): the response schemas shared with the web code.
  RECIPE_TEXT_MAX: [api.RECIPE_TEXT_MAX, 'number'],
  API_ERROR_CODES: [api.API_ERROR_CODES, 'object'],
  ApiErrorSchema: [api.ApiErrorSchema, 'object'],
  SampleEntrySchema: [api.SampleEntrySchema, 'object'],
  SampleItemSchema: [api.SampleItemSchema, 'object'],
  SamplesResponseSchema: [api.SamplesResponseSchema, 'object'],
  ParseRequestSchema: [api.ParseRequestSchema, 'object'],
  ParseResponseSchema: [api.ParseResponseSchema, 'object'],
} as const;

describe('N4 the public surface of src/core/index.ts', () => {
  it('N4 exports exactly the values the design lists', () => {
    expect(Object.keys(core).sort()).toEqual(Object.keys(VALUES).sort());
  });

  it.each(Object.entries(VALUES))(
    'N4 %s is the module export, of the right kind',
    (name, entry) => {
      const [value, kind] = entry;
      const exported: unknown = (core as Record<string, unknown>)[name];
      expect(typeof exported).toBe(kind);
      expect(exported).toBe(value);
    },
  );

  it('N4 exports the types the design lists', () => {
    expectTypeOf<core.Appliance>().toEqualTypeOf<schema.Appliance>();
    expectTypeOf<core.Step>().toEqualTypeOf<schema.Step>();
    expectTypeOf<core.Dish>().toEqualTypeOf<schema.Dish>();
    expectTypeOf<core.Plan>().toEqualTypeOf<schema.Plan>();
    expectTypeOf<core.Kitchen>().toEqualTypeOf<schema.Kitchen>();
    expectTypeOf<core.Issue>().toEqualTypeOf<schema.Issue>();
    expectTypeOf<core.IssueCode>().toEqualTypeOf<schema.IssueCode>();
    expectTypeOf<core.ErrorCode>().toEqualTypeOf<schema.ErrorCode>();
    expectTypeOf<core.WarningCode>().toEqualTypeOf<schema.WarningCode>();
    expectTypeOf<core.CycleError>().toEqualTypeOf<graph.CycleError>();
    expectTypeOf<core.PlanCheck>().toEqualTypeOf<sanity.PlanCheck>();
    expectTypeOf<core.StepLanes>().toEqualTypeOf<schema.StepLanes>();
    expectTypeOf<core.ScheduledStep>().toEqualTypeOf<schema.ScheduledStep>();
    expectTypeOf<core.Schedule>().toEqualTypeOf<schema.Schedule>();
    expectTypeOf<core.HoldExceededIssue>().toEqualTypeOf<schema.HoldExceededIssue>();
    expectTypeOf<core.ScheduleError>().toEqualTypeOf<scheduler.ScheduleError>();
    expectTypeOf<core.ProgressEntry>().toEqualTypeOf<schema.ProgressEntry>();
    expectTypeOf<core.Progress>().toEqualTypeOf<schema.Progress>();
    expectTypeOf<core.RebuiltStep>().toEqualTypeOf<schema.RebuiltStep>();
    expectTypeOf<core.RebuiltSchedule>().toEqualTypeOf<schema.RebuiltSchedule>();
    expectTypeOf<core.StepMove>().toEqualTypeOf<schema.StepMove>();
    expectTypeOf<core.RebuildDiff>().toEqualTypeOf<schema.RebuildDiff>();
    expectTypeOf<core.Rebuilt>().toEqualTypeOf<schema.Rebuilt>();
    expectTypeOf<core.RebuildError>().toEqualTypeOf<rebuilder.RebuildError>();
    expectTypeOf<core.ServeTime>().toEqualTypeOf<schema.ServeTime>();
    expectTypeOf<core.DinnerfileOptions>().toEqualTypeOf<dinnerfile.DinnerfileOptions>();
    expectTypeOf<core.DinnerfileImport>().toEqualTypeOf<dinnerfile.DinnerfileImport>();
    expectTypeOf<core.DinnerfileError>().toEqualTypeOf<dinnerfile.DinnerfileError>();
    expectTypeOf<core.DinnerfileErrorCode>().toEqualTypeOf<dinnerfile.DinnerfileErrorCode>();
    expectTypeOf<core.MetadataKeyword>().toEqualTypeOf<dinnerfile.MetadataKeyword>();
    expectTypeOf<core.ApiErrorCode>().toEqualTypeOf<api.ApiErrorCode>();
    expectTypeOf<core.SampleEntry>().toEqualTypeOf<api.SampleEntry>();
    expectTypeOf<core.SampleItem>().toEqualTypeOf<api.SampleItem>();
    expectTypeOf<core.SamplesResponse>().toEqualTypeOf<api.SamplesResponse>();
    expectTypeOf<core.ParseRequest>().toEqualTypeOf<api.ParseRequest>();
    expectTypeOf<core.ParseResponse>().toEqualTypeOf<api.ParseResponse>();
    expectTypeOf<core.Result<number, string>>().toEqualTypeOf<result.Result<number, string>>();
  });

  it('N4 exports no pass or timeline name', () => {
    const internal = [
      'backwardPass',
      'prepForwardPass',
      'rightJustifyPass',
      'assignLanes',
      'readout',
      'holdExceededMessage',
      'createTimeline',
      'latestFit',
      'earliestFit',
      'capacityOf',
      'resourcesOf',
      'RESOURCES',
      'forwardRepair',
      'reAlign',
      'assignRebuildLanes',
      'rebuildReadout',
      'timelineFrom',
    ];
    expect(Object.keys(core).filter((name) => internal.includes(name))).toEqual([]);
  });
});
