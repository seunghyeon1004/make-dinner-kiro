import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clientKey, createDailyCap, createRateLimiter } from '../../../src/server/parse/limits.js';
import {
  arbCapRun,
  arbForwardedFor,
  arbIpAddress,
  arbLimiterRun,
} from '../../support/arbitraries.js';
import { fcParams } from '../../support/fc-params.js';
import { oracleMaxInWindow, oracleUtcDay } from '../../support/oracles.js';

describe('P-RR1 rate window', () => {
  it('P-RR1 rate window: at most `limit` calls in any window, refusals exact, Retry-After exact, memory bounded', () => {
    fc.assert(
      fc.property(arbLimiterRun(), (run) => {
        const windowMs = run.windowSec * 1000;
        const limiter = createRateLimiter({
          limit: run.limit,
          windowSec: run.windowSec,
          maxClients: run.maxClients,
        });
        const recorded = new Map<string, number[]>();
        let t = run.startMs;
        for (const event of run.events) {
          t += event.dtMs;
          const mine = recorded.get(event.client) ?? [];
          const live = mine.filter((s) => t - s < windowMs).length;
          let othersLive = 0;
          for (const [client, times] of recorded) {
            if (client !== event.client && times.some((s) => t - s < windowMs)) othersLive += 1;
          }
          const expectRefused = live >= run.limit || (live === 0 && othersLive >= run.maxClients);

          const result = limiter.check(event.client, t);
          expect(result.ok).toBe(!expectRefused);
          if (!result.ok) {
            const r = result.retryAfterSec;
            expect(Number.isInteger(r) && r >= 1).toBe(true);
            expect(limiter.check(event.client, t + r * 1000)).toEqual({ ok: true });
            if (r > 1) expect(limiter.check(event.client, t + (r - 1) * 1000).ok).toBe(false);
          } else {
            limiter.record(event.client, t);
            mine.push(t);
            recorded.set(event.client, mine);
          }
          const size = limiter.size();
          expect(size.clients).toBeLessThanOrEqual(run.maxClients);
          expect(size.timestamps).toBeLessThanOrEqual(size.clients * run.limit);
        }
        for (const times of recorded.values()) {
          expect(oracleMaxInWindow(times, windowMs)).toBeLessThanOrEqual(run.limit);
        }
      }),
      fcParams(),
    );
  });
});

describe('P-RR2 daily cap', () => {
  it('P-RR2 daily cap: at most `cap` calls per UTC day, refused exactly when the day is full, Retry-After reaches the next day', () => {
    fc.assert(
      fc.property(arbCapRun(), (run) => {
        const cap = createDailyCap(run.cap);
        const recorded: number[] = [];
        let t = run.startMs;
        for (const event of run.events) {
          t += event.dtMs;
          const today = oracleUtcDay(t);
          const used = recorded.filter((s) => oracleUtcDay(s) === today).length;
          const result = cap.check(t);
          expect(result.ok).toBe(used < run.cap);
          expect(cap.usedToday(t)).toBe(used);
          if (!result.ok) {
            const r = result.retryAfterSec;
            expect(Number.isInteger(r) && r >= 1).toBe(true);
            expect(oracleUtcDay(t + r * 1000) > today).toBe(true);
            if (r > 1) expect(oracleUtcDay(t + (r - 1) * 1000)).toBe(today);
          } else {
            cap.record(t);
            recorded.push(t);
          }
        }
        const days = new Set(recorded.map(oracleUtcDay));
        for (const day of days) {
          expect(recorded.filter((s) => oracleUtcDay(s) === day).length).toBeLessThanOrEqual(
            run.cap,
          );
        }
      }),
      fcParams(),
    );
  });
});

describe('P-RR4 client key', () => {
  const SHAPE = /^(unknown|\d{1,3}(\.\d{1,3}){3}|([0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4}::\/64)$/;

  it('P-RR4 client key: never throws, always one of three shapes, ignores the header when trust is off', () => {
    fc.assert(
      fc.property(arbForwardedFor(), ({ header, peer }) => {
        const off = clientKey({ forwardedFor: header, peerAddress: peer, trustProxy: false });
        const on = clientKey({ forwardedFor: header, peerAddress: peer, trustProxy: true });
        expect(off).toMatch(SHAPE);
        expect(on).toMatch(SHAPE);
        expect(off).toBe(
          clientKey({ forwardedFor: undefined, peerAddress: peer, trustProxy: false }),
        );
      }),
      fcParams(),
    );
  });

  it('P-RR4 client key: with trust on, nothing before the last comma changes the key', () => {
    fc.assert(
      fc.property(arbForwardedFor(), fc.string({ maxLength: 20 }), ({ header, peer }, prefix) => {
        if (header === undefined || !header.includes(',')) return;
        const tail = header.slice(header.lastIndexOf(',') + 1);
        const replaced = `${prefix.replaceAll(',', ';')},${tail}`;
        expect(clientKey({ forwardedFor: replaced, peerAddress: peer, trustProxy: true })).toBe(
          clientKey({ forwardedFor: header, peerAddress: peer, trustProxy: true }),
        );
      }),
      fcParams(),
    );
  });

  it('P-RR4 client key: a valid rightmost entry gives the same key as that address as the peer', () => {
    fc.assert(
      fc.property(
        arbIpAddress(),
        arbIpAddress(),
        fc.array(arbIpAddress(), { maxLength: 3 }),
        (rightmost, peer, others) => {
          const header = [...others, rightmost].join(', ');
          expect(clientKey({ forwardedFor: header, peerAddress: peer, trustProxy: true })).toBe(
            clientKey({ forwardedFor: undefined, peerAddress: rightmost, trustProxy: false }),
          );
        },
      ),
      fcParams(),
    );
  });
});
