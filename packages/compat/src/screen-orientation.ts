/**
 * expo-screen-orientation compat shim — Screen Orientation API-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — getOrientationAsync, getOrientationLockAsync,
 * getPlatformOrientationLockAsync, lockAsync, lockPlatformAsync,
 * unlockAsync, supportsOrientationLockAsync, the change-listener trio, and
 * the Orientation / OrientationLock / SizeClassIOS / WebOrientationLock /
 * WebOrientation enums.
 *
 * Reading orientation is real: screen.orientation.type maps onto Expo's
 * Orientation enum through the same table upstream uses, and change events
 * come from screen.orientation's 'change' (falling back to window's
 * 'orientationchange').
 *
 * Honest ceilings:
 * - **Locking requires fullscreen.** screen.orientation.lock() rejects with
 *   a NotAllowedError unless the document is fullscreen (and on desktop it
 *   is usually unsupported outright). lockAsync REJECTS with a message
 *   saying so rather than silently no-op'ing — an app that thinks it locked
 *   portrait and then rotates has a bug that is much harder to see than a
 *   rejected promise. Guard the call, or enter fullscreen first.
 * - **unlockAsync is the asymmetric case, on purpose.** Its postcondition —
 *   "no orientation lock is in effect" — already holds when the browser
 *   cannot lock at all, so an unsupported unlock warns once and resolves
 *   instead of rejecting. (Upstream implements unlock as lock(NATURAL),
 *   which rejects outside fullscreen; that turns lightbox-style
 *   "unlock while open, re-lock on close" flows into unhandled rejections.)
 * - **getOrientationLockAsync reports the last lock this module applied**,
 *   not a value read back from the platform — the browser exposes no such
 *   getter. It starts UNKNOWN, exactly as the real module does on web.
 * - **iOS size classes do not exist here**, so ScreenOrientationInfo carries
 *   only `orientation`; SizeClassIOS is exported for type/enum parity.
 */

export enum Orientation {
  UNKNOWN = 0,
  PORTRAIT_UP = 1,
  PORTRAIT_DOWN = 2,
  LANDSCAPE_LEFT = 3,
  LANDSCAPE_RIGHT = 4,
}

export enum OrientationLock {
  DEFAULT = 0,
  ALL = 1,
  PORTRAIT = 2,
  PORTRAIT_UP = 3,
  PORTRAIT_DOWN = 4,
  LANDSCAPE = 5,
  LANDSCAPE_LEFT = 6,
  LANDSCAPE_RIGHT = 7,
  OTHER = 8,
  UNKNOWN = 9,
}

export enum SizeClassIOS {
  UNKNOWN = 0,
  COMPACT = 1,
  REGULAR = 2,
}

export enum WebOrientationLock {
  PORTRAIT_PRIMARY = 'portrait-primary',
  PORTRAIT_SECONDARY = 'portrait-secondary',
  PORTRAIT = 'portrait',
  LANDSCAPE_PRIMARY = 'landscape-primary',
  LANDSCAPE_SECONDARY = 'landscape-secondary',
  LANDSCAPE = 'landscape',
  ANY = 'any',
  NATURAL = 'natural',
  UNKNOWN = 'unknown',
}

export enum WebOrientation {
  PORTRAIT_PRIMARY = 'portrait-primary',
  PORTRAIT_SECONDARY = 'portrait-secondary',
  LANDSCAPE_PRIMARY = 'landscape-primary',
  LANDSCAPE_SECONDARY = 'landscape-secondary',
}

export type PlatformOrientationInfo = {
  screenOrientationConstantAndroid?: number;
  screenOrientationArrayIOS?: Orientation[];
  screenOrientationLockWeb?: WebOrientationLock;
};

export type ScreenOrientationInfo = {
  orientation: Orientation;
  verticalSizeClass?: SizeClassIOS;
  horizontalSizeClass?: SizeClassIOS;
};

export type OrientationChangeEvent = {
  orientationLock: OrientationLock;
  orientationInfo: ScreenOrientationInfo;
};

export type OrientationChangeListener = (event: OrientationChangeEvent) => void;
export type ExpoOrientationEvents = { expoDidUpdateDimensions: OrientationChangeListener };
export type EventSubscription = { remove(): void };

