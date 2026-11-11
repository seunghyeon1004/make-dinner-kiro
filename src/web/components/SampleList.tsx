import type { VNode } from 'preact';
import { COPY, dishesLine } from '../copy.js';
import type { SampleItem } from '../state/api.js';
import { useAppState, useClock, useDispatch } from '../state/hooks.js';

/** The sample cards, or the loading or failed state (R1.1, R1.2). */
export function SampleList(): VNode {
  const samples = useAppState((state) => state.samples);
  const dispatch = useDispatch();
  const clock = useClock();

  if (samples.status === 'failed') {
    return (
      <div class="notice-block">
        <p>{COPY.samplesFailed}</p>
        <button type="button" class="button" onClick={() => dispatch({ type: 'samples/loading' })}>
          {COPY.tryAgain}
        </button>
      </div>
    );
  }
  if (samples.status !== 'loaded') {
    return (
      <p aria-busy="true" class="muted">
        {COPY.samplesLoading}
      </p>
    );
  }

  const choose = (sample: SampleItem): void => {
    dispatch({
      type: 'dinner/load',
      nowMs: clock.nowMs(),
      load: {
        plan: sample.plan,
        source: { kind: 'sample', sampleId: sample.id },
        kitchen: sample.kitchen,
        serve: null,
        suggested: sample.servingTime,
        route: 'plan',
        notice: null,
      },
    });
  };

  return (
    <ul class="card-list" aria-label={COPY.samplesHeading}>
      {samples.samples.map((sample) => (
        <li key={sample.id} class="card">
          <h3 id={`sample-${sample.id}-title`}>{sample.title}</h3>
          <p>{sample.blurb}</p>
          <p class="muted">{dishesLine(sample.dishes)}</p>
          <button
            type="button"
            class="button button--primary"
            data-sample-id={sample.id}
            aria-describedby={`sample-${sample.id}-title`}
            onClick={() => choose(sample)}
          >
            {COPY.planThisDinner}
          </button>
        </li>
      ))}
    </ul>
  );
}
