/**
 * expo-keep-awake compat shim — Screen Wake Lock API-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — isAvailableAsync, activateKeepAwakeAsync, the deprecated
 * activateKeepAwake, deactivateKeepAwake, addListener, useKeepAwake, the
 * ExpoKeepAwakeTag constant and the KeepAwakeEventState enum.
 *
 * Locks are keyed by tag, like the real module: each tag holds one
 * WakeLockSentinel, and the screen stays awake while any tag is held. This
 * shim additionally REFERENCE-COUNTS a tag (upstream overwrites the sentinel
 * on a second activate of the same tag and leaks the first), so paired
 * activate/deactivate calls balance and the lock is released exactly when the
 * last holder lets go.
 *
 * A screen wake lock is released by the browser whenever the tab is hidden —
 * that is specified behavior, not an error — so the shim listens for
 * `visibilitychange` and re-acquires every still-held tag when the page
 * becomes visible again. Without that, backgrounding the tab once would
 * silently end the keep-awake for the rest of the session.
 *
 * Honest ceilings:
 * - **No wake lock in Firefox (and older Safari), and none over http.** The
 *   API requires a secure context and a visible document; isAvailableAsync
 *   reports that truthfully instead of the `true` the real module returns on
 *   native.
 * - **The request can be refused** — a hidden tab, a battery-saver mode, or
 *   an OS policy rejects it. activateKeepAwakeAsync propagates that rejection
 *   rather than pretending the screen is held; useKeepAwake swallows it, as
 *   upstream's hook does.
 * - **Release events are the browser's.** addListener reports RELEASE for the
 *   tag's sentinel, which fires on tab-hide as well as on an explicit
 *   release; there is no separate "OS took it away" signal.
 */
import * as React from 'react';

export type KeepAwakeEvent = { state: KeepAwakeEventState };

export enum KeepAwakeEventState {
  RELEASE = 'release',
}

export type KeepAwakeListener = (event: KeepAwakeEvent) => void;

export type KeepAwakeOptions = {
  suppressDeactivateWarnings?: boolean;
  listener?: KeepAwakeListener;
};

export type EventSubscription = { remove(): void };

/** Default tag, used when no tag has been specified in keep awake calls. */
export const ExpoKeepAwakeTag = 'ExpoKeepAwakeDefaultTag';

interface WakeLockSentinelLike {
  released: boolean;
  type: string;
  release(): Promise<void>;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

interface TagState {
  /** How many activate calls are outstanding for this tag. */
  count: number;
  /** null while the browser has taken the lock back (hidden tab). */
  sentinel: WakeLockSentinelLike | null;
  listeners: Set<KeepAwakeListener>;
}

const tags = new Map<string, TagState>();
let visibilityBound = false;

class KeepAwakeCodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

function wakeLock(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const lock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return lock && typeof lock.request === 'function' ? lock : null;
}

export async function isAvailableAsync(): Promise<boolean> {
  return wakeLock() !== null;
}

function notifyRelease(state: TagState): void {
  for (const listener of [...state.listeners]) listener({ state: KeepAwakeEventState.RELEASE });
}

async function acquire(tag: string, state: TagState): Promise<void> {
  const lock = wakeLock();
  if (!lock) return;
  const sentinel = await lock.request('screen');
  // A deactivate that landed while the request was in flight wins: release
  // immediately rather than leaving an orphaned lock behind.
  if (!tags.has(tag) || state.count === 0) {
    void sentinel.release().catch(() => {});
    return;
  }
  state.sentinel = sentinel;
  const onRelease = (): void => {
    if (state.sentinel === sentinel) state.sentinel = null;
    notifyRelease(state);
  };
  sentinel.addEventListener?.('release', onRelease);
}

function ensureVisibilityBinding(): void {
  if (visibilityBound || typeof document === 'undefined' || !document.addEventListener) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // The browser dropped every lock while we were hidden; take back the ones
    // callers still hold.
    for (const [tag, state] of tags) {
      if (state.count > 0 && (state.sentinel === null || state.sentinel.released)) {
        void acquire(tag, state).catch(() => {});
      }
    }
  });
}

