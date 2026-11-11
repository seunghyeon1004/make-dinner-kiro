/** The screen wake lock behind a small port, so it can be faked (design, "Ports and effects"). */
export type WakeLockStatus = 'idle' | 'held' | 'unsupported' | 'refused';
export interface SentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
export interface WakeLockPort {
  acquire(): Promise<WakeLockStatus>;
  release(): Promise<void>;
  status(): WakeLockStatus;
}

export function createWakeLock(nav: {
  wakeLock?: { request(type: 'screen'): Promise<SentinelLike> };
}): WakeLockPort {
  let status: WakeLockStatus = 'idle';
  let sentinel: SentinelLike | null = null;
  return {
    async acquire() {
      if (status === 'held') return status;
      if (nav.wakeLock === undefined) {
        status = 'unsupported';
        return status;
      }
      try {
        const granted = await nav.wakeLock.request('screen');
        sentinel = granted;
        status = 'held';
        granted.addEventListener('release', () => {
          if (sentinel === granted) {
            sentinel = null;
            status = 'idle';
          }
        });
      } catch {
        status = 'refused';
      }
      return status;
    },
    async release() {
      const held = sentinel;
      sentinel = null;
      if (status === 'held') status = 'idle';
      if (held !== null) await held.release();
    },
    status: () => status,
  };
}
