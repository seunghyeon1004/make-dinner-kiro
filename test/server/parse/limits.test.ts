import { describe, expect, it } from 'vitest';
import {
  clientKey,
  countChars,
  createDailyCap,
  createRateLimiter,
} from '../../../src/server/parse/limits.js';

describe('R4.6 countChars counts Unicode code points', () => {
  it('R4.6 counts an emoji and a combining sequence by code point, not by UTF-16 unit', () => {
    expect(countChars('')).toBe(0);
    expect(countChars('abc')).toBe(3);
    expect(countChars('🍳🍳')).toBe(2); // two code points, four UTF-16 units
    expect(countChars('e\u0301')).toBe(2); // e plus a combining accent
  });
});

describe('R6 createRateLimiter (limit 2, window 10 s)', () => {
  function limiter(maxClients?: number) {
    return createRateLimiter({
      limit: 2,
      windowSec: 10,
      ...(maxClients === undefined ? {} : { maxClients }),
    });
  }

  it('R6.1 R6.3 calls at 0 and 1,000 pass; at 2,000 the check refuses with Retry-After 8', () => {
    const l = limiter();
    expect(l.check('a', 0)).toEqual({ ok: true });
    l.record('a', 0);
    expect(l.check('a', 1_000)).toEqual({ ok: true });
    l.record('a', 1_000);
    // The oldest call (0) leaves the window at 10,000: 8,000 ms after 2,000.
    expect(l.check('a', 2_000)).toEqual({ ok: false, retryAfterSec: 8 });
  });

  it('R6.2 R6.3 at 9,999 Retry-After is 1; at 10,000 the oldest call has left the window and it passes', () => {
    const l = limiter();
    l.record('a', 0);
    l.record('a', 1_000);
    expect(l.check('a', 9_999)).toEqual({ ok: false, retryAfterSec: 1 });
    expect(l.check('a', 10_000)).toEqual({ ok: true });
  });

  it('R6.3 rounds Retry-After up: 8,001 ms is 9 seconds', () => {
    const l = limiter();
    l.record('a', 0);
    l.record('a', 1);
    expect(l.check('a', 1_999)).toEqual({ ok: false, retryAfterSec: 9 });
  });

  it('R6.1 clients are independent', () => {
    const l = limiter();
    l.record('a', 0);
    l.record('a', 0);
    expect(l.check('a', 5)).toEqual({ ok: false, retryAfterSec: 10 });
    expect(l.check('b', 5)).toEqual({ ok: true });
  });

  it('R6.1 recording more than the limit keeps the latest calls and drops the oldest', () => {
    const l = limiter();
    l.record('a', 0);
    l.record('a', 100);
    l.record('a', 200);
    expect(l.size()).toEqual({ clients: 1, timestamps: 2 });
    // The oldest kept call is 100, which leaves the window at 10,100.
    expect(l.check('a', 300)).toEqual({ ok: false, retryAfterSec: 10 });
  });

  it('R6.8 check leaves size() unchanged, also for a client it has never seen', () => {
    const l = limiter();
    l.record('a', 0);
    const before = l.size();
    l.check('a', 1);
    l.check('b', 1);
    l.check('a', 20_000);
    expect(before).toEqual({ clients: 1, timestamps: 1 });
    expect(l.size()).toEqual(before);
  });

  it('R6.8 record prunes timestamps that left the window', () => {
    const l = limiter();
    l.record('a', 0);
    l.record('a', 1_000);
    l.record('a', 10_500); // 0 has left the window, 1,000 has not
    expect(l.size()).toEqual({ clients: 1, timestamps: 2 });
    l.record('a', 25_000); // both have left
    expect(l.size()).toEqual({ clients: 1, timestamps: 1 });
  });

  it('R6.8 with maxClients 1 a second client is refused until the first frees', () => {
    const l = limiter(1);
    l.record('a', 0);
    // a's newest call is 0 and leaves the window at 10,000: 9,000 ms after 1,000.
    expect(l.check('b', 1_000)).toEqual({ ok: false, retryAfterSec: 9 });
    expect(l.check('a', 1_000)).toEqual({ ok: true }); // the known client is not refused
    expect(l.check('b', 9_999)).toEqual({ ok: false, retryAfterSec: 1 });
    expect(l.check('b', 10_000)).toEqual({ ok: true });
  });

  it('R6.8 the first client frees when its newest call leaves, not its oldest', () => {
    const l = limiter(1);
    l.record('a', 0);
    l.record('a', 4_000);
    expect(l.check('b', 5_000)).toEqual({ ok: false, retryAfterSec: 9 });
  });

  it('R6.8 recording a new client when the table is full deletes the dead clients first', () => {
    const l = limiter(1);
    l.record('a', 0);
    l.record('b', 10_000);
    expect(l.size()).toEqual({ clients: 1, timestamps: 1 });
    expect(l.check('b', 10_001)).toEqual({ ok: true });
    l.record('b', 10_001);
    expect(l.check('b', 10_002)).toEqual({ ok: false, retryAfterSec: 10 });
  });
});

