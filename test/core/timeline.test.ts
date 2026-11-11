import { describe, expect, it } from 'vitest';
import {
  capacityOf,
  createTimeline,
  earliestFit,
  latestFit,
  RESOURCES,
  resourcesOf,
} from '../../src/core/timeline.js';
import type { Capacity, Resource } from '../../src/core/timeline.js';

const ONE_EACH: Capacity = { burner: 1, oven: 1, cook: 1 };

describe('R3.5 capacityOf and resourcesOf', () => {
  it('RESOURCES lists burner, oven, cook in that order', () => {
    expect(RESOURCES).toEqual(['burner', 'oven', 'cook']);
  });
  it('capacityOf reads burners, ovens and cooks', () => {
    expect(capacityOf({ burners: 4, ovens: 1, cooks: 2 })).toEqual({
      burner: 4,
      oven: 1,
      cook: 2,
    });
    expect(capacityOf({ burners: 0, ovens: 0, cooks: 1 })).toEqual({
      burner: 0,
      oven: 0,
      cook: 1,
    });
  });
  it.each([
    ['burner', true, ['burner', 'cook']],
    ['burner', false, ['burner']],
    ['oven', true, ['oven', 'cook']],
    ['oven', false, ['oven']],
    ['none', true, ['cook']],
    ['none', false, []],
  ] as const)('resourcesOf(%s, handsOn %s) is %j', (appliance, handsOn, expected) => {
    expect(resourcesOf({ appliance, handsOn })).toEqual(expected);
  });
});

describe('R3.4 Timeline usage, add and remove', () => {
  it('an empty timeline has usage 0 everywhere', () => {
    const tl = createTimeline(ONE_EACH);
    for (const r of RESOURCES) expect(tl.usage(r, -7)).toBe(0);
  });
  it('add counts one use per minute of [start, end) for each listed resource only', () => {
    const tl = createTimeline({ burner: 2, oven: 2, cook: 2 });
    tl.add(['burner', 'cook'], -10, -5);
    for (const minute of [-10, -9, -8, -7, -6]) {
      expect([minute, tl.usage('burner', minute), tl.usage('cook', minute)]).toEqual([
        minute,
        1,
        1,
      ]);
    }
    expect([tl.usage('burner', -11), tl.usage('burner', -5)]).toEqual([0, 0]);
    expect(tl.usage('oven', -8)).toBe(0);
  });
  it('uses add up and remove takes them off again', () => {
    const tl = createTimeline({ burner: 2, oven: 2, cook: 2 });
    tl.add(['oven'], -6, -2);
    tl.add(['oven'], -4, 0);
    expect([-6, -5, -4, -3, -2, -1].map((t) => tl.usage('oven', t))).toEqual([1, 1, 2, 2, 1, 1]);
    tl.remove(['oven'], -4, 0);
    expect([-6, -5, -4, -3, -2, -1].map((t) => tl.usage('oven', t))).toEqual([1, 1, 1, 1, 0, 0]);
    tl.remove(['oven'], -6, -2);
    expect([-6, -3, -1].map((t) => tl.usage('oven', t))).toEqual([0, 0, 0]);
  });
});

