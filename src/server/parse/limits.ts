import { isIP } from 'node:net';

/** Time as the server sees it. Injected so tests control it. */
export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = { nowMs: () => Date.now() };

export const BODY_MAX_BYTES = 65_536;
export const MAX_TRACKED_CLIENTS = 10_000;

const DAY_MS = 86_400_000;

/** Length in Unicode code points, as zod's `max` counts it (R4.6). */
export function countChars(text: string): number {
  return [...text].length;
}

export type LimitCheck = { ok: true } | { ok: false; retryAfterSec: number };

function refuse(remainingMs: number): LimitCheck {
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

export interface RateLimiterOptions {
  limit: number;
  windowSec: number;
  maxClients?: number;
}

export interface RateLimiter {
  /** Reads only; never changes state. */
  check(clientKey: string, nowMs: number): LimitCheck;
  /** Call only after a passing check in the same turn. Prunes expired timestamps. */
  record(clientKey: string, nowMs: number): void;
  size(): { clients: number; timestamps: number };
}

/**
 * A sliding window per client (R6): a call at time `s` counts at time `t` while
 * `t - s < windowSec * 1000`. Holds at most `maxClients` keys and `limit` timestamps each.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowSec } = options;
  const maxClients = options.maxClients ?? MAX_TRACKED_CLIENTS;
  const windowMs = windowSec * 1000;
  const clients = new Map<string, number[]>();

  const liveOf = (times: readonly number[], nowMs: number): number[] =>
    times.filter((s) => nowMs - s < windowMs);

  return {
    check(key, nowMs) {
      const mine = liveOf(clients.get(key) ?? [], nowMs);
      const oldest = mine[0];
      if (oldest !== undefined && mine.length >= limit) {
        return refuse(oldest + windowMs - nowMs);
      }
      if (mine.length === 0) {
        let liveKeys = 0;
        let firstFree = Infinity;
        for (const times of clients.values()) {
          const live = liveOf(times, nowMs);
          const newest = live[live.length - 1];
          if (newest !== undefined) {
            liveKeys += 1;
            firstFree = Math.min(firstFree, newest + windowMs);
          }
        }
        if (liveKeys >= maxClients) return refuse(firstFree - nowMs);
      }
      return { ok: true };
    },

    record(key, nowMs) {
      let times = liveOf(clients.get(key) ?? [], nowMs);
      if (!clients.has(key) && clients.size >= maxClients) {
        for (const [other, otherTimes] of clients) {
          if (liveOf(otherTimes, nowMs).length === 0) clients.delete(other);
        }
      }
      times.push(nowMs);
      times.sort((a, b) => a - b);
      if (times.length > limit) times = times.slice(times.length - limit);
      clients.set(key, times);
    },

    size() {
      let timestamps = 0;
      for (const times of clients.values()) timestamps += times.length;
      return { clients: clients.size, timestamps };
    },
  };
}

export interface DailyCap {
  check(nowMs: number): LimitCheck;
  record(nowMs: number): void;
  usedToday(nowMs: number): number;
}

/**
 * At most `cap` model calls per UTC day, for all clients (R7). A clock that steps back across
 * midnight counts against the later day, so stepping back never resets the count.
 */
export function createDailyCap(cap: number): DailyCap {
  const dayOf = (ms: number): number => Math.floor(ms / DAY_MS);
  let day = -Infinity;
  let count = 0;
  const used = (nowMs: number): number => (dayOf(nowMs) > day ? 0 : count);
  return {
    check(nowMs) {
      if (used(nowMs) < cap) return { ok: true };
      return refuse((dayOf(nowMs) + 1) * DAY_MS - nowMs);
    },
    record(nowMs) {
      if (dayOf(nowMs) > day) {
        day = dayOf(nowMs);
        count = 0;
      }
      count += 1;
    },
    usedToday: used,
  };
}

export interface ClientKeyInput {
  forwardedFor: string | undefined;
  peerAddress: string | undefined;
  trustProxy: boolean;
}

const IPV4_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV4_TAIL = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/;

/** Removes `[...]` brackets with an optional `:port`, or a `:port` after a dotted IPv4. */
function stripBracketsAndPort(entry: string): string {
  const text = entry.trim();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end === -1 || !/^(?::\d{1,5})?$/.test(text.slice(end + 1))) return '';
    return text.slice(1, end);
  }
  return IPV4_PORT.exec(text)?.[1] ?? text;
}

/** IPv4 as is, IPv4-mapped IPv6 as its IPv4 tail, other IPv6 as its /64 prefix. */
function normaliseAddress(address: string): string {
  const bare = address.split('%')[0] ?? '';
  const version = isIP(bare);
  if (version === 4) return bare;
  if (version !== 6) return 'unknown';
  const mapped = IPV4_MAPPED.exec(bare)?.[1];
  if (mapped !== undefined && isIP(mapped) === 4) return mapped;

  let text = bare;
  const tail = IPV4_TAIL.exec(text);
  if (tail?.[1] !== undefined && tail[2] !== undefined) {
    const [a = 0, b = 0, c = 0, d = 0] = tail[2].split('.').map(Number);
    text = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  let hextets: string[];
  if (text.includes('::')) {
    const [head = '', rest = ''] = text.split('::');
    const front = head === '' ? [] : head.split(':');
    const back = rest === '' ? [] : rest.split(':');
    hextets = [...front, ...Array<string>(8 - front.length - back.length).fill('0'), ...back];
  } else {
    hextets = text.split(':');
  }
  const prefix = hextets.slice(0, 4).map((part) => Number.parseInt(part, 16).toString(16));
  return `${prefix.join(':')}::/64`;
}

/**
 * The rate-limit key of a request (R6.5 to R6.7). With `trustProxy` it is the rightmost
 * `X-Forwarded-For` entry, which is the one the platform's proxy appended and the client
 * cannot forge; otherwise, or when that entry is not an address, the TCP peer.
 */
export function clientKey(input: ClientKeyInput): string {
  if (input.trustProxy && input.forwardedFor !== undefined) {
    const last = input.forwardedFor.slice(input.forwardedFor.lastIndexOf(',') + 1);
    const candidate = stripBracketsAndPort(last);
    if (isIP(candidate) !== 0) return normaliseAddress(candidate);
  }
  return input.peerAddress === undefined ? 'unknown' : normaliseAddress(input.peerAddress);
}
