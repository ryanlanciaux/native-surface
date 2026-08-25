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
  Version: 17,
  isTV: false,
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
