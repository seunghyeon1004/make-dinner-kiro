import { describe, expect, it } from 'vitest';
import { createWakeLock } from '../../../src/web/state/wake-lock.js';
import type { SentinelLike } from '../../../src/web/state/wake-lock.js';

/** A fake sentinel: records releases and lets the test fire the browser's `release` event. */
function fakeSentinel(): SentinelLike & { releases: number; fire(): void } {
  const listeners: (() => void)[] = [];
  return {
    releases: 0,
    release() {
      this.releases += 1;
      return Promise.resolve();
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    fire() {
      for (const listener of listeners) listener();
    },
  };
}

describe('createWakeLock (CM6.1, CM6.2)', () => {
  it('CM6.1 acquire requests a screen lock once and reports held; a second acquire makes no request', async () => {
    const sentinel = fakeSentinel();
    const requests: string[] = [];
    const port = createWakeLock({
      wakeLock: {
        request: (type) => {
          requests.push(type);
          return Promise.resolve(sentinel);
        },
      },
    });
    expect(port.status()).toBe('idle');
    expect(await port.acquire()).toBe('held');
    expect(await port.acquire()).toBe('held');
    expect(requests).toEqual(['screen']);
    expect(port.status()).toBe('held');
  });

  it('CM6.2 without navigator.wakeLock the status is unsupported', async () => {
    const port = createWakeLock({});
    expect(await port.acquire()).toBe('unsupported');
    expect(port.status()).toBe('unsupported');
  });

  it('CM6.2 a refused request is refused, not an error', async () => {
    const port = createWakeLock({ wakeLock: { request: () => Promise.reject(new Error('no')) } });
    expect(await port.acquire()).toBe('refused');
    expect(port.status()).toBe('refused');
  });

  it("CM6.1 the browser's release event makes the status idle, so the next acquire asks again", async () => {
    const first = fakeSentinel();
    const second = fakeSentinel();
    const queue = [first, second];
    let requests = 0;
    const port = createWakeLock({
      wakeLock: {
        request: () => {
          requests += 1;
          return Promise.resolve(queue.shift() ?? second);
        },
      },
    });
    await port.acquire();
    first.fire();
    expect(port.status()).toBe('idle');
    expect(await port.acquire()).toBe('held');
    expect(requests).toBe(2);
  });

  it('CM6.1 release calls the sentinel once and leaves the status idle; a second release does nothing', async () => {
    const sentinel = fakeSentinel();
    const port = createWakeLock({ wakeLock: { request: () => Promise.resolve(sentinel) } });
    await port.acquire();
    await port.release();
    await port.release();
    expect(sentinel.releases).toBe(1);
    expect(port.status()).toBe('idle');
  });
});