export async function activateKeepAwakeAsync(tag: string = ExpoKeepAwakeTag): Promise<void> {
  let state = tags.get(tag);
  if (!state) {
    state = { count: 0, sentinel: null, listeners: new Set() };
    tags.set(tag, state);
  }
  state.count += 1;
  ensureVisibilityBinding();
  if (state.sentinel && !state.sentinel.released) return;
  await acquire(tag, state);
}

/** @deprecated use `activateKeepAwakeAsync` instead. */
export function activateKeepAwake(tag: string = ExpoKeepAwakeTag): Promise<void> {
  console.warn('`activateKeepAwake` is deprecated. Use `activateKeepAwakeAsync` instead.');
  return activateKeepAwakeAsync(tag);
}

export async function deactivateKeepAwake(tag: string = ExpoKeepAwakeTag): Promise<void> {
  const state = tags.get(tag);
  if (!state || state.count === 0) {
    // With no wake-lock backend nothing was ever activated, and a hook's
    // unmount must not turn that into an unhandled rejection.
    if (!wakeLock()) return;
    throw new KeepAwakeCodedError(
      'ERR_KEEP_AWAKE_TAG_INVALID',
      `The wake lock with tag ${tag} has not activated yet`
    );
  }
  state.count -= 1;
  if (state.count > 0) return;
  tags.delete(tag);
  const sentinel = state.sentinel;
  state.sentinel = null;
  if (sentinel && !sentinel.released) await sentinel.release();
}

/**
 * Observe releases of a tag's lock. On the web this fires when the browser
 * takes the lock back (tab hidden) as well as on an explicit release.
 */
export function addListener(
  tagOrListener: string | KeepAwakeListener,
  listener?: KeepAwakeListener
): EventSubscription {
  const tag = typeof tagOrListener === 'string' ? tagOrListener : ExpoKeepAwakeTag;
  const callback = typeof tagOrListener === 'function' ? tagOrListener : listener;
  if (!callback) return { remove: () => {} };
  let state = tags.get(tag);
  if (!state) {
    state = { count: 0, sentinel: null, listeners: new Set() };
    tags.set(tag, state);
  }
  state.listeners.add(callback);
  return {
    remove: () => {
      state.listeners.delete(callback);
      // A tag that only ever held listeners should not linger in the map.
      if (state.count === 0 && state.listeners.size === 0) tags.delete(tag);
    },
  };
}

/**
 * Keeps the screen awake for as long as the owner component is mounted.
 * Failures are swallowed (the hook is advisory, and the request can be
 * refused), matching the real hook's contract.
 */
export function useKeepAwake(tag?: string, options?: KeepAwakeOptions): void {
  const defaultTag = React.useId();
  const tagOrDefault = tag ?? defaultTag;
  const listener = options?.listener;

  React.useEffect(() => {
    let mounted = true;
    let subscription: EventSubscription | null = null;
    activateKeepAwakeAsync(tagOrDefault)
      .then(() => {
        if (mounted && listener) subscription = addListener(tagOrDefault, listener);
      })
      .catch(() => {});
    return () => {
      mounted = false;
      subscription?.remove();
      deactivateKeepAwake(tagOrDefault).catch(() => {});
    };
  }, [tagOrDefault, listener]);
}

/** Test seam: drops every tag and its listeners. */
export function __resetKeepAwake(): void {
  tags.clear();
}

/**
 * `import * as KeepAwake from 'expo-keep-awake'` is the documented form and
 * is served by the named exports above; the namespace default is here so a
 * default import of the same module also works under ESM/CJS interop.
 */
const KeepAwake = {
  ExpoKeepAwakeTag,
  KeepAwakeEventState,
  isAvailableAsync,
  activateKeepAwake,
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  addListener,
  useKeepAwake,
};

export default KeepAwake;
