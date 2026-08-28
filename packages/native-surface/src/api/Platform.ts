type PlatformOS = 'ios' | 'android';

let currentOS: PlatformOS = 'ios';

interface PlatformSelectSpec<T> {
  ios?: T;
  android?: T;
  native?: T;
  default?: T;
}

function selectImpl<T>(spec: PlatformSelectSpec<T>): T | undefined {
  if (currentOS in spec) return spec[currentOS];
  if ('native' in spec) return spec.native;
  return spec.default;
}

export const Platform = {
  get OS(): PlatformOS {
    return currentOS;
  },
  /**
   * RN types this per platform and code branches on the difference: iOS gets
   * a STRING ("17.0") that callers `.split('.')`, Android an API-level
   * NUMBER. Reporting the wrong shape crashes real libraries, so follow the
   * platform being simulated.
   */
  get Version(): string | number {
    return currentOS === 'ios' ? '17.0' : 34;
  },
  get constants(): { reactNativeVersion: { major: number; minor: number; patch: number }; osVersion: string | number; isTesting: boolean; Version?: number } {
    return {
      reactNativeVersion: { major: 0, minor: 86, patch: 0 },
      osVersion: currentOS === 'ios' ? '17.0' : 34,
      isTesting: false,
      ...(currentOS === 'android' ? { Version: 34 } : {}),
    };
  },
  isTV: false,
  isTesting: false,
  isPad: false,
  isVision: false,
  // Total when the spec covers every reachable branch (ios+android, or a
  // default) — matches RN's typing so idiomatic code needs no `?? fallback`.
  select: selectImpl as {
    <T>(spec: { ios: T; android: T } & PlatformSelectSpec<T>): T;
    <T>(spec: { default: T } & PlatformSelectSpec<T>): T;
    <T>(spec: PlatformSelectSpec<T>): T | undefined;
  },
};

/** Playground knob: switches which Platform.OS branch components take. Default 'ios'. */
export function setPlatformOS(os: PlatformOS): void {
  currentOS = os;
}