describe('R3.4 lastFull and firstFull', () => {
  it('a minute is full when one more use would pass the capacity', () => {
    const tl = createTimeline({ burner: 2, oven: 1, cook: 1 });
    tl.add(['burner'], -10, -5);
    // One use of two burners: not full.
    expect(tl.lastFull(['burner'], -20, 0)).toBeNull();
    tl.add(['burner'], -8, -6);
    // Two uses at -8 and -7: full.
    expect(tl.firstFull(['burner'], -20, 0)).toBe(-8);
    expect(tl.lastFull(['burner'], -20, 0)).toBe(-7);
  });
  it('finds the first and last full minute of the window, and only inside it', () => {
    const tl = createTimeline(ONE_EACH);
    tl.add(['burner'], -10, -5);
    expect(tl.firstFull(['burner'], -20, 0)).toBe(-10);
    expect(tl.lastFull(['burner'], -20, 0)).toBe(-6);
    expect(tl.firstFull(['burner'], -8, 0)).toBe(-8);
    expect(tl.lastFull(['burner'], -20, -8)).toBe(-9);
    expect(tl.lastFull(['burner'], -4, 0)).toBeNull();
    expect(tl.firstFull(['burner'], -20, -10)).toBeNull();
  });
  it('looks at the listed resources only, any one of them being full counts', () => {
    const tl = createTimeline(ONE_EACH);
    tl.add(['oven'], -3, -1);
    expect(tl.lastFull(['burner'], -10, 0)).toBeNull();
    expect(tl.lastFull(['burner', 'oven'], -10, 0)).toBe(-2);
    expect(tl.firstFull(['cook', 'oven'], -10, 0)).toBe(-3);
  });
  it('an empty resource list and an empty window have no full minute', () => {
    const tl = createTimeline(ONE_EACH);
    tl.add(['burner'], -10, 0);
    expect(tl.lastFull([], -10, 0)).toBeNull();
    expect(tl.firstFull([], -10, 0)).toBeNull();
    expect(tl.lastFull(['burner'], -5, -5)).toBeNull();
    expect(tl.firstFull(['burner'], -5, -5)).toBeNull();
  });
  it('a resource with capacity 0 is full everywhere', () => {
    const tl = createTimeline({ burner: 0, oven: 1, cook: 1 });
    expect(tl.firstFull(['burner'], -3, 0)).toBe(-3);
    expect(tl.lastFull(['burner'], -3, 0)).toBe(-1);
  });
});

describe('R3.4 latestFit and earliestFit', () => {
  const busyBurner = () => {
    const tl = createTimeline(ONE_EACH);
    tl.add(['burner'], -10, -5);
    return tl;
  };

  it('latestFit returns the upper end when the window is free', () => {
    expect(latestFit(busyBurner(), ['burner'], 3, -2, -100)).toBe(-2);
    expect(latestFit(busyBurner(), ['burner'], 3, 0, -100)).toBe(0);
  });
  it('latestFit steps over a busy block: 8 minutes ending at 0 must end at -10', () => {
    // Busy minutes -10..-6. A window of 8 ending after -5 would pass 0, so it ends at -10.
    expect(latestFit(busyBurner(), ['burner'], 8, 0, -100)).toBe(-10);
  });
  it('latestFit fits into a gap between two blocks', () => {
    const tl = createTimeline(ONE_EACH);
    tl.add(['burner'], -20, -12);
    tl.add(['burner'], -6, -2);
    // Busy minutes are -20..-13 and -6..-3, so -12..-7 are free: 4 minutes fit ending at -6.
    expect(latestFit(tl, ['burner'], 4, -2, -100)).toBe(-6);
    // 7 minutes do not fit between the blocks, so it ends before the first one.
    expect(latestFit(tl, ['burner'], 7, -2, -100)).toBe(-20);
  });
  it('earliestFit returns the lower start when the window is free', () => {
    expect(earliestFit(busyBurner(), ['burner'], 2, -20, 0)).toBe(-20);
    expect(earliestFit(busyBurner(), ['burner'], 5, -5, 0)).toBe(-5);
  });
  it('earliestFit steps over a busy block: 3 minutes from -12 start at -5', () => {
    expect(earliestFit(busyBurner(), ['burner'], 3, -12, 0)).toBe(-5);
  });
  it('an empty resource list returns the first candidate', () => {
    const tl = busyBurner();
    expect(latestFit(tl, [], 5, -3, -100)).toBe(-3);
    expect(earliestFit(tl, [], 5, -50, 0)).toBe(-50);
  });
  it('two resources: the window must be free on both', () => {
    // Burner busy at -10 and -9, cook busy at -6 and -5.
    const tl = createTimeline(ONE_EACH);
    tl.add(['burner'], -10, -8);
    tl.add(['cook'], -6, -4);
    // 3 minutes ending at or before -3: every end from -3 down to -9 has a busy minute in its
    // window; [-13, -10) is the first free one.
    expect(latestFit(tl, ['burner', 'cook'], 3, -3, -100)).toBe(-10);
    expect(latestFit(tl, ['burner'], 3, -3, -100)).toBe(-3);
    // Starting at -11 or later: the first free window starts at -4.
    expect(earliestFit(tl, ['burner', 'cook'], 3, -11, 0)).toBe(-4);
    expect(earliestFit(tl, ['burner'], 3, -11, 0)).toBe(-8);
  });
  it('latestFit throws when the start would be below the floor, not when it equals it', () => {
    expect(() => latestFit(busyBurner(), ['burner'], 8, 0, -17)).toThrow();
    expect(latestFit(busyBurner(), ['burner'], 8, 0, -18)).toBe(-10);
  });
  it('latestFit throws instead of looping when the resource has capacity 0', () => {
    const tl = createTimeline({ burner: 0, oven: 1, cook: 1 });
    expect(() => latestFit(tl, ['burner'], 2, 0, -50)).toThrow();
  });
  it('earliestFit throws when the start would be above the ceiling, not when it equals it', () => {
    expect(() => earliestFit(busyBurner(), ['burner'], 3, -12, -6)).toThrow();
    expect(earliestFit(busyBurner(), ['burner'], 3, -12, -5)).toBe(-5);
  });
  it('earliestFit throws instead of looping when the resource has capacity 0', () => {
    const tl = createTimeline({ burner: 0, oven: 1, cook: 1 });
    expect(() => earliestFit(tl, ['burner'], 2, -50, 0)).toThrow();
  });
});

