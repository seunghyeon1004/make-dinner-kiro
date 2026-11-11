import { describe, expect, it } from 'vitest';
import { readDinnerfile } from '../../../src/web/state/dinnerfile-import.js';
import { DEFAULT_KITCHEN } from '../../../src/web/state/store.js';
import { SUNDAY_ROAST, SUNDAY_ROAST_DINNERFILE } from '../../support/fixtures.js';

const KITCHEN_NOTICE =
  'The kitchen line in the Dinnerfile is not valid, so the usual kitchen is used: 4 burners, 1 oven, 1 cook.';

function planned(text: string) {
  const result = readDinnerfile(text);
  if (!result.ok) throw new Error('expected the Dinnerfile to be read');
  return result.value;
}

describe('readDinnerfile (R3.2 to R3.5)', () => {
  it('R3.5 SUNDAY_ROAST_DINNERFILE opens Plan with the default kitchen and no serve time', () => {
    const load = planned(SUNDAY_ROAST_DINNERFILE);
    expect(load.route).toBe('plan');
    expect(load.source).toEqual({ kind: 'dinnerfile' });
    expect(load.kitchen).toEqual(DEFAULT_KITCHEN);
    expect(load.serve).toBeNull();
    expect(load.suggested).toBeNull();
    expect(load.notice).toBeNull();
    expect(load.plan.title).toBe('Sunday roast');
    expect(load.plan.steps.map((s) => s.id).sort()).toEqual(
      SUNDAY_ROAST.steps.map((s) => s.id).sort(),
    );
  });

  it('R3.5 a # kitchen line and a # serve line come through', () => {
    const text = `${SUNDAY_ROAST_DINNERFILE}# kitchen burners=2 ovens=2 cooks=3\n# serve 19:30\n`;
    const load = planned(text);
    expect(load.kitchen).toEqual({ burners: 2, ovens: 2, cooks: 3 });
    expect(load.serve).toBe('19:30');
    expect(load.notice).toBeNull();
    expect(load.route).toBe('plan');
  });

  it('R3.5 a kitchen line outside the limits gives the default kitchen and the notice', () => {
    const text = `${SUNDAY_ROAST_DINNERFILE}# kitchen burners=9 ovens=1 cooks=1\n`;
    const load = planned(text);
    expect(load.kitchen).toEqual({ burners: 4, ovens: 1, cooks: 1 });
    expect(load.notice).toBe(KITCHEN_NOTICE);
  });

  it('R3.5 a plan with an error opens Steps, not Plan', () => {
    // chicken.prep waits for chicken.roast, which waits for chicken.prep: a cycle.
    const text = SUNDAY_ROAST_DINNERFILE.replace(
      'chicken.prep:\n',
      'chicken.prep: chicken.roast\n',
    );
    const load = planned(text);
    expect(load.route).toBe('steps');
    expect(load.plan.steps).toHaveLength(SUNDAY_ROAST.steps.length);
  });

  it('R3.3 a line Make Dinner does not read gives one line problem with the Dinnerfile message', () => {
    const result = readDinnerfile(`${SUNDAY_ROAST_DINNERFILE}$(X)\n`);
    expect(result).toEqual({
      ok: false,
      error: {
        heading: 'This Dinnerfile could not be read. Fix these lines and open it again.',
        problems: [
          {
            kind: 'line',
            line: 57,
            message:
              'Line 57: Make Dinner reads only comments, rules like "chicken.carve: chicken.rest" and recipe lines. Remove this line or rewrite it as one of those.',
          },
        ],
      },
    });
  });

  it('R3.3 a file without a # plan line has a problem with no line number', () => {
    const result = readDinnerfile('');
    expect(result).toEqual({
      ok: false,
      error: {
        heading: 'This Dinnerfile could not be read. Fix these lines and open it again.',
        problems: [
          {
            kind: 'line',
            line: null,
            message:
              'The file has no "# plan" line. Add one near the top, like: # plan "Sunday roast"',
          },
        ],
      },
    });
  });

  it('R3.4 minutes=0 is read but invalid: the invalid-plan heading and the issue message', () => {
    const text = SUNDAY_ROAST_DINNERFILE.replace(
      'minutes=5 appliance=none handsOn=true hold=5 title="Carve',
      'minutes=0 appliance=none handsOn=true hold=5 title="Carve',
    );
    expect(readDinnerfile(text)).toEqual({
      ok: false,
      error: {
        heading: 'This Dinnerfile was read, but its plan is not valid:',
        problems: [
          {
            kind: 'issue',
            message: 'Step chicken.carve: minutes must be a whole number from 1 to 480.',
          },
        ],
      },
    });
  });
});
