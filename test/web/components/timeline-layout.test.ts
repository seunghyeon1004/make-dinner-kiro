import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalPlan } from '../../../src/core/index.js';
import type { Plan, Schedule, ScheduledStep, Step } from '../../../src/core/index.js';
import { layoutTimeline } from '../../../src/web/components/timeline-layout.js';
import type { TimelineBar } from '../../../src/web/components/timeline-layout.js';
import { scheduleView } from '../../../src/web/state/schedule-view.js';
import { H1_SCHEDULE, HOME_KITCHEN } from '../../support/fixtures.js';

const original = process.env['TZ'];
const at = (iso: string): number => Date.parse(iso);

beforeAll(() => {
  process.env['TZ'] = 'Europe/London';
  expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
});
afterAll(() => {
  if (original === undefined) delete process.env['TZ'];
  else process.env['TZ'] = original;
});

const WED_1930 = at('2026-11-11T19:30:00Z');
const THU_0030 = at('2026-11-12T00:30:00Z');

/** A bar as the design's H1 table writes it: id left/width fill dashed label critical. */
function bar(b: TimelineBar): string {
  return [
    b.stepId,
    `${b.leftPx}/${b.widthPx}`,
    b.fill,
    b.dashed ? 'dashed' : '-',
    b.showLabel ? 'label' : '-',
    b.critical ? '▲' : '-',
  ].join(' ');
}

describe('layoutTimeline: the design H1 table at Wed 19:30 (R6.1 to R6.6)', () => {
  const layout = (): ReturnType<typeof layoutTimeline> =>
    layoutTimeline(scheduleView(H1_SCHEDULE), WED_1930, 'en-GB');

  it('R6.3 origin is 17:40 rounded down to 17:30 (minute -120), the axis ends at 0, 720 px wide', () => {
    const l = layout();
    expect([l.originMin, l.endMin, l.widthPx]).toEqual([-120, 0, 720]);
  });
  it('R6.4 nine quarter-hour ticks from 17:30 to 19:30 at 0, 90, … 720 px; the serve line at 720', () => {
    const l = layout();
    expect(l.ticks.map((t) => [t.label, t.leftPx])).toEqual([
      ['17:30', 0],
      ['17:45', 90],
      ['18:00', 180],
      ['18:15', 270],
      ['18:30', 360],
      ['18:45', 450],
      ['19:00', 540],
      ['19:15', 630],
      ['19:30', 720],
    ]);
    expect([l.serveLeftPx, l.serveLabel]).toEqual([720, 'Serve 19:30']);
  });
  it('R6.1 rows run Cook 1, Burner 1, Burner 2, Oven 1, Hands-free', () => {
    expect(layout().rows.map((r) => [r.kind, r.label])).toEqual([
      ['cook', 'Cook 1'],
      ['burner', 'Burner 1'],
      ['burner', 'Burner 2'],
      ['oven', 'Oven 1'],
      ['hands-free', 'Hands-free'],
    ]);
  });
  it('R6.1 R6.5 R6.6 every bar of every row, by the formula (minute - origin) x 6', () => {
    const rows = layout().rows;
    expect(rows.map((r) => r.bars.map(bar))).toEqual([
      [
        'chicken.prep 60/60 plain - label -',
        'greens.shred 120/30 plain - - -',
        'gravy.roux 600/12 burner - - ▲',
        'gravy.strain 672/12 plain - - ▲',
        'greens.toss 684/6 plain - - ▲',
        'chicken.carve 690/30 plain - - ▲',
      ],
      ['gravy.roux 600/12 burner - - ▲', 'gravy.simmer 612/60 burner dashed label ▲'],
      ['greens.boil 660/24 burner dashed - ▲'],
      ['chicken.roast 120/450 oven dashed label ▲'],
      ['chicken.rest 570/120 plain dashed label ▲'],
    ]);
  });
  it('R6.6 chicken.prep keeps and has slack 0: no critical mark; the bar still carries its title', () => {
    const prep = layout().rows[0]?.bars[0];
    expect(prep?.critical).toBe(false);
    expect(prep?.title).toBe('Season and truss the chicken');
  });
});

describe('layoutTimeline across midnight (R6.4)', () => {
  it('R6.4 serving Thu 00:30 labels the midnight tick with the weekday', () => {
    const l = layoutTimeline(scheduleView(H1_SCHEDULE), THU_0030, 'en-GB');
    expect(l.ticks.map((t) => t.label)).toEqual([
      '22:30',
      '22:45',
      '23:00',
      '23:15',
      '23:30',
      '23:45',
      'Thu 00:00',
      '00:15',
      '00:30',
    ]);
    expect(l.serveLabel).toBe('Serve 00:30');
  });
});

