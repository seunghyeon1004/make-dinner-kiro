import type { VNode } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { hasErrors } from '../../core/index.js';
import { DishNameForm } from '../components/DishNameForm.js';
import { DishSection } from '../components/DishSection.js';
import { IssueSummary } from '../components/IssueList.js';
import { UnplacedSteps } from '../components/UnplacedSteps.js';
import { placeIssues } from '../components/issue-placement.js';
import {
  COPY,
  EDIT_ERRORS,
  issueSummary,
  MANAGE_COPY,
  makeBlocked,
  STEPS_COPY,
  stepsIntro,
} from '../copy.js';
import { useAppState, useClock, useDispatch } from '../state/hooks.js';
import { stepOrder } from '../state/plan-edit.js';
import { selectCheck } from '../state/store.js';

/** Parsed steps per dish, issues beside them, and the way on to the plan (R4). */
export function Steps(): VNode {
  const dinner = useAppState((state) => state.dinner);
  const check = useAppState(selectCheck);
  const dispatch = useDispatch();
  const clock = useClock();
  const cooking = useAppState((state) => state.cook !== null);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  const addedDish = useRef(false);
  const reasonId = useId();

  // Closing the form returns focus to "Add a dish".
  useEffect(() => {
    // After an add the new step's editor takes focus instead.
    if (wasAdding.current && !adding && !addedDish.current) addButton.current?.focus();
    addedDish.current = false;
    wasAdding.current = adding;
  }, [adding]);

  if (dinner === null || check === null) {
    return (
      <main class="screen">
        <h1 tabIndex={-1}>{COPY.stepsHeading}</h1>
      </main>
    );
  }
  const { plan } = dinner;
  const errors = check.issues.filter((i) => i.severity === 'error').length;
  const warnings = check.issues.length - errors;
  const placement = placeIssues(plan, check.issues);
  const order = stepOrder(plan);
  const placedSummary = check.issues.map((issue, n) => ({ n, issue, anchor: false }));
  const blocked = hasErrors(check.issues);
  const addBlocked =
    plan.dishes.length >= 12
      ? EDIT_ERRORS.too_many_dishes
      : plan.steps.length >= 80
        ? EDIT_ERRORS.too_many_steps
        : null;

  return (
    <main class="screen">
      <h1 tabIndex={-1}>{COPY.stepsHeading}</h1>
      <p>{stepsIntro(plan.title)}</p>
      {cooking && <p>{STEPS_COPY.cookingStarted}</p>}
      <section id="issues-summary" aria-labelledby="issues-heading">
        <h2 id="issues-heading" tabIndex={-1}>
          {STEPS_COPY.issuesHeading}
        </h2>
        <p>{check.issues.length === 0 ? STEPS_COPY.noIssues : issueSummary(errors, warnings)}</p>
        {errors > 0 && <p>{STEPS_COPY.fixErrorsToMake}</p>}
        <IssueSummary items={placedSummary} />
      </section>
      {plan.dishes.map((dish, dishIndex) => (
        <DishSection
          key={dish.id}
          plan={plan}
          dishIndex={dishIndex}
          order={order}
          placement={placement}
          editing={editing}
          readOnly={cooking}
          onEdit={setEditing}
        />
      ))}
      <UnplacedSteps
        plan={plan}
        order={order}
        placement={placement}
        editing={editing}
        readOnly={cooking}
        onEdit={setEditing}
      />
      {!cooking && (
        <section class="add-dish" aria-label={MANAGE_COPY.addDish}>
          {adding ? (
            <DishNameForm
              initial=""
              submitLabel={MANAGE_COPY.addDishConfirm}
              onSubmit={(name) => {
                dispatch({ type: 'dish/add', name });
                addedDish.current = true;
                // The new dish's only step is the last one; open it for editing.
                setEditing(plan.steps.length);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <>
              <button
                type="button"
                class="button"
                ref={addButton}
                disabled={addBlocked !== null}
                aria-describedby={addBlocked === null ? undefined : reasonId}
                onClick={() => setAdding(true)}
              >
                {MANAGE_COPY.addDish}
              </button>
              {addBlocked !== null && (
                <p id={reasonId} class="muted">
                  {addBlocked}
                </p>
              )}
            </>
          )}
        </section>
      )}
      <div class="actions">
        <button
          type="button"
          class="button button--primary"
          disabled={blocked}
          aria-describedby={blocked ? 'make-blocked' : undefined}
          onClick={() => dispatch({ type: 'plan/enter', nowMs: clock.nowMs() })}
        >
          {STEPS_COPY.makePlan}
        </button>
      </div>
      {blocked && (
        <p id="make-blocked" class="muted">
          {makeBlocked(errors)}
        </p>
      )}
    </main>
  );
}