describe('R7 createDailyCap (cap 2)', () => {
  const noon = Date.UTC(2026, 10, 11, 12, 0, 0, 0);
  const lastHalfSecond = Date.UTC(2026, 10, 11, 23, 59, 59, 500);
  const midnight = Date.UTC(2026, 10, 12, 0, 0, 0, 0);

  function full() {
    const cap = createDailyCap(2);
    cap.record(noon);
    cap.record(noon + 1);
    return cap;
  }

  it('R7.1 two calls pass, the third check is refused', () => {
    const cap = createDailyCap(2);
    expect(cap.check(noon)).toEqual({ ok: true });
    cap.record(noon);
    expect(cap.check(noon)).toEqual({ ok: true });
    cap.record(noon);
    expect(cap.check(noon)).toEqual({ ok: false, retryAfterSec: 43_200 });
  });

  it('R7.1 Retry-After is 1 at 23:59:59.500 UTC, 43,200 at 12:00:00 UTC', () => {
    const cap = full();
    expect(cap.check(lastHalfSecond)).toEqual({ ok: false, retryAfterSec: 1 });
    expect(cap.check(noon + 2)).toEqual({ ok: false, retryAfterSec: 43_200 });
  });

  it('R7.1 passes at 00:00:00.000 UTC', () => {
    const cap = full();
    expect(cap.check(midnight - 1)).toEqual({ ok: false, retryAfterSec: 1 });
    expect(cap.check(midnight)).toEqual({ ok: true });
  });

  it('R7.1 usedToday counts the calls of the current UTC day and is 0 after midnight', () => {
    const cap = createDailyCap(5);
    expect(cap.usedToday(noon)).toBe(0);
    cap.record(noon);
    cap.record(noon);
    expect(cap.usedToday(noon)).toBe(2);
    expect(cap.usedToday(midnight - 1)).toBe(2);
    expect(cap.usedToday(midnight)).toBe(0);
  });

  it('R7.1 the first call after midnight starts a new count at 1', () => {
    const cap = full();
    cap.record(midnight + 5);
    expect(cap.usedToday(midnight + 5)).toBe(1);
  });

  it('R7.4 a clock stepping back across midnight does not reset the count', () => {
    const cap = createDailyCap(2);
    cap.record(midnight + 1_000);
    cap.record(midnight + 2_000);
    const steppedBack = midnight - 1_000;
    expect(cap.usedToday(steppedBack)).toBe(2);
    expect(cap.check(steppedBack)).toEqual({ ok: false, retryAfterSec: 1 });
  });
});

describe('R6.5 to R6.7 clientKey', () => {
  const peer = '203.0.113.7';
  const key = (
    forwardedFor: string | undefined,
    peerAddress: string | undefined,
    trustProxy: boolean,
  ) => clientKey({ forwardedFor, peerAddress, trustProxy });

  it('R6.5 with trust off the header is ignored', () => {
    expect(key('198.51.100.9', peer, false)).toBe('203.0.113.7');
  });

  it('R6.6 with trust on the rightmost entry is the key', () => {
    expect(key('203.0.113.1, 198.51.100.9', peer, true)).toBe('198.51.100.9');
    expect(key('  198.51.100.9  ', peer, true)).toBe('198.51.100.9');
  });

  it('R6.6 repeated headers joined by a comma use the last header', () => {
    expect(key('192.0.2.1, 192.0.2.2, 198.51.100.9', peer, true)).toBe('198.51.100.9');
  });

  it('R6.6 brackets and ports are stripped', () => {
    expect(key('198.51.100.9:4711', peer, true)).toBe('198.51.100.9');
    expect(key('[2001:db8:a:b::9]:443', peer, true)).toBe('2001:db8:a:b::/64');
    expect(key('[2001:db8:a:b::9]', peer, true)).toBe('2001:db8:a:b::/64');
  });

  it('R6.6 an absent, empty or non-IP rightmost entry falls back to the peer', () => {
    expect(key(undefined, peer, true)).toBe('203.0.113.7');
    expect(key('', peer, true)).toBe('203.0.113.7');
    expect(key('198.51.100.9,', peer, true)).toBe('203.0.113.7');
    expect(key('198.51.100.9, garbage', peer, true)).toBe('203.0.113.7');
    expect(key('garbage', peer, true)).toBe('203.0.113.7');
  });

  it('R6.7 IPv4-mapped IPv6 is keyed by the IPv4 address, in either case', () => {
    expect(key(undefined, '::ffff:192.0.2.1', false)).toBe('192.0.2.1');
    expect(key(undefined, '::FFFF:192.0.2.1', false)).toBe('192.0.2.1');
  });

  it('R6.7 IPv6 is keyed by its /64 prefix, lowercase, without leading zeros', () => {
    expect(key(undefined, '2001:db8:a:b:1:2:3:4', false)).toBe('2001:db8:a:b::/64');
    expect(key(undefined, '2001:db8:a:b::9', false)).toBe('2001:db8:a:b::/64');
    expect(key(undefined, '2001:0DB8:000A:000B:0:0:0:9', false)).toBe('2001:db8:a:b::/64');
    expect(key(undefined, '2001:db8::1', false)).toBe('2001:db8:0:0::/64');
    expect(key(undefined, '::1', false)).toBe('0:0:0:0::/64');
    expect(key(undefined, '::', false)).toBe('0:0:0:0::/64');
  });

  it('R6.7 an embedded IPv4 tail expands to two hextets and a zone is dropped', () => {
    expect(key(undefined, '64:ff9b::192.0.2.33', false)).toBe('64:ff9b:0:0::/64');
    expect(key(undefined, 'fe80::1%eth0', false)).toBe('fe80:0:0:0::/64');
  });

  it('R6.7 two addresses in one /64 share a key; different /64s do not', () => {
    expect(key(undefined, '2001:db8:1:2::1', false)).toBe(
      key(undefined, '2001:db8:1:2:ffff::2', false),
    );
    expect(key(undefined, '2001:db8:1:2::1', false)).not.toBe(
      key(undefined, '2001:db8:1:3::1', false),
    );
  });

  it('R6.7 no usable address gives unknown', () => {
    expect(key(undefined, undefined, false)).toBe('unknown');
    expect(key(undefined, 'nonsense', false)).toBe('unknown');
    expect(key('garbage', undefined, true)).toBe('unknown');
    expect(key(undefined, '', false)).toBe('unknown');
  });
});