/** Builds a hand-written schedule: every step on the cook unless `free`. */
function handWritten(
  rows: readonly { id: string; start: number; minutes: number; free?: boolean }[],
): Schedule {
  const steps: Step[] = rows.map((r) => ({
    id: `x.${r.id}`,
    dish: 'x',
    title: `Step ${r.id}`,
    minutes: r.minutes,
    appliance: 'none',
    handsOn: r.free !== true,
    after: [],
    holdMin: 30,
  }));
  const plan: Plan = canonicalPlan({
    title: 'Hand written',
    dishes: [{ id: 'x', name: 'X' }],
    steps,
  });
  const scheduled: ScheduledStep[] = rows.map((r) => ({
    id: `x.${r.id}`,
    startMin: r.start,
    endMin: r.start + r.minutes,
    lanes: { burner: null, oven: null, cook: r.free === true ? null : 1 },
    slackMin: 5,
    critical: false,
    waitMin: 0,
  }));
  return {
    plan,
    kitchen: HOME_KITCHEN,
    steps: scheduled,
    spanMin: 60,
    chainMin: 60,
    warnings: [],
  };
}

describe('layoutTimeline: hands-free rows (R6.2)', () => {
  it('R6.2 two overlapping hands-free steps give Hands-free 1 and Hands-free 2', () => {
    const l = layoutTimeline(
      scheduleView(
        handWritten([
          { id: 'a', start: -30, minutes: 30, free: true },
          { id: 'b', start: -20, minutes: 20, free: true },
        ]),
      ),
      WED_1930,
      'en-GB',
    );
    expect(l.rows.map((r) => [r.label, r.bars.map((b) => b.stepId)])).toEqual([
      ['Hands-free 1', ['x.a']],
      ['Hands-free 2', ['x.b']],
    ]);
  });
  it('R6.2 steps that touch end to end share one row, labelled Hands-free', () => {
    const l = layoutTimeline(
      scheduleView(
        handWritten([
          { id: 'a', start: -30, minutes: 10, free: true },
          { id: 'b', start: -20, minutes: 20, free: true },
        ]),
      ),
      WED_1930,
      'en-GB',
    );
    expect(l.rows.map((r) => [r.label, r.bars.map((b) => b.stepId)])).toEqual([
      ['Hands-free', ['x.a', 'x.b']],
    ]);
  });
});

describe('layoutTimeline: bar width and label (R6.5)', () => {
  it('R6.5 an 8-minute bar is 48 px with no label, a 9-minute bar 54 px with none, a 10-minute bar 60 px with one', () => {
    const l = layoutTimeline(
      scheduleView(
        handWritten([
          { id: 'eight', start: -40, minutes: 8 },
          { id: 'nine', start: -30, minutes: 9 },
          { id: 'ten', start: -20, minutes: 10 },
        ]),
      ),
      WED_1930,
      'en-GB',
    );
    const widths = l.rows[0]?.bars.map((b) => [b.stepId, b.widthPx, b.showLabel]);
    expect(widths).toEqual([
      ['x.eight', 48, false],
      ['x.nine', 54, false],
      ['x.ten', 60, true],
    ]);
  });
});

describe('layoutTimeline on a rebuilt-shaped schedule (R6.3)', () => {
  it('R6.3 servingMin 15: the axis ends at 15 rounded up to a quarter hour and the serve line sits there', () => {
    const shifted: Schedule & { servingMin: number } = {
      ...H1_SCHEDULE,
      steps: H1_SCHEDULE.steps.map((s) => ({
        ...s,
        startMin: s.startMin + 15,
        endMin: s.endMin + 15,
      })),
      servingMin: 15,
    };
    // chosen 19:30 is minute 0; the first start is minute -95 = 17:55, so the origin is 17:45 = -105.
    const l = layoutTimeline(scheduleView(shifted), WED_1930, 'en-GB');
    expect([l.originMin, l.endMin, l.widthPx]).toEqual([-105, 15, 720]);
    expect([l.serveLeftPx, l.serveLabel]).toEqual([720, 'Serve 19:45']);
    expect(l.ticks[0]?.label).toBe('17:45');
    expect(l.ticks[l.ticks.length - 1]?.label).toBe('19:45');
    expect(l.rows[0]?.bars[0]).toMatchObject({ stepId: 'chicken.prep', leftPx: 60, widthPx: 60 });
  });
});
