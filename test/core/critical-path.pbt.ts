import fc from 'fast-check';
import { expect, it } from 'vitest';
import { criticalPath } from '../../src/core/critical-path.js';
import { schedule } from '../../src/core/schedule.js';
import { arbPlanAndKitchen } from '../support/arbitraries.js';
import { fcParams } from '../support/fc-params.js';

// P-UI7 (plan-ui): the critical path is a chain that fixes the start of dinner.
it('P-UI7 critical path: contiguous, ends at serving, and every step in it has slack 0', () => {
  fc.assert(
    fc.property(arbPlanAndKitchen(), ({ plan, kitchen }) => {
      const result = schedule(plan, kitchen);
      if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
      const s = result.value;
      const path = criticalPath(s);
      const byId = new Map(s.steps.map((x) => [x.id, x]));
      const endsAtServing = s.steps.some((x) => x.endMin === 0);
      // Nothing ends at serving only when every terminal step keeps: then there is no chain.
      expect(path.length > 0).toBe(endsAtServing);
      const rows = path.map((id) => byId.get(id));
      for (const [i, row] of rows.entries()) {
        if (row === undefined) throw new Error(`unknown step ${path[i]}`);
        expect(row.slackMin).toBe(0);
        const next = rows[i + 1];
        if (next !== undefined) expect(next.startMin).toBe(row.endMin);
      }
      const tail = rows[rows.length - 1];
      if (tail !== undefined) expect(tail.endMin).toBe(0);
      expect(new Set(path).size).toBe(path.length);
    }),
    fcParams(),
  );
}, 60_000);
