import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalPlan } from '../../../src/core/index.js';
import type { Plan, Schedule, ScheduledStep, Step } from '../../../src/core/index.js';
import { layoutTimeline, thinTicks } from '../../../src/web/components/timeline-layout.js';
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
  it('R6.4 quarter-hour ticks from 17:30 at 0, 90, … px; 19:15 and 19:30 give way to "Serve 19:30" (review C); the serve line at 720', () => {
    // Nine ticks by the quarter hour; the serve label is 11 characters, 118.8 px, so it starts
    // at 601.2. 19:00 ends at 540 + 5 x 10.8 + 5 = 599: it fits. 19:15 starts at 630 and 19:30
    // is at the serve line: both are dropped.
    const l = layout();
    expect(l.ticks.map((t) => [t.label, t.leftPx])).toEqual([
      ['17:30', 0],
      ['17:45', 90],
      ['18:00', 180],
      ['18:15', 270],
      ['18:30', 360],
      ['18:45', 450],
      ['19:00', 540],
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
        'chicken.prep 60/60 plain - label ▲',
        'greens.shred 120/30 plain - - -',
        'gravy.roux 600/12 burner - - -',
        'gravy.strain 672/12 plain - - -',
        'greens.toss 684/6 plain - - -',
        'chicken.carve 690/30 plain - - ▲',
      ],
      ['gravy.roux 600/12 burner - - -', 'gravy.simmer 612/60 burner dashed label -'],
      ['greens.boil 660/24 burner dashed - -'],
      ['chicken.roast 120/450 oven dashed label ▲'],
      ['chicken.rest 570/120 plain dashed label ▲'],
    ]);
  });
  it('R6.6 only the critical path carries the mark; gravy.roux has slack 0 and none', () => {
    const marked = layout().rows.flatMap((r) =>
      r.bars.filter((b) => b.critical).map((b) => b.stepId),
    );
    expect([...new Set(marked)].sort()).toEqual([
      'chicken.carve',
      'chicken.prep',
      'chicken.rest',
      'chicken.roast',
    ]);
  });
});

describe('layoutTimeline across midnight (R6.4)', () => {
  it('R6.4 serving Thu 00:30 labels the midnight tick with the weekday', () => {
    // Serving Thu 01:30: ticks 23:30 (0) … 01:30 (720). "Thu 00:00" at 180 is 9 characters, so it
    // spans 180 to 282.2 and hides 00:15 (270); 00:30 (360) fits; 01:15 and 01:30 give way to
    // "Serve 01:30" (starts at 601.2) and 01:00 ends at 599.
    const l = layoutTimeline(scheduleView(H1_SCHEDULE), at('2026-11-12T01:30:00Z'), 'en-GB');
    expect(l.ticks.map((t) => t.label)).toEqual([
      '23:30',
      '23:45',
      'Thu 00:00',
      '00:30',
      '00:45',
      '01:00',
    ]);
    expect(l.serveLabel).toBe('Serve 01:30');
  });
  it('R6.4 review C: serving Thu 00:30 loses its midnight tick to the serve label; the others remain', () => {
    // Thu 00:00 sits at 540 and would end at 642.2, past the serve label start 601.2.
    const l = layoutTimeline(scheduleView(H1_SCHEDULE), THU_0030, 'en-GB');
    expect(l.ticks.map((t) => t.label)).toEqual([
      '22:30',
      '22:45',
      '23:00',
      '23:15',
      '23:30',
      '23:45',
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
    // 19:15 is at 540 and ends at 599, before "Serve 19:45" starts at 601.2; 19:30 and 19:45 give way.
    expect(l.ticks[l.ticks.length - 1]?.label).toBe('19:15');
    expect(l.rows[0]?.bars[0]).toMatchObject({ stepId: 'chicken.prep', leftPx: 60, widthPx: 60 });
  });
});

describe('thinTicks (review C): no tick label overlaps the next one or the serve label', () => {
  const tick = (
    label: string,
    leftPx: number,
  ): { minute: number; leftPx: number; label: string } => ({
    minute: leftPx / 6,
    leftPx,
    label,
  });
  it('C the serve label wins: with "Serve 9:00 PM" (starts at 579.6) the 8:45 PM tick and the tick at serve are dropped', () => {
    // 8:30 PM at 450 ends at 450 + 7 x 10.8 + 5 = 530.6: kept. 8:45 PM at 540 would end at 620.6.
    const ticks = [tick('8:30 PM', 450), tick('8:45 PM', 540), tick('9:00 PM', 720)];
    expect(thinTicks(ticks, 720, 'Serve 9:00 PM').map((t) => t.label)).toEqual(['8:30 PM']);
  });
  it('C a label that would overlap the next one keeps the earlier: "Thu 00:00" at 90 ends at 192.2 and hides 00:15 at 180', () => {
    const ticks = [tick('23:45', 0), tick('Thu 00:00', 90), tick('00:15', 180), tick('00:30', 270)];
    expect(thinTicks(ticks, 720, 'Serve 02:00').map((t) => t.label)).toEqual([
      '23:45',
      'Thu 00:00',
      '00:30',
    ]);
  });
  it('C ticks with room are all kept, in order', () => {
    const ticks = [tick('17:30', 0), tick('17:45', 90), tick('18:00', 180)];
    expect(thinTicks(ticks, 720, 'Serve 19:30')).toEqual(ticks);
  });
});
