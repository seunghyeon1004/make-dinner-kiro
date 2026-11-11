import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Schedule, ScheduledStep } from '../../../src/core/index.js';
import { planListGroups } from '../../../src/web/components/plan-list-items.js';
import { listWait } from '../../../src/web/copy.js';
import { scheduleView } from '../../../src/web/state/schedule-view.js';
import { H1_SCHEDULE, H3_SCHEDULE, SUNDAY_ROAST } from '../../support/fixtures.js';

const original = process.env['TZ'];
const at = (iso: string): number => Date.parse(iso);

beforeAll(() => {
  process.env['TZ'] = 'Europe/London';
  // 2026-07-01 is BST: the offset is -60 only when the zone took effect.
  expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
});
afterAll(() => {
  if (original === undefined) delete process.env['TZ'];
  else process.env['TZ'] = original;
});

const WED_1930 = at('2026-11-11T19:30:00Z');
const THU_0030 = at('2026-11-12T00:30:00Z');

/** The flat rows of the groups, as the design's H1 table writes them. */
function rows(groups: ReturnType<typeof planListGroups>): string[][] {
  return groups.flatMap((g) =>
    g.items.map((i) => [
      g.heading,
      i.range,
      i.title,
      i.dishName,
      i.lanes,
      i.duration,
      i.status.kind === 'critical'
        ? '▲ On the critical path'
        : i.status.kind === 'slack'
          ? `Can slip ${i.status.minutes}`
          : '',
    ]),
  );
}

describe('the critical path in the view (R6.6)', () => {
  it('R6.6 the view carries the chain of H1 worked by hand: prep, roast, rest, carve', () => {
    expect([...scheduleView(H1_SCHEDULE).criticalPath].sort()).toEqual([
      'chicken.carve',
      'chicken.prep',
      'chicken.rest',
      'chicken.roast',
    ]);
  });
  it('R6.6 a rebuilt-shaped input finds the chain from its servingMin', () => {
    expect([...scheduleView(rebuiltShape()).criticalPath].sort()).toEqual([
      'chicken.carve',
      'chicken.prep',
      'chicken.rest',
      'chicken.roast',
    ]);
  });
});

describe('scheduleView (R7.4, rebuild axis)', () => {
  it('a schedule output serves at minute 0 and starts at its earliest start', () => {
    const view = scheduleView(H1_SCHEDULE);
    expect([view.servingMin, view.startMin, view.spanMin]).toEqual([0, -110, 110]);
    expect(view.steps).toHaveLength(10);
    expect(view.dishName.get('gravy')).toBe('Gravy');
    expect(view.stepById.get('gravy.roux')?.title).toBe('Make a roux in the roasting tin');
  });
  it('a rebuilt-shaped input takes servingMin from itself and spanMin from servingMin - startMin', () => {
    const shifted = rebuiltShape();
    const view = scheduleView(shifted);
    expect([view.servingMin, view.startMin, view.spanMin]).toEqual([15, -95, 110]);
  });
});

/** H1 shifted 15 minutes later with servingMin 15, as a rebuild with no change of plan would write it. */
function rebuiltShape(): Schedule & { servingMin: number } {
  const steps: ScheduledStep[] = H1_SCHEDULE.steps.map((s) => ({
    ...s,
    startMin: s.startMin + 15,
    endMin: s.endMin + 15,
  }));
  return { ...H1_SCHEDULE, steps, servingMin: 15, spanMin: 110 };
}

describe('listWait (R7.3)', () => {
  it('R7.3 reads the wait and the hold as durations', () => {
    expect(listWait(40, 10)).toBe('! Warning: waits 40 min and can wait 10 min');
    expect(listWait(75, 60)).toBe('! Warning: waits 1 h 15 min and can wait 1 h');
  });
});

