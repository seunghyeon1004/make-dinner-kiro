import type { VNode } from 'preact';
import { LIMITS } from '../../core/index.js';
import type { Kitchen } from '../../core/index.js';
import { COPY } from '../copy.js';
import { useAppState, useDispatch } from '../state/hooks.js';
import { Stepper } from './Stepper.js';

/** Burners (0 to 8), ovens (0 to 4) and cooks (1 to 6) (R5.1). */
export function KitchenControls(): VNode | null {
  const kitchen = useAppState((state) => state.dinner?.kitchen ?? null);
  const dispatch = useDispatch();
  if (kitchen === null) return null;
  const set = (patch: Partial<Kitchen>): void =>
    dispatch({ type: 'kitchen/set', kitchen: { ...kitchen, ...patch } });
  return (
    <div class="kitchen-controls">
      <Stepper
        label={COPY.burners}
        value={kitchen.burners}
        min={0}
        max={LIMITS.burnersMax}
        onChange={(burners) => set({ burners })}
      />
      <Stepper
        label={COPY.ovens}
        value={kitchen.ovens}
        min={0}
        max={LIMITS.ovensMax}
        onChange={(ovens) => set({ ovens })}
      />
      <Stepper
        label={COPY.cooks}
        value={kitchen.cooks}
        min={LIMITS.cooksMin}
        max={LIMITS.cooksMax}
        onChange={(cooks) => set({ cooks })}
      />
    </div>
  );
}
