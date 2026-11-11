import type { ServeTime } from '../../core/index.js';

/**
 * The time mapping of plan-ui (design, "Time"). Minutes are real minutes: `clockAt` adds
 * milliseconds, so a plan across a DST change stays physically right. Local-time work uses
 * the runtime's time zone through `Date` local methods; formatting uses `Intl.DateTimeFormat`
 * with an undefined locale meaning the user's.
 */
export const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface Clock {
  nowMs(): number;
}

/** The chosen serving time: minute 0 of the axis for the whole meal. */
export interface Serving {
  time: ServeTime;
  atMs: number;
}

/** Reads the system clock. Used only by effects and `useNow`. */
export const systemClock: Clock = { nowMs: () => Date.now() };

export function clockAt(chosenMs: number, minute: number): number {
  return chosenMs + minute * MINUTE_MS;
}

export function minuteAt(chosenMs: number, nowMs: number): number {
  return Math.floor((nowMs - chosenMs) / MINUTE_MS);
}

function ceilMinute(ms: number): number {
  return Math.ceil(ms / MINUTE_MS) * MINUTE_MS;
}

/** The first instant at that local clock time at or after 4 hours before `nowMs` (R5.3). */
export function resolveServing(time: ServeTime, nowMs: number): number {
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3, 5));
  const today = new Date(nowMs);
  const floor = nowMs - 4 * HOUR_MS;
  let latest = 0;
  for (let k = -1; k <= 2; k += 1) {
    const candidate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + k,
      hours,
      minutes,
    ).getTime();
    latest = candidate;
    if (candidate >= floor) return candidate;
  }
  return latest;
}

export function toServeTime(ms: number): ServeTime {
  const date = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The first local :00 or :30 at or after `ms` (which is minute-aligned). */
function nextHalfHour(ms: number): number {
  const minutes = new Date(ms).getMinutes();
  return ms + ((30 - (minutes % 30)) % 30) * MINUTE_MS;
}

export function defaultServing(
  nowMs: number,
  spanMin: number,
  suggested: ServeTime | null,
): Serving {
  const need = ceilMinute(nowMs) + (spanMin + 15) * MINUTE_MS;
  if (suggested !== null) {
    const hours = Number(suggested.slice(0, 2));
    const minutes = Number(suggested.slice(3, 5));
    const today = new Date(nowMs);
    const candidate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      hours,
      minutes,
    ).getTime();
    if (candidate >= need) return { time: suggested, atMs: candidate };
  }
  const atMs = nextHalfHour(need);
  return { time: toServeTime(atMs), atMs };
}

export function earliestServing(nowMs: number, spanMin: number): number {
  const base = ceilMinute(nowMs) + spanMin * MINUTE_MS;
  const minutes = new Date(base).getMinutes();
  return base + ((5 - (minutes % 5)) % 5) * MINUTE_MS;
}

/** Largest minute `<= minute` that falls on a local quarter hour. */
export function quarterFloor(chosenMs: number, minute: number): number {
  const local = new Date(clockAt(chosenMs, minute)).getMinutes();
  return minute - (local % 15);
}

/** Smallest minute `>= minute` that falls on a local quarter hour. */
export function quarterCeil(chosenMs: number, minute: number): number {
  const local = new Date(clockAt(chosenMs, minute)).getMinutes();
  return minute + ((15 - (local % 15)) % 15);
}

export function sameLocalDate(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

export function formatClock(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(ms);
}

export function formatWeekday(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(ms);
}

/** `null` for today, "tomorrow", "yesterday", else a short date like "Fri 13 Nov". */
export function formatDay(ms: number, nowMs: number, locale?: string): string | null {
  if (sameLocalDate(ms, nowMs)) return null;
  const now = new Date(nowMs);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (sameLocalDate(ms, tomorrow)) return 'tomorrow';
  if (sameLocalDate(ms, yesterday)) return 'yesterday';
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(ms)
    .replace(',', '');
}

/** "1 min", "45 min", "1 h", "1 h 50 min". */
export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
