import { describe, expect, it } from 'vitest';
import { createAlerts } from '../../../src/web/state/alerts.js';
import type { AudioContextLike } from '../../../src/web/state/alerts.js';

interface Call {
  what: string;
  args: unknown[];
}

/** A fake Web Audio context that records every call the port makes. */
function fakeAudio(): { Ctor: new () => AudioContextLike; calls: Call[]; made: () => number } {
  const calls: Call[] = [];
  let made = 0;
  class FakeContext implements AudioContextLike {
    currentTime = 10;
    destination = { name: 'destination' };
    constructor() {
      made += 1;
    }
    resume(): Promise<void> {
      calls.push({ what: 'resume', args: [] });
      return Promise.resolve();
    }
    createOscillator() {
      const osc = {
        type: '',
        frequency: { value: 0 },
        connect: (): void => {
          calls.push({ what: 'osc.connect', args: [] });
        },
        start: (t: number): void => {
          calls.push({ what: 'osc.start', args: [t, osc.frequency.value, osc.type] });
        },
        stop: (t: number): void => {
          calls.push({ what: 'osc.stop', args: [t] });
        },
      };
      return osc;
    }
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime: (v: number, t: number): void => {
            calls.push({ what: 'gain.set', args: [v, t] });
          },
          linearRampToValueAtTime: (v: number, t: number): void => {
            calls.push({ what: 'gain.ramp', args: [v, t] });
          },
        },
        connect: (): void => {
          calls.push({ what: 'gain.connect', args: [] });
        },
      };
    }
  }
  return { Ctor: FakeContext, calls, made: () => made };
}

/** Times are floating point seconds; compare to the millisecond. */
const ms = (n: unknown): unknown => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);

describe('createAlerts (CM4.3, CM4.4)', () => {
  it('CM4.4 starts not ready and creates no context until enable', () => {
    const audio = fakeAudio();
    const port = createAlerts({ AudioContext: audio.Ctor, navigator: {} });
    expect(port.ready()).toBe(false);
    expect(audio.made()).toBe(0);
  });

  it('CM4.4 enable creates one context, resumes it, and is ready; a second enable reuses it', async () => {
    const audio = fakeAudio();
    const port = createAlerts({ AudioContext: audio.Ctor, navigator: {} });
    expect(await port.enable()).toBe(true);
    expect(await port.enable()).toBe(true);
    expect(audio.made()).toBe(1);
    expect(audio.calls.filter((c) => c.what === 'resume')).toHaveLength(2);
    expect(port.ready()).toBe(true);
  });

  it('CM4.3 play sounds two 880 Hz sine beeps starting at 0 and 0.25 s, with 10 ms gain ramps, and vibrates 200-100-200', async () => {
    const audio = fakeAudio();
    const vibrations: number[][] = [];
    const port = createAlerts({
      AudioContext: audio.Ctor,
      navigator: {
        vibrate: (pattern: number[]) => {
          vibrations.push(pattern);
          return true;
        },
      },
    });
    await port.enable();
    audio.calls.length = 0;
    port.play();
    expect(audio.calls.filter((c) => c.what === 'osc.start').map((c) => c.args.map(ms))).toEqual([
      [10, 880, 'sine'],
      [10.25, 880, 'sine'],
    ]);
    expect(audio.calls.filter((c) => c.what === 'osc.stop').map((c) => c.args.map(ms))).toEqual([
      [10.15],
      [10.4],
    ]);
    // Each beep: silent at its start, up to 0.2 in 10 ms, back to silent over its last 10 ms.
    const gain = audio.calls
      .filter((c) => c.what.startsWith('gain.') && c.what !== 'gain.connect')
      .map((c) => [c.what, ...c.args.map(ms)]);
    expect(gain).toEqual([
      ['gain.set', 0, 10],
      ['gain.ramp', 0.2, 10.01],
      ['gain.set', 0.2, 10.14],
      ['gain.ramp', 0, 10.15],
      ['gain.set', 0, 10.25],
      ['gain.ramp', 0.2, 10.26],
      ['gain.set', 0.2, 10.39],
      ['gain.ramp', 0, 10.4],
    ]);
    expect(vibrations).toEqual([[200, 100, 200]]);
  });

  it('CM4.4 without AudioContext enable gives false and play is silent', async () => {
    const vibrations: number[][] = [];
    const port = createAlerts({
      navigator: {
        vibrate: (p: number[]) => {
          vibrations.push(p);
          return true;
        },
      },
    });
    expect(await port.enable()).toBe(false);
    expect(port.ready()).toBe(false);
    port.play();
    expect(vibrations).toEqual([]);
  });

  it('CM4.3 a device without vibrate still plays the sound and does not throw', async () => {
    const audio = fakeAudio();
    const port = createAlerts({ AudioContext: audio.Ctor, navigator: {} });
    await port.enable();
    audio.calls.length = 0;
    expect(() => port.play()).not.toThrow();
    expect(audio.calls.filter((c) => c.what === 'osc.start')).toHaveLength(2);
  });
});