describe('planListGroups (R7.1 R7.2, design H1 table at Wed 19:30)', () => {
  // Computed per test: the zone is set in beforeAll, after collection.
  const groupsH1 = (): ReturnType<typeof planListGroups> =>
    planListGroups(scheduleView(H1_SCHEDULE), WED_1930, 'en-GB');

  it('R7.1 R7.2 lists every step once, ordered by start then id, under a heading per start time', () => {
    expect(rows(groupsH1())).toEqual([
      [
        '17:40',
        '17:40–17:50',
        'Season and truss the chicken',
        'Roast chicken',
        'Cook 1',
        '10 min',
        '▲ On the critical path',
      ],
      [
        '17:50',
        '17:50–19:05',
        'Roast the chicken',
        'Roast chicken',
        'Oven 1',
        '1 h 15 min',
        '▲ On the critical path',
      ],
      [
        '17:50',
        '17:50–17:55',
        'Shred the greens',
        'Spring greens',
        'Cook 1',
        '5 min',
        'Can slip 75',
      ],
      [
        '19:05',
        '19:05–19:25',
        'Rest the chicken under foil',
        'Roast chicken',
        'Hands-free',
        '20 min',
        '▲ On the critical path',
      ],
      [
        '19:10',
        '19:10–19:12',
        'Make a roux in the roasting tin',
        'Gravy',
        'Burner 1, Cook 1',
        '2 min',
        '',
      ],
      [
        '19:12',
        '19:12–19:22',
        'Add stock and let the gravy thicken',
        'Gravy',
        'Burner 1',
        '10 min',
        '',
      ],
      [
        '19:20',
        '19:20–19:24',
        'Cook the greens in salted water',
        'Spring greens',
        'Burner 2',
        '4 min',
        '',
      ],
      ['19:22', '19:22–19:24', 'Strain the gravy into a jug', 'Gravy', 'Cook 1', '2 min', ''],
      [
        '19:24',
        '19:24–19:25',
        'Toss the greens with butter',
        'Spring greens',
        'Cook 1',
        '1 min',
        '',
      ],
      [
        '19:25',
        '19:25–19:30',
        'Carve the chicken',
        'Roast chicken',
        'Cook 1',
        '5 min',
        '▲ On the critical path',
      ],
    ]);
  });
  it('R7.1 two steps starting together share one heading; group minutes strictly increase', () => {
    const groups = groupsH1();
    expect(groups.map((g) => g.heading)).toEqual([
      '17:40',
      '17:50',
      '19:05',
      '19:10',
      '19:12',
      '19:20',
      '19:22',
      '19:24',
      '19:25',
    ]);
    expect(groups.map((g) => g.minute)).toEqual([-110, -100, -25, -20, -18, -10, -8, -6, -5]);
    expect(groups[1]?.items.map((i) => i.stepId)).toEqual(['chicken.roast', 'greens.shred']);
  });
  it('R7.2 carries the detail when present and null otherwise', () => {
    const groups = groupsH1();
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.stepId === 'gravy.roux')?.detail).toBe(
      'Use the juices left in the tin once the chicken is out.',
    );
    expect(items.find((i) => i.stepId === 'chicken.carve')?.detail).toBeNull();
  });
  it('R7.3 no item of H1 has a warning', () => {
    const groups = groupsH1();
    expect(groups.flatMap((g) => g.items).map((i) => i.warning)).toEqual(Array(10).fill(null));
  });
  it('R7.2 slack minutes are kept as a number for the component to format', () => {
    const groups = groupsH1();
    const shred = groups.flatMap((g) => g.items).find((i) => i.stepId === 'greens.shred');
    expect(shred?.status).toEqual({ kind: 'slack', minutes: 75 });
  });
});

describe('planListGroups warnings (R7.3, design H3)', () => {
  it('R7.3 Roast the potatoes carries the wait and the hold', () => {
    const groups = planListGroups(scheduleView(H3_SCHEDULE), WED_1930, 'en-GB');
    const items = groups.flatMap((g) => g.items);
    expect(items.find((i) => i.title === 'Roast the potatoes')?.warning).toBe(
      '! Warning: waits 40 min and can wait 10 min',
    );
    expect(items.filter((i) => i.warning !== null)).toHaveLength(1);
  });
});

describe('planListGroups across midnight (R7.4)', () => {
  it('R7.4 serving Thu 00:30 prefixes every heading with the weekday when the dates differ', () => {
    const groups = planListGroups(scheduleView(H1_SCHEDULE), THU_0030, 'en-GB');
    expect(groups.map((g) => g.heading)).toEqual([
      'Wed 22:40',
      'Wed 22:50',
      'Thu 00:05',
      'Thu 00:10',
      'Thu 00:12',
      'Thu 00:20',
      'Thu 00:22',
      'Thu 00:24',
      'Thu 00:25',
    ]);
  });
  it('R7.4 no prefix when start and serving share a date', () => {
    const groups = planListGroups(scheduleView(H1_SCHEDULE), WED_1930, 'en-GB');
    expect(groups.every((g) => !/^[A-Z][a-z]{2} /.test(g.heading))).toBe(true);
  });
});

describe('planListGroups on a rebuilt-shaped schedule (R7.1)', () => {
  it('uses servingMin 15 as the serving instant: chosenMs is minute 0, not the serving time', () => {
    // chosen 19:30 is minute 0; serving is minute 15 = 19:45; prep starts at minute -95 = 17:55.
    const groups = planListGroups(scheduleView(rebuiltShape()), WED_1930, 'en-GB');
    expect(groups[0]?.heading).toBe('17:55');
    expect(groups[0]?.items[0]?.range).toBe('17:55–18:05');
    expect(groups[groups.length - 1]?.items[0]?.range).toBe('19:40–19:45');
  });
});

describe('fixture sanity', () => {
  it('the plan behind H1 is SUNDAY_ROAST', () => {
    expect(H1_SCHEDULE.plan.title).toBe(SUNDAY_ROAST.title);
  });
});