const ORIENTATION_LOCK_TO_WEB: Partial<Record<OrientationLock, WebOrientationLock>> = {
  [OrientationLock.DEFAULT]: WebOrientationLock.NATURAL,
  [OrientationLock.ALL]: WebOrientationLock.ANY,
  [OrientationLock.PORTRAIT]: WebOrientationLock.PORTRAIT,
  [OrientationLock.PORTRAIT_UP]: WebOrientationLock.PORTRAIT_PRIMARY,
  [OrientationLock.PORTRAIT_DOWN]: WebOrientationLock.PORTRAIT_SECONDARY,
  [OrientationLock.LANDSCAPE]: WebOrientationLock.LANDSCAPE,
  [OrientationLock.LANDSCAPE_LEFT]: WebOrientationLock.LANDSCAPE_PRIMARY,
  [OrientationLock.LANDSCAPE_RIGHT]: WebOrientationLock.LANDSCAPE_SECONDARY,
};

const WEB_ORIENTATION_TO_API: Record<string, Orientation> = {
  [WebOrientation.PORTRAIT_PRIMARY]: Orientation.PORTRAIT_UP,
  [WebOrientation.PORTRAIT_SECONDARY]: Orientation.PORTRAIT_DOWN,
  [WebOrientation.LANDSCAPE_PRIMARY]: Orientation.LANDSCAPE_LEFT,
  [WebOrientation.LANDSCAPE_SECONDARY]: Orientation.LANDSCAPE_RIGHT,
};

