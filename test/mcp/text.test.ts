import { describe, expect, it } from 'vitest';
import { planList } from '../../src/mcp/text.js';
import { H1_SCHEDULE, H3_SCHEDULE } from '../support/fixtures.js';

describe('plan list text (KM5.1, KM5.2)', () => {
  it('KM5.1 plan list of H1_SCHEDULE equals the design lines', () => {
    expect(planList(H1_SCHEDULE).split('\n')).toEqual([
      'Sunday roast: 3 dishes, 10 steps. Kitchen: 4 burners, 1 oven, 1 cook.',
      'Span 110 min, longest chain 110 min. Minute 0 is serving; earlier minutes are negative.',
      '-110 to -100  chicken.prep  Season and truss the chicken  Cook 1  No slack',
      '-100 to -25  chicken.roast  Roast the chicken  Oven 1  Critical',
      '-100 to -95  greens.shred  Shred the greens  Cook 1  slack 75 min',
      '-25 to -5  chicken.rest  Rest the chicken under foil  no lane  Critical',
      '-20 to -18  gravy.roux  Make a roux in the roasting tin  Burner 1, Cook 1  Critical',
      '-18 to -8  gravy.simmer  Add stock and let the gravy thicken  Burner 1  Critical',
      '-10 to -6  greens.boil  Cook the greens in salted water  Burner 2  Critical',
      '-8 to -6  gravy.strain  Strain the gravy into a jug  Cook 1  Critical',
      '-6 to -5  greens.toss  Toss the greens with butter  Cook 1  Critical',
      '-5 to 0  chicken.carve  Carve the chicken  Cook 1  Critical',
      'Warnings: none.',
    ]);
  });

  it('KM5.1 H3_SCHEDULE: the waiting step names its wait and hold, and a Warning line follows', () => {
    const lines = planList(H3_SCHEDULE).split('\n');
    const roast = lines.find((l) => l.includes('potatoes.roast'));
    expect(roast?.endsWith(', waits 40 min (hold 10 min)')).toBe(true);
    expect(lines.at(-1)).toBe(`Warning: ${H3_SCHEDULE.warnings[0]?.message}`);
  });
});
