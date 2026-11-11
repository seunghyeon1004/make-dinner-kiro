import type { VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ActionDock, dockCard } from '../components/ActionDock.js';
import { BuildLog } from '../components/BuildLog.js';
import { CookCountdown } from '../components/CookCountdown.js';
import { CookHeader } from '../components/CookHeader.js';
import { LaneCard } from '../components/LaneCard.js';
import { DishStrip } from '../components/DishStrip.js';
import { RunningCard } from '../components/RunningCard.js';
import { StartCard } from '../components/StartCard.js';
import { UpNext } from '../components/UpNext.js';
import { COOK_COPY, cookTooLate } from '../copy.js';
import { formatClock, formatDay, systemClock } from '../state/clock.js';
import { applyCook, canBegin, startNowShiftMin } from '../state/cook-session.js';
import { useCookEffects } from '../state/cook-hooks.js';
import type { CookAction } from '../state/cook-slot.js';
import { cookView, focusAfter } from '../state/cook-view.js';
import type { FocusTarget } from '../state/cook-view.js';
import { useAppState, useDispatch, useNow } from '../state/hooks.js';
import { hashOf } from '../state/route.js';
import { selectSchedule } from '../state/store.js';
import { actionId } from '../components/StepCardBody.js';

/** "Right now": begins a session from the Plan screen's schedule, then shows it (CM1, CM2). */
export function Cook(): VNode {
  const cook = useAppState((state) => state.cook);
  const serving = useAppState((state) => state.dinner?.serving ?? null);
  const scheduled = useAppState(selectSchedule);
  const dispatch = useDispatch();
  const nowMs = useNow(systemClock, 1000);
  useCookEffects();

  const schedule = scheduled !== null && scheduled.ok ? scheduled.value : null;
  const begin =
    cook === null && schedule !== null && serving !== null
      ? canBegin(schedule, serving.atMs, nowMs)
      : null;

  // CM1.1: the first visit begins the session against the Plan screen's schedule.
  useEffect(() => {
    if (cook !== null || schedule === null || serving === null) return;
    dispatch({ type: 'cook/begin', schedule, axisMs: serving.atMs, nowMs: systemClock.nowMs() });
  }, [cook === null]);

  // Focus after an action goes where `focusAfter` says, once the new view is drawn (CM9.3).
  const [confirming, setConfirming] = useState<string | null>(null);
  const focus = useRef<FocusTarget>(null);
  useEffect(() => {
    const target = focus.current;
    focus.current = null;
    if (target === null) return;
    const id = target.kind === 'action' ? actionId(target.stepId, target.action) : target.id;
    document.getElementById(id)?.focus();
  }, [cook, confirming]);

  const tooLate = begin !== null && !begin.ok && begin.error.kind === 'too_late';
  if (cook === null) {
    return (
      <main class="screen cook">
        <h1 tabIndex={-1}>{COOK_COPY.h1}</h1>
        {tooLate && serving !== null && (
          <div class="notice-block">
            <p>{cookTooLate(formatClock(serving.atMs), formatDay(serving.atMs, nowMs))}</p>
            <a class="button" href={hashOf('plan')}>
              {COOK_COPY.goToPlan}
            </a>
          </div>
        )}
      </main>
    );
  }

  const view = cookView(cook, nowMs);
  const act = (build: (at: number) => CookAction): void => {
    const at = systemClock.nowMs();
    const action = build(at);
    if (action.type !== 'cook/begin' && action.type !== 'cook/stop') {
      focus.current = focusAfter(action, cookView(cook, at), cookView(applyCook(cook, action), at));
    }
    dispatch(action);
  };
  const startNow = (stepId: string): void =>
    act((at) => ({ type: 'cook/start', stepId, nowMs: at }));
  const cards = [
    ...view.lanes.flatMap((lane) => [lane.current, ...lane.also]),
    ...view.toStart,
    ...view.running,
  ].flatMap((card) => (card === null ? [] : [card]));
  const titleOf = (stepId: string): string =>
    cook.core.schedule.plan.steps.find((step) => step.id === stepId)?.title ?? stepId;
  const blockedCard = cards.find((card) => card.stepId === confirming && card.state === 'due');
  // CM3.3: a start whose prerequisites are not all done asks for a second tap.
  const onStart = (stepId: string): void => {
    const card = cards.find((c) => c.stepId === stepId);
    if (card !== undefined && card.state === 'due' && card.waitsFor.length > 0) {
      setConfirming(stepId);
    } else {
      startNow(stepId);
    }
  };
  const onDone = (stepId: string): void => act((at) => ({ type: 'cook/done', stepId, nowMs: at }));
  const onExtra = (stepId: string, minutes: 5 | 10 | 15): void =>
    act((at) => ({ type: 'cook/extra', stepId, minutes, nowMs: at }));
  const docked = dockCard(view);
  return (
    <main class="screen cook">
      <h1 tabIndex={-1}>{COOK_COPY.h1}</h1>
      <CookHeader
        nowMs={nowMs}
        servingMs={view.servingMs}
        plannedServingMs={view.plannedServingMs}
      />
      {view.phase === 'countdown' && (
        <CookCountdown
          view={view}
          shiftMin={startNowShiftMin(cook.core, nowMs)}
          onStartNow={() => act((at) => ({ type: 'cook/start-now', nowMs: at }))}
        />
      )}
      {view.phase === 'countdown' && <UpNext items={view.upNext} />}
      {view.phase === 'cooking' && (
        <>
          <section aria-labelledby="do-now">
            <h2 id="do-now" tabIndex={-1}>
              {COOK_COPY.doNow}
            </h2>
            {view.lanes.map((lane) => (
              <LaneCard
                key={lane.cookLane}
                lane={lane}
                labelled={view.lanes.length > 1}
                nowMs={nowMs}
                dockStepId={docked?.stepId ?? null}
                onStart={onStart}
                onDone={onDone}
                onExtra={onExtra}
              />
            ))}
            {view.toStart.map((card) => (
              <StartCard
                key={card.stepId}
                card={card}
                nowMs={nowMs}
                dockStepId={docked?.stepId ?? null}
                onStart={onStart}
                onDone={onDone}
              />
            ))}
          </section>
          {view.running.length > 0 && (
            <section aria-labelledby="running">
              <h2 id="running" tabIndex={-1}>
                {COOK_COPY.running}
              </h2>
              {view.running.map((card) => (
                <RunningCard
                  key={card.stepId}
                  card={card}
                  nowMs={nowMs}
                  dockStepId={docked?.stepId ?? null}
                  onStart={onStart}
                  onDone={onDone}
                  onExtra={onExtra}
                />
              ))}
            </section>
          )}
          <UpNext items={view.upNext} />
          <DishStrip dishes={view.dishes} />
          <BuildLog core={cook.core} />
          <ActionDock
            view={view}
            card={docked}
            blocked={
              blockedCard === undefined
                ? null
                : {
                    stepId: blockedCard.stepId,
                    title: blockedCard.title,
                    waitsFor: blockedCard.waitsFor,
                  }
            }
            titleOf={titleOf}
            onStart={onStart}
            onDone={onDone}
            onBehind={() => act((at) => ({ type: 'cook/behind', nowMs: at }))}
            onUndo={() => act((at) => ({ type: 'cook/undo', nowMs: at }))}
            onStartAnyway={() => {
              if (confirming !== null) startNow(confirming);
              setConfirming(null);
            }}
            onNotYet={() => {
              if (confirming !== null) {
                focus.current = { kind: 'action', stepId: confirming, action: 'start' };
              }
              setConfirming(null);
            }}
          />
        </>
      )}
    </main>
  );
}
