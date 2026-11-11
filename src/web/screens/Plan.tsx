import type { VNode } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import { toDinnerfile } from '../../core/index.js';
import { ExportBar } from '../components/ExportBar.js';
import { KitchenControls } from '../components/KitchenControls.js';
import { MissingAppliance } from '../components/MissingAppliance.js';
import { Timeline } from '../components/Timeline.js';
import { layoutTimeline } from '../components/timeline-layout.js';
import { PlanList } from '../components/PlanList.js';
import { PlanSummary } from '../components/PlanSummary.js';
import { ServingTime } from '../components/ServingTime.js';
import { WarningList } from '../components/WarningList.js';
import { COPY, EXPORT_COPY } from '../copy.js';
import { useAppState, useClock, useDispatch, useNow } from '../state/hooks.js';
import { systemClock } from '../state/clock.js';
import { hashOf } from '../state/route.js';
import { scheduleView } from '../state/schedule-view.js';
import { selectSchedule } from '../state/store.js';

/** Kitchen and serving time, then the schedule: summary, warnings, list (R5, R7). */
export function Plan(): VNode {
  const title = useAppState((state) => state.dinner?.plan.title ?? COPY.planHeading);
  const serving = useAppState((state) => state.dinner?.serving ?? null);
  const hasDinner = useAppState((state) => state.dinner !== null);
  const dinner = useAppState((state) => state.dinner);
  const result = useAppState(selectSchedule);
  const dispatch = useDispatch();
  const clock = useClock();
  const nowMs = useNow(systemClock, 30_000);
  const view = result !== null && result.ok ? scheduleView(result.value) : null;

  const dinnerfileText = useMemo(() => {
    if (dinner === null || dinner.serving === null) return null;
    const written = toDinnerfile(dinner.plan, {
      kitchen: dinner.kitchen,
      serve: dinner.serving.time,
    });
    return written.ok ? written.value : null;
  }, [dinner?.plan, dinner?.kitchen, dinner?.serving?.time]);

  // Opened through the flow links with no serving time chosen yet: choose one (R4.11).
  useEffect(() => {
    if (hasDinner && serving === null) dispatch({ type: 'plan/enter', nowMs: clock.nowMs() });
  }, [hasDinner, serving]);

  return (
    <main class="screen">
      <h1 tabIndex={-1}>{title}</h1>
      {view !== null && serving !== null && (
        <PlanSummary view={view} chosenMs={serving.atMs} nowMs={nowMs} />
      )}
      <section aria-labelledby="kitchen-heading" class="no-print">
        <h2 id="kitchen-heading">{COPY.kitchenHeading}</h2>
        <KitchenControls />
        <ServingTime nowMs={nowMs} />
      </section>
      {view !== null && serving !== null && (
        <>
          <WarningList view={view} />
          <Timeline layout={layoutTimeline(view, serving.atMs)} />
          <PlanList view={view} chosenMs={serving.atMs} />
          {dinnerfileText !== null && (
            <pre class="print-only dinnerfile-print mono">{dinnerfileText}</pre>
          )}
          {dinnerfileText !== null && dinner !== null && dinner.serving !== null && (
            <section aria-labelledby="export-heading" class="no-print">
              <h2 id="export-heading">{EXPORT_COPY.heading}</h2>
              <ExportBar
                dinnerfileText={dinnerfileText}
                plan={dinner.plan}
                kitchen={dinner.kitchen}
                serve={dinner.serving.time}
              />
            </section>
          )}
        </>
      )}
      {result !== null && !result.ok && result.error.kind === 'missing_appliance' && (
        <MissingAppliance issues={result.error.issues} />
      )}
      {result !== null && !result.ok && result.error.kind !== 'missing_appliance' && (
        <div class="notice-block">
          <p>{COPY.invalidPlan}</p>
          <a class="button" href={hashOf('steps')}>
            {COPY.goToSteps}
          </a>
        </div>
      )}
    </main>
  );
}
