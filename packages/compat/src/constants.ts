/**
 * expo-constants compat shim.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * default Constants object plus the ExecutionEnvironment/AppOwnership enums.
 * Values are honest for a canvas host rather than flattering: no expo config
 * or manifest is present (expoConfig/manifest/manifest2 are null — apps that
 * read expoConfig.extra must tolerate its documented nullability),
 * executionEnvironment is 'bare', isDevice is false, and statusBarHeight is 0
 * because the surface draws no OS status bar. sessionId is a fresh uuid per
 * JS realm, matching upstream's per-session contract (it is NOT persisted).
 * platform carries the web leg only, with the real user agent.
 */

export const ExecutionEnvironment = {
  Bare: 'bare',
  Standalone: 'standalone',
  StoreClient: 'storeClient',
} as const;
export type ExecutionEnvironment = (typeof ExecutionEnvironment)[keyof typeof ExecutionEnvironment];

export const AppOwnership = {
  Standalone: 'standalone',
  Guest: 'guest',
  Expo: 'expo',
} as const;
export type AppOwnership = (typeof AppOwnership)[keyof typeof AppOwnership];

function makeUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* insecure context */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;

const Constants = {
  expoConfig: null as Record<string, unknown> | null,
  manifest: null as Record<string, unknown> | null,
  manifest2: null as Record<string, unknown> | null,
  executionEnvironment: ExecutionEnvironment.Bare as ExecutionEnvironment,
  appOwnership: null as AppOwnership | null,
  statusBarHeight: 0,
  systemFonts: [] as string[],
  sessionId: makeUuid(),
  deviceName: 'native-surface',
  isDevice: false,
  platform: { web: { ua: userAgent } },
  expoVersion: null as string | null,
  linkingUri: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
  getWebViewUserAgentAsync: async (): Promise<string | null> => userAgent ?? null,
};

export default Constants;
export { Constants };
