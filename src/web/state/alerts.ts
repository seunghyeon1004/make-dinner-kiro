export interface OscillatorLike {
  type: string;
  frequency: { value: number };
  connect(node: unknown): void;
  start(when: number): void;
  stop(when: number): void;
}
export interface GainLike {
  gain: {
    value: number;
    setValueAtTime(value: number, when: number): void;
    linearRampToValueAtTime(value: number, when: number): void;
  };
  connect(node: unknown): void;
}
export interface AudioContextLike {
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
}
export interface AlertPort {
  enable(): Promise<boolean>;
  ready(): boolean;
  play(): void;
}
const BEEP_HZ = 880;
const BEEP_S = 0.15;
const BEEP_STEP_S = 0.25;
const RAMP_S = 0.01;
const BEEP_GAIN = 0.2;
const VIBRATE_PATTERN = [200, 100, 200];

/** The chime and the buzz of a timer ending. `enable` must run inside a tap (CM4.4). */
export function createAlerts(win: {
  AudioContext?: new () => AudioContextLike;
  navigator: { vibrate?: (pattern: number[]) => boolean };
}): AlertPort {
  let context: AudioContextLike | null = null;
  return {
    async enable() {
      if (win.AudioContext === undefined) return false;
      context ??= new win.AudioContext();
      try {
        await context.resume();
      } catch {
        return false;
      }
      return true;
    },
    ready: () => context !== null,
    play() {
      if (context === null) return;
      const ctx = context;
      for (const offset of [0, BEEP_STEP_S]) {
        const start = ctx.currentTime + offset;
        const end = start + BEEP_S;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = BEEP_HZ;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(BEEP_GAIN, start + RAMP_S);
        gain.gain.setValueAtTime(BEEP_GAIN, end - RAMP_S);
        gain.gain.linearRampToValueAtTime(0, end);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end);
      }
      win.navigator.vibrate?.(VIBRATE_PATTERN);
    },
  };
}