interface ScreenOrientationLike {
  type?: string;
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

function screenOrientation(): ScreenOrientationLike | null {
  if (typeof screen === 'undefined') return null;
  const orientation = (screen as Screen & { orientation?: ScreenOrientationLike; msOrientation?: ScreenOrientationLike })
    .orientation;
  return orientation ?? null;
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

let lastOrientationLock: OrientationLock = OrientationLock.UNKNOWN;
let lastWebOrientationLock: WebOrientationLock = WebOrientationLock.UNKNOWN;

export async function getOrientationAsync(): Promise<Orientation> {
  const type = screenOrientation()?.type;
  if (!type) return Orientation.UNKNOWN;
  return WEB_ORIENTATION_TO_API[type] ?? Orientation.UNKNOWN;
}

/** The last lock THIS module applied — the browser exposes no lock getter. */
export async function getOrientationLockAsync(): Promise<OrientationLock> {
  return lastOrientationLock;
}

export async function getPlatformOrientationLockAsync(): Promise<PlatformOrientationInfo> {
  // The backend is the web one whatever Platform.OS claims, so the web field
  // is the field that can hold a true value here.
  return { screenOrientationLockWeb: lastWebOrientationLock };
}

async function applyWebLock(webOrientationLock: WebOrientationLock): Promise<void> {
  if (webOrientationLock === WebOrientationLock.UNKNOWN) {
    throw new Error(
      'compat screen-orientation: WebOrientationLock.UNKNOWN is not a valid lock that can be applied to the device.'
    );
  }
  const orientation = screenOrientation();
  if (!orientation || typeof orientation.lock !== 'function') {
    throw new Error(
      "compat screen-orientation: this browser doesn't support locking screen orientation (screen.orientation.lock is unavailable)."
    );
  }
  try {
    await orientation.lock(webOrientationLock);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `compat screen-orientation: locking to "${webOrientationLock}" was refused (${reason}). Browsers only allow screen.orientation.lock() while the document is fullscreen, and most desktop browsers refuse it outright.`
    );
  }
}

export async function lockAsync(orientationLock: OrientationLock): Promise<void> {
  if (!Object.values(OrientationLock).includes(orientationLock)) {
    throw new TypeError(`Invalid Orientation Lock: ${orientationLock}`);
  }
  // OTHER means "a platform-specific lock is in effect"; it is not applicable.
  if (orientationLock === OrientationLock.OTHER) return;
  const webOrientationLock = ORIENTATION_LOCK_TO_WEB[orientationLock];
  if (!webOrientationLock) throw new TypeError(`Invalid Orientation Lock: ${orientationLock}`);
  await applyWebLock(webOrientationLock);
  lastOrientationLock = orientationLock;
  lastWebOrientationLock = webOrientationLock;
}

export async function lockPlatformAsync(options: PlatformOrientationInfo): Promise<void> {
  const { screenOrientationLockWeb } = options;
  if (!screenOrientationLockWeb) {
    throw new TypeError(
      'compat screen-orientation: lockPlatformAsync needs screenOrientationLockWeb — the Android constant and the iOS orientation array have no browser meaning.'
    );
  }
  if (!Object.values(WebOrientationLock).includes(screenOrientationLockWeb)) {
    throw new TypeError(`Invalid Web Orientation Lock: ${screenOrientationLockWeb}`);
  }
  await applyWebLock(screenOrientationLockWeb);
  lastOrientationLock = OrientationLock.OTHER;
  lastWebOrientationLock = screenOrientationLockWeb;
}

export async function unlockAsync(): Promise<void> {
  const orientation = screenOrientation();
  if (orientation && typeof orientation.unlock === 'function') {
    orientation.unlock();
  } else {
    warnOnce(
      'unlock-unsupported',
      "compat screen-orientation: this browser doesn't support screen.orientation.unlock(); nothing was locked, so unlockAsync resolves."
    );
  }
  lastOrientationLock = OrientationLock.DEFAULT;
  lastWebOrientationLock = WebOrientationLock.NATURAL;
}

/**
 * Reports whether this lock could actually be applied here: it must have a
 * web equivalent AND the browser must expose screen.orientation.lock. (The
 * fullscreen requirement is still enforced at call time — it depends on the
 * document's state, not on the lock.)
 */
export async function supportsOrientationLockAsync(orientationLock: OrientationLock): Promise<boolean> {
  if (!Object.values(OrientationLock).includes(orientationLock)) {
    throw new TypeError(`Invalid Orientation Lock: ${orientationLock}`);
  }
  const orientation = screenOrientation();
  return ORIENTATION_LOCK_TO_WEB[orientationLock] !== undefined && typeof orientation?.lock === 'function';
}

// ---------------------------------------------------------------------------
// Change events
// ---------------------------------------------------------------------------

const subscribers = new Set<{ listener: OrientationChangeListener; unbind: () => void }>();

export function addOrientationChangeListener(listener: OrientationChangeListener): EventSubscription {
  if (typeof listener !== 'function') {
    throw new TypeError(`addOrientationChangeListener cannot be called with ${String(listener)}`);
  }

  const handler = (): void => {
    void Promise.all([getOrientationLockAsync(), getOrientationAsync()]).then(([orientationLock, orientation]) => {
      listener({ orientationLock, orientationInfo: { orientation } });
    });
  };

  const orientation = screenOrientation();
  let unbind = (): void => {};
  if (orientation?.addEventListener) {
    orientation.addEventListener('change', handler);
    unbind = () => orientation.removeEventListener?.('change', handler);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('orientationchange', handler);
    unbind = () => window.removeEventListener('orientationchange', handler);
  }

  const entry = { listener, unbind };
  subscribers.add(entry);
  return {
    remove: () => {
      if (!subscribers.delete(entry)) return;
      entry.unbind();
    },
  };
}

export function removeOrientationChangeListeners(): void {
  for (const entry of [...subscribers]) {
    subscribers.delete(entry);
    entry.unbind();
  }
}

export function removeOrientationChangeListener(subscription: EventSubscription): void {
  if (!subscription || typeof subscription.remove !== 'function') {
    throw new TypeError(`removeOrientationChangeListener cannot be called with ${String(subscription)}`);
  }
  subscription.remove();
}

/**
 * `import * as ScreenOrientation from 'expo-screen-orientation'` is the
 * documented form and is served by the named exports above; the namespace
 * default is here so a default import of the same module also works under
 * ESM/CJS interop.
 */
const ScreenOrientation = {
  Orientation,
  OrientationLock,
  SizeClassIOS,
  WebOrientationLock,
  WebOrientation,
  getOrientationAsync,
  getOrientationLockAsync,
  getPlatformOrientationLockAsync,
  lockAsync,
  lockPlatformAsync,
  unlockAsync,
  supportsOrientationLockAsync,
  addOrientationChangeListener,
  removeOrientationChangeListener,
  removeOrientationChangeListeners,
};

export default ScreenOrientation;
