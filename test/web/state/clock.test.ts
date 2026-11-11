import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  clockAt,
  defaultServing,
  earliestServing,
  formatClock,
  formatDay,
  formatDuration,
  formatWeekday,
  minuteAt,
  quarterCeil,
  quarterFloor,
  resolveServing,
  toServeTime,
} from '../../../src/web/state/clock.js';

const MIN = 60_000;
const at = (iso: string): number => Date.parse(iso);
const original = process.env['TZ'];

function setZone(zone: string): void {
  process.env['TZ'] = zone;
}

afterAll(() => {
  if (original === undefined) delete process.env['TZ'];
  else process.env['TZ'] = original;
});

describe('clock under Europe/London', () => {
  beforeAll(() => {
    setZone('Europe/London');
    // 2026-07-01 is BST (UTC+1): the offset in minutes is -60 only when the zone took effect.
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(-60);
    expect(new Date(2026, 10, 11).getTimezoneOffset()).toBe(0);
  });

  const WED_18 = at('2026-11-11T18:00:00Z');

  describe('resolveServing (R5.3)', () => {
    it('R5.3 a time later today stays today', () => {
      expect(resolveServing('19:30', WED_18)).toBe(at('2026-11-11T19:30:00Z'));
    });
    it('R5.3 a time exactly 4 h before now stays today', () => {
      expect(resolveServing('14:00', WED_18)).toBe(at('2026-11-11T14:00:00Z'));
    });
    it('R5.3 a time 4 h 1 min before now is tomorrow', () => {
      expect(resolveServing('13:59', WED_18)).toBe(at('2026-11-12T13:59:00Z'));
    });
    it('R5.3 00:30 is tomorrow', () => {
      expect(resolveServing('00:30', WED_18)).toBe(at('2026-11-12T00:30:00Z'));
    });
    it('R5.3 02:30 on the night the clocks go back is the GMT 02:30', () => {
      const now = at('2026-10-24T19:00:00Z'); // Sat 20:00 BST
      expect(resolveServing('02:30', now)).toBe(at('2026-10-25T02:30:00Z'));
    });
  });

  it('R5.5 minutes are real minutes across the DST change: 110 min before 02:30 GMT is 01:40', () => {
    const serving = at('2026-10-25T02:30:00Z');
    expect(formatClock(clockAt(serving, -110), 'en-GB')).toBe('01:40');
  });

  describe('defaultServing (R1.4)', () => {
    it('R1.4 the suggested time today when it is at least span + 15 min away', () => {
      const result = defaultServing(at('2026-11-11T10:00:00Z'), 110, '13:30');
      expect(result).toEqual({ time: '13:30', atMs: at('2026-11-11T13:30:00Z') });
    });
    it('R1.4 else the first :00 or :30 at or after now + span + 15 min', () => {
      const result = defaultServing(at('2026-11-11T12:00:00Z'), 110, '13:30');
      expect(result).toEqual({ time: '14:30', atMs: at('2026-11-11T14:30:00Z') });
    });
    it('R1.4 without a suggestion, past midnight', () => {
      const result = defaultServing(at('2026-11-11T22:50:00Z'), 110, null);
      expect(result).toEqual({ time: '01:00', atMs: at('2026-11-12T01:00:00Z') });
    });
    it('R1.4 now is rounded up to the next minute first', () => {
      const result = defaultServing(at('2026-11-11T18:00:20Z'), 110, null);
      expect(result).toEqual({ time: '20:30', atMs: at('2026-11-11T20:30:00Z') });
    });
  });

  it('R5.5 earliestServing rounds now + span up to 5 minutes', () => {
    expect(earliestServing(at('2026-11-11T17:41:10Z'), 110)).toBe(at('2026-11-11T19:35:00Z'));
  });

  it('toServeTime writes the local HH:MM', () => {
    expect(toServeTime(at('2026-07-01T18:05:00Z'))).toBe('19:05'); // BST
  });

  describe('formatting', () => {
    it('R7.4 formatDuration', () => {
      expect([1, 60, 75, 110, 1440, 45].map(formatDuration)).toEqual([
        '1 min',
        '1 h',
        '1 h 15 min',
        '1 h 50 min',
        '24 h',
        '45 min',
      ]);
    });
    it('formatClock en-GB is 24 h', () => {
      expect(formatClock(at('2026-11-11T19:30:00Z'), 'en-GB')).toBe('19:30');
    });
    it('formatClock en-US is 12 h with a space before PM', () => {
      const text = formatClock(at('2026-11-11T19:30:00Z'), 'en-US').replace(/[\u202f\u00a0]/g, ' ');
      expect(text).toBe('7:30 PM');
    });
    it('formatWeekday is the short weekday', () => {
      expect(formatWeekday(at('2026-11-11T19:30:00Z'), 'en-GB')).toBe('Wed');
    });
    it('R5.4 formatDay: today null, tomorrow, yesterday, and a date two days away', () => {
      const now = at('2026-11-11T18:00:00Z');
      expect(formatDay(at('2026-11-11T19:30:00Z'), now, 'en-GB')).toBeNull();
      expect(formatDay(at('2026-11-12T00:30:00Z'), now, 'en-GB')).toBe('tomorrow');
      expect(formatDay(at('2026-11-10T23:00:00Z'), now, 'en-GB')).toBe('yesterday');
      expect(formatDay(at('2026-11-13T09:00:00Z'), now, 'en-GB')).toBe('Fri 13 Nov');
    });
  });

  describe('minutes and quarter hours', () => {
    const chosen = at('2026-11-11T19:30:00Z');
    it('R6.3 minuteAt floors negative differences', () => {
      expect(minuteAt(chosen, chosen - 90 * MIN)).toBe(-90);
      expect(minuteAt(chosen, chosen - 90 * MIN - 1)).toBe(-91);
      expect(minuteAt(chosen, chosen + 59_999)).toBe(0);
      expect(minuteAt(chosen, chosen + 60_000)).toBe(1);
    });
    it('R6.3 quarterFloor and quarterCeil on a quarter hour return the minute', () => {
      expect(quarterFloor(chosen, -90)).toBe(-90);
      expect(quarterCeil(chosen, -90)).toBe(-90);
      expect(quarterFloor(chosen, 0)).toBe(0);
    });
    it('R6.3 off a quarter hour: 17:40 floors to 17:30 and 19:32 ceils to 19:45', () => {
      expect(quarterFloor(chosen, -110)).toBe(-120);
      expect(quarterCeil(chosen, 2)).toBe(15);
      expect(quarterCeil(chosen, -118)).toBe(-105);
    });
  });
});

describe('clock under Asia/Kathmandu (+5:45)', () => {
  beforeAll(() => {
    setZone('Asia/Kathmandu');
    expect(new Date(2026, 10, 11).getTimezoneOffset()).toBe(-345);
  });

  it('R6.3 quarter hours are local: 19:30 Kathmandu is 13:45Z, and 3 min before is not a quarter', () => {
    const chosen = at('2026-11-11T13:45:00Z'); // 19:30 local
    expect(formatClock(chosen, 'en-GB')).toBe('19:30');
    expect(quarterFloor(chosen, -3)).toBe(-15);
    expect(quarterCeil(chosen, -17)).toBe(-15);
    expect(quarterFloor(chosen, -15)).toBe(-15);
  });
});
