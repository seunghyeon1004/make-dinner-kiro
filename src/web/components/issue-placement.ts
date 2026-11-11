import { stepOrder } from '../state/plan-edit.js';
import type { Issue, Plan } from '../../core/index.js';

export interface PlacedIssue {
  /** Position in the issue list; the anchor is `issue-<n>`. */
  n: number;
  issue: Issue;
  /** True for the one copy that carries the anchor the summary links to. */
  anchor: boolean;
}

export interface IssuePlacement {
  /** Issues that name no step and no dish: shown in the summary only. */
  unplaced: PlacedIssue[];
  /** By dish id, shown at the top of the dish. */
  byDish: ReadonlyMap<string, PlacedIssue[]>;
  /** By step index, shown beside the step. */
  byStep: ReadonlyMap<number, PlacedIssue[]>;
}

function stepIdsOf(issue: Issue): string[] {
  if (issue.code === 'cycle') return issue.path;
  return 'stepId' in issue && issue.stepId !== undefined ? [issue.stepId] : [];
}

function dishIdOf(issue: Issue): string | null {
  return 'dishId' in issue && issue.dishId !== undefined ? issue.dishId : null;
}

/**
 * Where each issue is shown (R4.9): beside every step it names (every step of a cycle path),
 * at the top of the dish it names, else only in the summary. The anchor goes on the first
 * copy in screen order: dishes in plan order, steps in `stepOrder`.
 */
export function placeIssues(plan: Plan, issues: readonly Issue[]): IssuePlacement {
  const screenOrder = new Map<number, number>();
  let position = 0;
  const order = stepOrder(plan);
  for (const dish of plan.dishes) {
    for (const index of order) {
      if (plan.steps[index]?.dish === dish.id) screenOrder.set(index, position++);
    }
  }
  const byStep = new Map<number, PlacedIssue[]>();
  const byDish = new Map<string, PlacedIssue[]>();
  const unplaced: PlacedIssue[] = [];
  const push = <K>(map: Map<K, PlacedIssue[]>, key: K, placed: PlacedIssue): void => {
    map.set(key, [...(map.get(key) ?? []), placed]);
  };

  issues.forEach((issue, n) => {
    const ids = new Set(stepIdsOf(issue));
    const indices = plan.steps.flatMap((s, i) => (ids.has(s.id) ? [i] : []));
    if (indices.length > 0) {
      const first = indices.reduce((a, b) =>
        (screenOrder.get(b) ?? Infinity) < (screenOrder.get(a) ?? Infinity) ? b : a,
      );
      for (const index of indices) push(byStep, index, { n, issue, anchor: index === first });
      return;
    }
    const dishId = dishIdOf(issue);
    if (dishId !== null && plan.dishes.some((d) => d.id === dishId)) {
      push(byDish, dishId, { n, issue, anchor: true });
      return;
    }
    unplaced.push({ n, issue, anchor: false });
  });
  return { unplaced, byDish, byStep };
}
