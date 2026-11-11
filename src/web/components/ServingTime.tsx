import type { VNode } from 'preact';
import { ServeTimeSchema } from '../../core/index.js';
import { COPY } from '../copy.js';
import { formatDay } from '../state/clock.js';
import { useAppState, useClock, useDispatch } from '../state/hooks.js';

/** The serving time input (R5.1, R5.3); the day shows beside it when it is not today. */
export function ServingTime(props: { nowMs: number }): VNode | null {
  const serving = useAppState((state) => state.dinner?.serving ?? null);
  const dispatch = useDispatch();
  const clock = useClock();
  if (serving === null) return null;
  const day = formatDay(serving.atMs, props.nowMs);
  return (
    <div class="serving-time">
      <label for="serving-time">{COPY.servingTime}</label>
      <input
        id="serving-time"
        class="input input--mono"
        type="time"
        value={serving.time}
        onChange={(event) => {
          const parsed = ServeTimeSchema.safeParse(event.currentTarget.value);
          if (parsed.success) {
            dispatch({ type: 'serving/set-time', time: parsed.data, nowMs: clock.nowMs() });
          }
        }}
      />
      {day !== null && <span class="muted">{day}</span>}
    </div>
  );
}
