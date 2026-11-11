import type { VNode } from 'preact';
import { COOK_COPY, cookDishChip, cookDishState } from '../copy.js';
import { formatClock } from '../state/clock.js';
import type { DishState } from '../state/cook-view.js';

function stateWords(state: DishState['state']): string {
  return state.kind === 'next'
    ? cookDishState('next', formatClock(state.startMs))
    : cookDishState(state.kind, '');
}

/** One chip per dish: steps done out of its steps and a state word; never colour alone (CM2.7). */
export function DishStrip(props: { dishes: DishState[] }): VNode {
  return (
    <section aria-labelledby="dishes">
      <h2 id="dishes" tabIndex={-1}>
        {COOK_COPY.dishes}
      </h2>
      <ul class="dish-strip" aria-label={COOK_COPY.dishes}>
        {props.dishes.map((dish) => (
          <li key={dish.dishId} class="dish-strip__chip">
            <span class="dish-strip__count">{cookDishChip(dish.name, dish.done, dish.total)}</span>
            <span class="dish-strip__state">
              {dish.state.kind === 'done' && <span aria-hidden="true">✓ </span>}
              {stateWords(dish.state)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
