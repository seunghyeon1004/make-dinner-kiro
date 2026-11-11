import type { VNode } from 'preact';
import type { Issue } from '../../core/index.js';
import { COPY, missingAppliance } from '../copy.js';
import { useAppState, useDispatch } from '../state/hooks.js';

/** Per missing appliance: which steps need it, and the way out (R5.7). */
export function MissingAppliance(props: { issues: readonly Issue[] }): VNode | null {
  const dinner = useAppState((state) => state.dinner);
  const dispatch = useDispatch();
  if (dinner === null) return null;
  const { plan, kitchen } = dinner;

  const needing = (appliance: 'burner' | 'oven'): string[] => {
    const ids = new Set<string>();
    for (const issue of props.issues) {
      if (issue.code === 'missing_appliance' && issue.appliance === appliance)
        ids.add(issue.stepId);
    }
    return plan.steps.filter((s) => ids.has(s.id)).map((s) => s.title);
  };
  const oven = needing('oven');
  const burner = needing('burner');

  return (
    <section class="missing-appliance" aria-labelledby="missing-heading">
      <h2 id="missing-heading" class="visually-hidden">
        {COPY.planHeading}
      </h2>
      {oven.length > 0 && (
        <div class="notice-block">
          <p>{missingAppliance('oven', oven)}</p>
          <button
            type="button"
            class="button button--primary"
            onClick={() => dispatch({ type: 'kitchen/set', kitchen: { ...kitchen, ovens: 1 } })}
          >
            {COPY.addOven}
          </button>
        </div>
      )}
      {burner.length > 0 && (
        <div class="notice-block">
          <p>{missingAppliance('burner', burner)}</p>
          <button
            type="button"
            class="button button--primary"
            onClick={() => dispatch({ type: 'kitchen/set', kitchen: { ...kitchen, burners: 1 } })}
          >
            {COPY.addBurner}
          </button>
        </div>
      )}
      <div class="actions">
        <button
          type="button"
          class="button"
          onClick={() => dispatch({ type: 'navigate', route: 'steps', cookRegistered: false })}
        >
          {COPY.changeSteps}
        </button>
      </div>
    </section>
  );
}
