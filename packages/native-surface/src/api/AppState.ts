/**
 * AppState — RN's foreground/background lifecycle module.
 *
 * A canvas surface lives inside a page, so the only lifecycle signals that
 * exist here are the page's own: `document.visibilitychange` (tab hidden /
 * shown, window minimized, phone locked) drives 'change', and window
 * focus/blur drive the 'focus' / 'blur' events. That mapping is exact for the
 * two states an app actually branches on — 'active' and 'background'.
 *
 * 'inactive' is in the type (an app comparing `currentState === 'inactive'`
 * must typecheck) but is never reported: it is iOS's app-switcher state,
 * and a browser has no observable equivalent that is distinct from hidden.
 * 'memoryWarning' accepts listeners and never fires — the page gets no memory
 * pressure callback from the platform.
 *
 * SSR / Node: every DOM touch is inside a function and guarded, so importing
 * this module (and subscribing to it) is safe with no `document`. With no
 * document the state reports 'active' and no event ever fires.
 *
 * WHY the plumbing is lazy and total: @sentry/react-native subscribes at
 * IMPORT time, before any surface is mounted and before the app decides
 * anything. A throw here takes out the whole module graph, so binding happens
 * on the first listener, unbinds with the last (one page can mount and unmount
 * many surfaces), and every host capability is feature-detected rather than
 * assumed.
 */

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export type AppStateEvent = 'change' | 'focus' | 'blur' | 'memoryWarning';

export interface AppStateSubscription {
  remove(): void;
}

/**
 * Handler as STORED: `never[]` accepts every public handler shape ('change'
 * takes a status, focus/blur take nothing), and emit() casts once to call it.
 */
type Listener = (...args: never[]) => void;

export interface AppStateModule {
  isAvailable: boolean;
  readonly currentState: AppStateStatus;
  addEventListener(type: 'change', handler: (state: AppStateStatus) => void): AppStateSubscription;
  addEventListener(type: 'focus' | 'blur' | 'memoryWarning', handler: () => void): AppStateSubscription;
  /** Pre-0.65 API: still called by libraries that support old RN versions. */
  removeEventListener(type: AppStateEvent, handler: Listener): void;
}

const listeners = new Map<AppStateEvent, Set<Listener>>();

/** True while the DOM listeners are attached (see syncBinding). */
let bound = false;
/** Last status we emitted a 'change' for; only meaningful while bound. */
let lastStatus: AppStateStatus = 'active';

function doc(): Document | null {
  const d = (globalThis as { document?: Document }).document;
  return d && typeof d.addEventListener === 'function' ? d : null;
}

function win(): Window | null {
  const w = (globalThis as { window?: Window }).window;
  return w && typeof w.addEventListener === 'function' ? w : null;
}

/**
 * The page's visibility, as an RN status. A host with no document (SSR, a
 * headless test run) is reported 'active': code gates work on 'active', and
 * reporting 'background' there would silently disable it.
 */
function readStatus(): AppStateStatus {
  const d = (globalThis as { document?: Document }).document;
  if (!d || typeof d.visibilityState !== 'string') return 'active';
  return d.visibilityState === 'hidden' ? 'background' : 'active';
}

function emit(type: AppStateEvent, ...args: unknown[]): void {
  const set = listeners.get(type);
  if (!set || set.size === 0) return;
  // Copied: a listener may remove itself (or another) while being notified.
  for (const listener of [...set]) (listener as (...a: unknown[]) => void)(...args);
}

const onVisibilityChange = (): void => {
  const next = readStatus();
  if (next === lastStatus) return;
  lastStatus = next;
  emit('change', next);
};

const onFocus = (): void => emit('focus');
const onBlur = (): void => emit('blur');

/** Bound with the first listener, released with the last. */
function syncBinding(): void {
  let want = false;
  for (const set of listeners.values()) {
    if (set.size > 0) {
      want = true;
      break;
    }
  }
  if (want === bound) return;
  const d = doc();
  const w = win();
  if (!d && !w) return; // nothing to bind to; stays unbound and retries later
  bound = want;
  if (want) {
    lastStatus = readStatus();
    d?.addEventListener('visibilitychange', onVisibilityChange);
    w?.addEventListener('focus', onFocus);
    w?.addEventListener('blur', onBlur);
  } else {
    d?.removeEventListener('visibilitychange', onVisibilityChange);
    w?.removeEventListener('focus', onFocus);
    w?.removeEventListener('blur', onBlur);
  }
}

function addEventListener(type: AppStateEvent, handler: Listener): AppStateSubscription {
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(handler);
  syncBinding();
  return {
    remove(): void {
      removeEventListener(type, handler);
    },
  };
}

function removeEventListener(type: AppStateEvent, handler: Listener): void {
  listeners.get(type)?.delete(handler);
  syncBinding();
}

export const AppState: AppStateModule = {
  /** RN reports `isAvailable: false` only on unsupported platforms. */
  isAvailable: true,

  /**
   * Read live from the page rather than cached, so it is correct even for a
   * caller that never subscribed (Sentry reads it on the way past).
   */
  get currentState(): AppStateStatus {
    return readStatus();
  },

  addEventListener,
  removeEventListener,
};
