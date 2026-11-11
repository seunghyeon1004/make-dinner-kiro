import { longestChainMinutes } from './graph.js';
import { backwardPass } from './passes/backward.js';
import { assignLanes } from './passes/lanes.js';
import { prepForwardPass } from './passes/prep-forward.js';
import { readout } from './passes/readout.js';
import { rightJustifyPass } from './passes/right-justify.js';
import { err, ok } from './result.js';
import type { Result } from './result.js';
import { checkKitchen, hasErrors, parseKitchen, sortIssues, validatePlan } from './sanity.js';
import { canonicalPlan } from './schema.js';
import type { Issue, Kitchen, Plan, Schedule, ScheduledStep } from './schema.js';
import { capacityOf } from './timeline.js';

export type ScheduleError =
  | { kind: 'invalid_plan'; issues: Issue[] } // errors only, sortIssues order
  | { kind: 'invalid_kitchen'; issues: Issue[] } // from parseKitchen
  | { kind: 'missing_appliance'; issues: Issue[] }; // from checkKitchen

/**
 * Checks its own inputs, then runs the passes: backward, prep-forward, right-justify, lanes and
 * readout. The first failing check is returned alone. Never throws on any value; a throw from
 * a pass means a bug. The arguments are not changed.
 */
export function schedule(plan: Plan, kitchen: Kitchen): Result<Schedule, ScheduleError> {
  const checked = validatePlan(plan);
  const planIssues = sortIssues(checked.issues.filter((i) => i.severity === 'error'));
  if (checked.plan === null || hasErrors(planIssues)) {
    return err({ kind: 'invalid_plan', issues: planIssues });
  }
  const parsedKitchen = parseKitchen(kitchen);
  if (!parsedKitchen.ok) return err({ kind: 'invalid_kitchen', issues: parsedKitchen.error });
  const kitchenIssues = checkKitchen(checked.plan, parsedKitchen.value);
  if (hasErrors(kitchenIssues)) return err({ kind: 'missing_appliance', issues: kitchenIssues });

  const canonical = canonicalPlan(checked.plan);
  const cap = capacityOf(parsedKitchen.value);
  const s1 = backwardPass(canonical, cap);
  const s2 = prepForwardPass(canonical, cap, s1);
  const s3 = rightJustifyPass(canonical, cap, s2);
  const lanes = assignLanes(canonical, cap, s3);
  const read = readout(canonical, cap, s3);
  const chain = longestChainMinutes(canonical);
  if (!chain.ok) throw new Error('schedule: the plan has a cycle after validation');

  const steps = canonical.steps.map((step): ScheduledStep => {
    const start = s3.get(step.id);
    const stepLanes = lanes.get(step.id);
    const slackMin = read.slackMin.get(step.id);
    const waitMin = read.waitMin.get(step.id);
    if (
      start === undefined ||
      stepLanes === undefined ||
      slackMin === undefined ||
      waitMin === undefined
    ) {
      throw new Error(`schedule: a pass left out ${step.id}`);
    }
    return {
      id: step.id,
      startMin: start,
      endMin: start + step.minutes,
      lanes: stepLanes,
      slackMin,
      critical: slackMin === 0,
      waitMin,
    };
  });
  return ok({
    plan: canonical,
    kitchen: parsedKitchen.value,
    steps,
    spanMin: -Math.min(...steps.map((s) => s.startMin)),
    chainMin: chain.value,
    warnings: read.warnings,
  });
}