describe('R3.4, N2 the jump gives the same answer as trying every candidate', () => {
  // Every pattern of busy minutes in [-6, 0) for one burner and one cook (capacity 1 each),
  // every length 1..3, every upper end -6..0 and lower start -6..0, against a plain scan.
  const MINUTES = [-6, -5, -4, -3, -2, -1];
  const patternsFor = (mask: number): number[] => MINUTES.filter((_m, i) => (mask >> i) & 1);

  function timelineOf(burnerMask: number, cookMask: number) {
    const tl = createTimeline(ONE_EACH);
    for (const m of patternsFor(burnerMask)) tl.add(['burner'], m, m + 1);
    for (const m of patternsFor(cookMask)) tl.add(['cook'], m, m + 1);
    return { tl, burner: new Set(patternsFor(burnerMask)), cook: new Set(patternsFor(cookMask)) };
  }

  const free = (busy: Record<Resource, Set<number>>, rs: Resource[], from: number, to: number) => {
    for (let t = from; t < to; t++) {
      if (rs.some((r) => busy[r].has(t))) return false;
    }
    return true;
  };

  it('latestFit and earliestFit agree with a scan over all 64 x 64 patterns', () => {
    const rs: Resource[] = ['burner', 'cook'];
    let checked = 0;
    for (let burnerMask = 0; burnerMask < 64; burnerMask++) {
      for (let cookMask = 0; cookMask < 64; cookMask++) {
        const { tl, burner, cook } = timelineOf(burnerMask, cookMask);
        const busy = { burner, cook, oven: new Set<number>() };
        for (let minutes = 1; minutes <= 3; minutes++) {
          for (let edge = -6; edge <= 0; edge++) {
            // Latest end at or below `edge`: the window sits wholly below `edge`.
            let expectedEnd = edge;
            while (!free(busy, rs, expectedEnd - minutes, expectedEnd)) expectedEnd--;
            expect(latestFit(tl, rs, minutes, edge, -100)).toBe(expectedEnd);
            // Earliest start at or above `edge`.
            let expectedStart = edge;
            while (!free(busy, rs, expectedStart, expectedStart + minutes)) expectedStart++;
            expect(earliestFit(tl, rs, minutes, edge, 100)).toBe(expectedStart);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(64 * 64 * 3 * 7);
  });
});
