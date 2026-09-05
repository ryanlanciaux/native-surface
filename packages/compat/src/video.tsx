/**
 * Video compat: a real `<video>` element driven through the engine's DOM-portal
 * seam (engine/portalHost).
 *
 * The canvas cannot decode video, but the page hosting it already can. A video
 * view renders a host View carrying `__portal {tag:'video'}`; the engine creates
 * the element, positions it over the canvas at that view's absolute frame, and
 * tracks it through every flush and scroll. `__portalRef` hands this module the
 * live element, and everything below is ordinary media-element work.
 *
 * Three layers, smallest first:
 *   1. `createPortalVideoView()` — the general primitive. RN-ish props onto a
 *      media element, imperative play/pause/seek through a forwarded ref,
 *      element events back out as RN-style callbacks.
 *   2. The `expo-video` (SDK 57) surface — `useVideoPlayer` / `VideoView` /
 *      `VideoPlayer` built on (1), plus `getThumbnailAsync` for
 *      `expo-video-thumbnails` (re-exported by the sibling
 *      `video-thumbnails.ts`, which is what that package aliases to).
 *   3. Registry factories — `createNativeVideoView`, `createLoopingVideoView`,
 *      `createVideoModule` — for the app-LOCAL native players Expo apps reach
 *      by string name. Exported, never auto-registered: the names belong to the
 *      app, so a host wires them up in one line via `registerNativeView`.
 *
 * The ceilings, all of them real:
 *
 *  - STACKING. A portal element composites ABOVE all canvas content, always.
 *    Canvas pixels can never paint over the video rectangle, so overlay
 *    controls, badges, a feed's sticky header, or a modal that visually covers
 *    a playing video will be HIDDEN BEHIND it. Taps still land (see below), but
 *    they land on something the user cannot see. Fixing this properly means
 *    compositing decoded frames into the Skia surface, which is an engine
 *    change, not a shim change.
 *  - POINTER EVENTS. Because of that, a video with no native controls is given
 *    `pointer-events: none`, so taps fall through to the canvas and the engine
 *    hit-tests the overlay controls underneath. `controls` re-enables them (the
 *    browser's own control bar has to be clickable).
 *  - CLIPPING. The seam tracks the node's frame but does not model
 *    scroll-ancestor clipping, so a video scrolled out of its ScrollView keeps
 *    following its (off-screen) frame rather than being clipped by it.
 *  - HLS. `.m3u8` plays from `<video src>` in Safari only. Everywhere else it
 *    needs Media Source Extensions and a JS player. This package deliberately
 *    ships none (an hls.js-class player is large and its configuration is
 *    app-specific): unsupported HLS reports a named error through `onError` and
 *    warns once, and a host that wants playback supplies a player through
 *    `setHlsLoader()` or the `hlsLoader` prop/option.
 *  - NO HEADLESS PLAYER. The browser has one media element per view, so an
 *    `expo-video` `VideoPlayer` only loads media while a `VideoView` is mounted
 *    for it: before that, `status` is `'idle'` and `duration` is 0. Native
 *    expo-video preloads without a view; this cannot.
 *  - AUTOPLAY POLICY. `play()` rejects with `NotAllowedError` unless the video
 *    is muted or the page has user activation. That rejection is swallowed
 *    (the video simply stays paused) and warned once — it is browser policy,
 *    not a failure to report to the app.
 *
 * Node-import-safe: no top-level DOM access, and every entry point degrades
 * when `document` is undefined.
 */
import * as React from 'react';
import { View } from 'native-surface';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'native-surface';
import { EventEmitter, useReleasingSharedObject } from './expo-modules-core';
import type { EventSubscription } from './expo-modules-core';

const HostView = View as unknown as React.FC<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

const warned = new Set<string>();

function warnOnce(topic: string, message: string): void {
  if (warned.has(topic)) return;
  warned.add(topic);
  console.warn(`native-surface video: ${message}`);
}

// ---------------------------------------------------------------------------
// Module state
//
// Keyed on globalThis for the same reason expo-modules-core's name registry is:
// a bundler inlines a compat module into every prebundled dependency that
// imports it, so there is reliably more than one copy. Single-active
// arbitration is worthless if two copies each think they own "the active
// video", and a host calling setHlsLoader() must be heard by the copy the app
// actually renders through.
// ---------------------------------------------------------------------------

interface VideoRegistryState {
  handles: Set<PortalVideoRegistration>;
  active: PortalVideoRegistration | null;
  hlsLoader: HlsLoader | null;
  arbitration: boolean;
  nextId: number;
}

const globalScope = globalThis as unknown as { __nativeSurfaceVideo?: VideoRegistryState };
const registry: VideoRegistryState = (globalScope.__nativeSurfaceVideo ??= {
  handles: new Set(),
  active: null,
  hlsLoader: null,
  arbitration: true,
  nextId: 1,
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Any object naming a playable uri; extra fields (headers, metadata, …) ride along. */
export interface VideoUriSource {
  uri?: string | null;
}

/** Every source spelling the RN ecosystem uses for a video. The open-ended
 *  member keeps inline literals with extra keys from tripping excess-property
 *  checking, while the closed one accepts expo-video's VideoSource. */
export type VideoSourceLike =
  | string
  | number
  | VideoUriSource
  | { uri?: string | null; [key: string]: unknown }
  | null
  | undefined;

/** The playable URL of a source, or null when there is nothing to play. */
export function resolveVideoUri(source: VideoSourceLike): string | null {
  if (source === null || source === undefined) return null;
  if (typeof source === 'string') return source === '' ? null : source;
  if (typeof source === 'number') {
    // The Vite preset rewrites require()'d assets to {uri, scale}; a bare
    // number means the transform did not run over this file.
    warnOnce('numeric-source', 'a numeric asset id is not resolvable here — pass {uri} or a string URL.');
    return null;
  }
  const uri = (source as VideoUriSource).uri;
  return typeof uri === 'string' && uri !== '' ? uri : null;
}

// ---------------------------------------------------------------------------
// contentFit / resizeMode → CSS object-fit
// ---------------------------------------------------------------------------

export type VideoObjectFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

/** expo-video/expo-image spellings plus RN's legacy resizeMode names. */
const OBJECT_FIT: Record<string, VideoObjectFit> = {
  contain: 'contain',
  cover: 'cover',
  fill: 'fill',
  none: 'none',
  'scale-down': 'scale-down',
  // RN's `stretch` distorts to fill the box; CSS spells that `fill`.
  stretch: 'fill',
  // RN's `center` draws at intrinsic size, centered; CSS spells that `none`.
  center: 'none',
};

export function toObjectFit(value: string | null | undefined, fallback: VideoObjectFit = 'contain'): VideoObjectFit {
  if (!value) return fallback;
  const fit = OBJECT_FIT[value];
  if (fit) return fit;
  warnOnce(`fit:${value}`, `unknown contentFit/resizeMode '${value}' — using '${fallback}'.`);
  return fallback;
}

// ---------------------------------------------------------------------------
// HLS
// ---------------------------------------------------------------------------

const HLS_MIME_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegURL'] as const;

export function isHlsSource(uri: string): boolean {
  return /\.m3u8(\?|#|$)/i.test(uri);
}

/** True only where the media element itself demuxes HLS — in practice Safari. */
export function canPlayHlsNatively(video: HTMLVideoElement): boolean {
  return HLS_MIME_TYPES.some((type) => Boolean(video.canPlayType(type)));
}

/** Everything an HLS player needs to take over a portal's element. */
export interface HlsAttachContext {
  video: HTMLVideoElement;
  uri: string;
  /** Whether the view wants playback to start once the manifest is parsed. */
  autoPlay: boolean;
  /** Report a fatal player error the same way a media error is reported. */
  reportError: (message: string) => void;
}

/** Teardown returned by a loader; called when the source changes or unmounts. */
export type HlsDetach = () => void;

/**
 * Host-supplied bridge to a Media-Source HLS player (hls.js and friends).
 * Deliberately a hook rather than a bundled dependency: the player is large,
 * its configuration is app-specific, and hosts that only serve MP4 should not
 * pay for it.
 */
export type HlsLoader = (context: HlsAttachContext) => HlsDetach | void | Promise<HlsDetach | void>;

/** Install (or clear) the loader every portal video falls back to. */
export function setHlsLoader(loader: HlsLoader | null): void {
  registry.hlsLoader = loader;
}

export function getHlsLoader(): HlsLoader | null {
  return registry.hlsLoader;
}

function hlsUnsupportedMessage(uri: string): string {
  return (
    `this browser cannot play HLS (${uri}) from a <video> src — only Safari demuxes .m3u8 natively. ` +
    `Supply a Media-Source player with setHlsLoader() (or the hlsLoader prop) from ` +
    `'@native-surface/compat/video'; an hls.js-style player is the usual choice. ` +
    `This package intentionally does not bundle one.`
  );
}

// ---------------------------------------------------------------------------
// Single-active arbitration
//
// One media element playing at a time is what a feed of videos expects, and it
// is the part of a native video module that actually carries weight. Every
// portal video registers here; activating one pauses the others.
// ---------------------------------------------------------------------------

/** A portal video's participation in arbitration. */
export interface PortalVideoRegistration {
  readonly id: number;
  readonly name: string;
  /** The live element, or null before the portal exists / after it is removed. */
  getElement(): HTMLVideoElement | null;
  getUri(): string | null;
  /** False for views that must never steal or lose the slot (muted GIF loops). */
  arbitrated: boolean;
  /** Whether this view wants playback when it becomes the active video. */
  wantsAutoplay(): boolean;
  play(): void;
  pause(): void;
  isPlaying(): boolean;
  /** Idempotent: the view fires onActiveChange only on a real transition. */
  setActive(active: boolean): void;
}

export function registerPortalVideo(registration: PortalVideoRegistration): () => void {
  registry.handles.add(registration);
  return () => {
    registry.handles.delete(registration);
    if (registry.active === registration) registry.active = null;
  };
}

/** Make one video the active player, pausing every other arbitrated one. */
export function activatePortalVideo(registration: PortalVideoRegistration, options: { play?: boolean } = {}): void {
  if (!registry.arbitration || !registration.arbitrated) {
    if (options.play) registration.play();
    return;
  }
  registry.active = registration;
  for (const other of registry.handles) {
    if (other === registration || !other.arbitrated) continue;
    // Unconditional: pause() on a paused element is a no-op, and asking
    // "is it playing?" first only adds a way to get the answer wrong.
    other.pause();
    other.setActive(false);
  }
  registration.setActive(true);
  if (options.play) registration.play();
}

export function pausePortalVideos(except?: PortalVideoRegistration | null): void {
  for (const handle of registry.handles) {
    if (handle === except) continue;
    handle.pause();
    handle.setActive(false);
  }
  if (registry.active && registry.active !== except) registry.active = null;
}

export function getActivePortalVideo(): PortalVideoRegistration | null {
  return registry.active;
}

/**
 * Arbitration off means every video plays independently. Hosts with a genuine
 * multi-video layout (a wall of muted previews) want this.
 */
export function setVideoArbitrationEnabled(enabled: boolean): void {
  registry.arbitration = enabled;
}

/** Debug surface: what is mounted, mirroring getMissingNativeModules()'s role. */
export function getRegisteredVideos(): Array<{
  id: number;
  name: string;
  uri: string | null;
  isPlaying: boolean;
  isActive: boolean;
}> {
  return [...registry.handles].map((handle) => ({
    id: handle.id,
    name: handle.name,
    uri: handle.getUri(),
    isPlaying: handle.isPlaying(),
    isActive: registry.active === handle,
  }));
}

/** A video is "on screen enough" to be the active player at half visible. */
const ACTIVE_VISIBILITY_THRESHOLD = 0.5;

/**
 * Fraction of the element's box inside the viewport. Portal elements are real
 * DOM, so this is a genuine viewport test rather than a guess — which is why
 * scroll-driven autoplay arbitration can work here at all (a canvas-painted
 * View has no such box; see createVisibilityViewComponent's ceiling).
 */
function visibleFraction(el: HTMLElement): number {
  if (el.style.visibility === 'hidden') return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  return (width * height) / (rect.width * rect.height);
}

/**
 * Recompute which mounted video is the active one from actual on-screen
 * geometry, activate it, and pause the rest. This is what a feed calls after a
 * scroll or a navigation change.
 */
export function updateActiveVideoView(): PortalVideoRegistration | null {
  if (typeof window === 'undefined') return null;
  let best: PortalVideoRegistration | null = null;
  let bestScore = 0;
  for (const handle of registry.handles) {
    if (!handle.arbitrated) continue;
    const el = handle.getElement();
    if (!el) continue;
    const score = visibleFraction(el);
    if (score >= ACTIVE_VISIBILITY_THRESHOLD && score > bestScore) {
      best = handle;
      bestScore = score;
    }
  }
  if (!best) {
    for (const handle of registry.handles) {
      if (!handle.arbitrated) continue;
      handle.pause();
      handle.setActive(false);
    }
    registry.active = null;
    return null;
  }
  activatePortalVideo(best, { play: best.wantsAutoplay() });
  return best;
}

// ---------------------------------------------------------------------------
// Media-element helpers
// ---------------------------------------------------------------------------

const MEDIA_ERROR_TEXT: Record<number, string> = {
  1: 'playback aborted',
  2: 'network error',
  3: 'decode error',
  4: 'source not supported',
};

function mediaErrorMessage(el: HTMLVideoElement): string {
  const error = el.error;
  if (!error) return 'video playback failed';
  const label = MEDIA_ERROR_TEXT[error.code] ?? `media error ${error.code}`;
  return error.message ? `${label}: ${error.message}` : label;
}

function bufferedEnd(el: HTMLVideoElement): number {
  try {
    const ranges = el.buffered;
    return ranges.length > 0 ? ranges.end(ranges.length - 1) : 0;
  } catch {
    return 0;
  }
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * play() that survives every environment this runs in: older browsers and
 * jsdom return undefined instead of a promise, and modern ones reject with
 * NotAllowedError under autoplay policy.
 */
function safePlay(el: HTMLVideoElement, onBlocked?: (error: unknown) => void): Promise<void> {
  let result: unknown;
  try {
    result = el.play();
  } catch (error) {
    onBlocked?.(error);
    return Promise.resolve();
  }
  if (!result || typeof (result as Promise<void>).then !== 'function') return Promise.resolve();
  return (result as Promise<void>).catch((error: unknown) => {
    onBlocked?.(error);
  });
}

function isAutoplayRejection(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'NotAllowedError';
}

// ---------------------------------------------------------------------------
// 1. The portal-video primitive
// ---------------------------------------------------------------------------

export interface PortalVideoNaturalSize {
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';
}

export interface PortalVideoLoadEvent {
  naturalSize: PortalVideoNaturalSize;
  duration: number;
  currentTime: number;
  uri: string | null;
}

export interface PortalVideoErrorEvent {
  error: { code: number; message: string };
  message: string;
  uri: string | null;
}

export interface PortalVideoProgressEvent {
  currentTime: number;
  playableDuration: number;
  seekableDuration: number;
}

export type PortalVideoStatusName = 'idle' | 'loading' | 'readyToPlay' | 'error';

/**
 * One status object serving both dialects: expo-av's AVPlaybackStatus fields
 * (which react-native-video and expo-av consumers destructure) plus
 * expo-video's coarse `status`.
 */
export interface PortalVideoStatus {
  status: PortalVideoStatusName;
  isLoaded: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  didJustFinish: boolean;
  isMuted: boolean;
  volume: number;
  rate: number;
  positionMillis: number;
  durationMillis: number;
  uri: string | null;
  error?: string;
}

/** onProgress fires at most this often (ms) — `timeupdate` is ~4Hz and jittery. */
const DEFAULT_PROGRESS_INTERVAL = 250;

export interface PortalVideoProps {
  source?: VideoSourceLike;
  /** Convenience alias for `source` when the app has a bare URL. */
  uri?: string | null;
  /**
   * Element properties are applied ONLY when the corresponding prop is present.
   * Anything omitted is left to whoever else owns the element — an expo-video
   * VideoPlayer, the browser's own controls, or the user.
   */
  autoPlay?: boolean;
  /** Controlled playback (react-native-video's spelling); overrides autoPlay. */
  paused?: boolean;
  loop?: boolean;
  muted?: boolean;
  volume?: number;
  rate?: number;
  controls?: boolean;
  poster?: string | null;
  preload?: 'none' | 'metadata' | 'auto';
  /** Always forced on: iOS Safari otherwise takes the video fullscreen itself. */
  playsInline?: boolean;
  crossOrigin?: 'anonymous' | 'use-credentials';
  contentFit?: string;
  /** RN's legacy spelling of contentFit; `contentFit` wins when both are set. */
  resizeMode?: string;
  backgroundColor?: string;
  progressUpdateInterval?: number;
  /** Per-view HLS player; falls back to the factory option, then setHlsLoader(). */
  hlsLoader?: HlsLoader;
  /** Whether this view competes for the single active-player slot. */
  arbitrated?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
  /** The live element, as it is created and destroyed by the portal seam. */
  onElement?: (el: HTMLVideoElement | null) => void;
  onLoadStart?: () => void;
  onLoad?: (e: PortalVideoLoadEvent) => void;
  /** First decoded frame is available (`loadeddata`). */
  onReadyForDisplay?: () => void;
  onError?: (e: PortalVideoErrorEvent) => void;
  onEnd?: () => void;
  onProgress?: (e: PortalVideoProgressEvent) => void;
  onPlaybackStatusUpdate?: (status: PortalVideoStatus) => void;
  /** Same payload as onPlaybackStatusUpdate; both spellings are in the wild. */
  onStatusChange?: (status: PortalVideoStatus) => void;
  onPlayingChange?: (e: { isPlaying: boolean }) => void;
  onVolumeChange?: (e: { volume: number; isMuted: boolean }) => void;
  onBufferingChange?: (e: { isBuffering: boolean }) => void;
  onActiveChange?: (e: { isActive: boolean }) => void;
  onFullscreenChange?: (e: { isFullscreen: boolean }) => void;
  onPictureInPictureChange?: (e: { isActive: boolean }) => void;
  children?: React.ReactNode;
}

export interface PortalVideoHandle {
  readonly element: HTMLVideoElement | null;
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly muted: boolean;
  play(): Promise<void>;
  pause(): void;
  togglePlayback(): void;
  seekTo(seconds: number): void;
  seekBy(seconds: number): void;
  /** expo-av's spelling — MILLISECONDS, unlike seekTo. */
  setPositionAsync(positionMillis: number): Promise<void>;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  toggleMuted(): void;
  setRate(rate: number): void;
  enterFullscreen(): Promise<void>;
  exitFullscreen(): Promise<void>;
  startPictureInPicture(): Promise<void>;
  stopPictureInPicture(): Promise<void>;
}

export interface PortalVideoOptions {
  /** Shows up in warnings and getRegisteredVideos(). */
  name?: string;
  /** Props forced under the caller's (a looping GIF player's muted/loop/autoplay). */
  defaults?: Partial<PortalVideoProps>;
  hlsLoader?: HlsLoader;
  /** Default for the `arbitrated` prop. */
  arbitrated?: boolean;
}

/** Element events the primitive listens to. One handler switches on type. */
const MEDIA_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'durationchange',
  'canplay',
  'play',
  'playing',
  'pause',
  'waiting',
  'timeupdate',
  'ended',
  'error',
  'volumechange',
  'ratechange',
  'enterpictureinpicture',
  'leavepictureinpicture',
] as const;

function mergeDefaults(base: Partial<PortalVideoProps>, over: PortalVideoProps): PortalVideoProps {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value !== undefined) out[key] = value;
  }
  return out as PortalVideoProps;
}

let nextPortalKey = 1;

export type PortalVideoComponent = React.ForwardRefExoticComponent<
  PortalVideoProps & React.RefAttributes<PortalVideoHandle>
>;

/**
 * Build a video component over the portal seam. Everything else in this file —
 * the expo-video shim, the registry factories — is a thin adapter over one of
 * these.
 */
export function createPortalVideoView(options: PortalVideoOptions = {}): PortalVideoComponent {
  const { name = 'PortalVideo', defaults, hlsLoader: optionLoader, arbitrated: defaultArbitrated = true } = options;

  const Component = React.forwardRef<PortalVideoHandle, PortalVideoProps>(function PortalVideo(rawProps, ref) {
    const props = defaults ? mergeDefaults(defaults, rawProps) : rawProps;
    const propsRef = React.useRef(props);
    propsRef.current = props;

    const key = React.useMemo(() => `nsv-${nextPortalKey++}`, []);
    const elRef = React.useRef<HTMLVideoElement | null>(null);
    /** undefined = never attached; null = attached with no source. */
    const attachedUriRef = React.useRef<string | null | undefined>(undefined);
    const hlsDetachRef = React.useRef<HlsDetach | null>(null);
    const statusRef = React.useRef<{ name: PortalVideoStatusName; buffering: boolean; finished: boolean; error?: string }>(
      { name: 'idle', buffering: false, finished: false }
    );
    const lastProgressRef = React.useRef(0);
    const activeRef = React.useRef(false);
    const fullscreenRef = React.useRef(false);

    const uri = resolveVideoUri(props.source) ?? resolveVideoUri(props.uri);

    // --- status -----------------------------------------------------------

    const buildStatus = React.useCallback((): PortalVideoStatus => {
      const el = elRef.current;
      const state = statusRef.current;
      const p = propsRef.current;
      return {
        status: state.name,
        isLoaded: state.name === 'readyToPlay',
        isPlaying: el ? !el.paused && !el.ended : false,
        isBuffering: state.buffering,
        didJustFinish: state.finished,
        isMuted: el ? el.muted : Boolean(p.muted),
        volume: el ? el.volume : p.volume ?? 1,
        rate: el ? el.playbackRate : p.rate ?? 1,
        positionMillis: el ? finiteOrZero(el.currentTime) * 1000 : 0,
        durationMillis: el ? finiteOrZero(el.duration) * 1000 : 0,
        uri: attachedUriRef.current ?? null,
        error: state.error,
      };
    }, []);

    const emitStatus = React.useCallback((): void => {
      const status = buildStatus();
      propsRef.current.onPlaybackStatusUpdate?.(status);
      propsRef.current.onStatusChange?.(status);
    }, [buildStatus]);

    const setStatusName = React.useCallback(
      (next: PortalVideoStatusName): void => {
        const state = statusRef.current;
        if (state.name === next) return;
        state.name = next;
        if (next !== 'error') state.error = undefined;
        emitStatus();
      },
      [emitStatus]
    );

    const reportError = React.useCallback(
      (message: string, code = -1): void => {
        statusRef.current.name = 'error';
        statusRef.current.error = message;
        propsRef.current.onError?.({
          error: { code, message },
          message,
          uri: attachedUriRef.current ?? null,
        });
        emitStatus();
      },
      [emitStatus]
    );

    const onPlayBlocked = React.useCallback(
      (error: unknown): void => {
        if (isAutoplayRejection(error)) {
          warnOnce(
            'autoplay',
            'the browser blocked autoplay — a video must be muted or follow a user gesture. The video stays paused.'
          );
          return;
        }
        reportError(`play() failed: ${String(error)}`);
      },
      [reportError]
    );

    // --- arbitration registration ----------------------------------------

    const registrationRef = React.useRef<PortalVideoRegistration | null>(null);
    if (registrationRef.current === null) {
      registrationRef.current = {
        id: registry.nextId++,
        name,
        arbitrated: props.arbitrated ?? defaultArbitrated,
        getElement: () => elRef.current,
        getUri: () => attachedUriRef.current ?? null,
        wantsAutoplay: () => Boolean(propsRef.current.autoPlay) && propsRef.current.paused !== true,
        play: () => {
          const el = elRef.current;
          if (el) void safePlay(el, onPlayBlocked);
        },
        pause: () => {
          elRef.current?.pause();
        },
        isPlaying: () => {
          const el = elRef.current;
          return Boolean(el && !el.paused && !el.ended);
        },
        setActive: (active: boolean) => {
          if (activeRef.current === active) return;
          activeRef.current = active;
          propsRef.current.onActiveChange?.({ isActive: active });
        },
      };
    }
    const registration = registrationRef.current;

    const claimActive = React.useCallback((): void => {
      activatePortalVideo(registration);
    }, [registration]);

    React.useEffect(() => registerPortalVideo(registration), [registration]);

    const arbitrated = props.arbitrated ?? defaultArbitrated;
    React.useEffect(() => {
      registration.arbitrated = arbitrated;
    }, [registration, arbitrated]);

    // --- source attachment -------------------------------------------------

    const detachHls = React.useCallback((): void => {
      const detach = hlsDetachRef.current;
      hlsDetachRef.current = null;
      if (!detach) return;
      try {
        detach();
      } catch (error) {
        warnOnce('hls-detach', `the hlsLoader teardown threw: ${String(error)}`);
      }
    }, []);

    const attachSource = React.useCallback(
      (el: HTMLVideoElement, next: string | null): void => {
        if (attachedUriRef.current === next) return;
        detachHls();
        attachedUriRef.current = next;
        statusRef.current.finished = false;

        if (!next) {
          el.removeAttribute('src');
          el.load();
          setStatusName('idle');
          return;
        }
        if (!isHlsSource(next)) {
          el.src = next;
          el.load();
          return;
        }

        const loader = propsRef.current.hlsLoader ?? optionLoader ?? registry.hlsLoader;
        if (loader) {
          let result: HlsDetach | void | Promise<HlsDetach | void>;
          try {
            result = loader({
              video: el,
              uri: next,
              autoPlay: Boolean(propsRef.current.autoPlay) && propsRef.current.paused !== true,
              reportError: (message: string) => reportError(message),
            });
          } catch (error) {
            reportError(`the hlsLoader threw for ${next}: ${String(error)}`);
            return;
          }
          void Promise.resolve(result).then(
            (detach) => {
              // The source may have changed again while the loader was working.
              if (attachedUriRef.current !== next) {
                detach?.();
                return;
              }
              hlsDetachRef.current = detach ?? null;
            },
            (error: unknown) => reportError(`the hlsLoader rejected for ${next}: ${String(error)}`)
          );
          return;
        }

        if (canPlayHlsNatively(el)) {
          el.src = next;
          el.load();
          return;
        }

        // The src is deliberately left unset: assigning it here buys a network
        // round trip and a generic decode error, when the real answer is known
        // now and worth naming. MEDIA_ERR_SRC_NOT_SUPPORTED is code 4.
        const message = hlsUnsupportedMessage(next);
        warnOnce('hls-unsupported', message);
        reportError(message, 4);
      },
      [detachHls, reportError, setStatusName]
    );

    // --- element property application -------------------------------------

    const applyElementProps = React.useCallback((): void => {
      const el = elRef.current;
      if (!el) return;
      const p = propsRef.current;
      // Never optional: without it iOS Safari hijacks the whole screen the
      // moment playback starts.
      el.playsInline = true;
      if (p.muted !== undefined) el.muted = p.muted;
      if (p.loop !== undefined) el.loop = p.loop;
      if (p.controls !== undefined) el.controls = p.controls;
      if (p.volume !== undefined) el.volume = clamp01(p.volume);
      if (p.rate !== undefined) el.playbackRate = p.rate;
    }, []);

    // --- element events ----------------------------------------------------

    const onMediaEvent = React.useCallback(
      (event: Event): void => {
        const el = elRef.current;
        if (!el) return;
        const p = propsRef.current;
        switch (event.type) {
          case 'loadstart':
            statusRef.current.buffering = true;
            setStatusName('loading');
            p.onLoadStart?.();
            break;
          case 'loadedmetadata':
            p.onLoad?.({
              naturalSize: {
                width: el.videoWidth,
                height: el.videoHeight,
                orientation: el.videoHeight > el.videoWidth ? 'portrait' : 'landscape',
              },
              duration: finiteOrZero(el.duration),
              currentTime: finiteOrZero(el.currentTime),
              uri: attachedUriRef.current ?? null,
            });
            emitStatus();
            break;
          case 'loadeddata':
            p.onReadyForDisplay?.();
            break;
          case 'durationchange':
            emitStatus();
            break;
          case 'canplay':
            statusRef.current.buffering = false;
            p.onBufferingChange?.({ isBuffering: false });
            setStatusName('readyToPlay');
            break;
          case 'play':
            statusRef.current.finished = false;
            // Playback can start without going through this module's play():
            // native controls, a bound expo-video player, or the `autoplay`
            // attribute. Arbitration has to hear about all of them.
            claimActive();
            p.onPlayingChange?.({ isPlaying: true });
            emitStatus();
            break;
          case 'playing':
            statusRef.current.buffering = false;
            p.onBufferingChange?.({ isBuffering: false });
            emitStatus();
            break;
          case 'pause':
            p.onPlayingChange?.({ isPlaying: false });
            emitStatus();
            break;
          case 'waiting':
            statusRef.current.buffering = true;
            p.onBufferingChange?.({ isBuffering: true });
            emitStatus();
            break;
          case 'timeupdate': {
            const interval = p.progressUpdateInterval ?? DEFAULT_PROGRESS_INTERVAL;
            const now = Date.now();
            if (now - lastProgressRef.current < interval) break;
            lastProgressRef.current = now;
            p.onProgress?.({
              currentTime: finiteOrZero(el.currentTime),
              playableDuration: bufferedEnd(el),
              seekableDuration: finiteOrZero(el.duration),
            });
            break;
          }
          case 'ended':
            statusRef.current.finished = true;
            p.onEnd?.();
            p.onPlayingChange?.({ isPlaying: false });
            emitStatus();
            break;
          case 'error':
            reportError(mediaErrorMessage(el), el.error?.code ?? -1);
            break;
          case 'volumechange':
            p.onVolumeChange?.({ volume: el.volume, isMuted: el.muted });
            emitStatus();
            break;
          case 'ratechange':
            emitStatus();
            break;
          case 'enterpictureinpicture':
            p.onPictureInPictureChange?.({ isActive: true });
            break;
          case 'leavepictureinpicture':
            p.onPictureInPictureChange?.({ isActive: false });
            break;
        }
      },
      [claimActive, emitStatus, reportError, setStatusName]
    );

    // --- portal element lifecycle -----------------------------------------

    const portalRef = React.useCallback(
      (element: HTMLElement | null): void => {
        const previous = elRef.current;
        if (previous) {
          for (const type of MEDIA_EVENTS) previous.removeEventListener(type, onMediaEvent);
        }
        const el = element as HTMLVideoElement | null;
        elRef.current = el;

        if (!el) {
          detachHls();
          attachedUriRef.current = undefined;
          registration.setActive(false);
          propsRef.current.onElement?.(null);
          return;
        }

        for (const type of MEDIA_EVENTS) el.addEventListener(type, onMediaEvent);
        applyElementProps();
        const p = propsRef.current;
        attachSource(el, resolveVideoUri(p.source) ?? resolveVideoUri(p.uri));
        p.onElement?.(el);
        if (p.autoPlay && p.paused !== true) void safePlay(el, onPlayBlocked);
      },
      [applyElementProps, attachSource, detachHls, onMediaEvent, onPlayBlocked, registration]
    );

    // Source changes after the element exists.
    React.useEffect(() => {
      const el = elRef.current;
      if (el) attachSource(el, uri);
    }, [uri, attachSource]);

    // Prop-driven element properties.
    React.useEffect(() => {
      applyElementProps();
    }, [applyElementProps, props.muted, props.loop, props.controls, props.volume, props.rate]);

    // Playback intent. `paused` is authoritative when present; otherwise only a
    // TRANSITION of autoPlay moves the element, so a user pausing through the
    // native controls is not overridden by the next unrelated re-render.
    const previousAutoPlayRef = React.useRef<boolean | undefined>(undefined);
    React.useEffect(() => {
      const el = elRef.current;
      const autoPlay = props.autoPlay;
      const wasAutoPlay = previousAutoPlayRef.current;
      previousAutoPlayRef.current = autoPlay;
      if (!el) return;
      if (props.paused === true) {
        el.pause();
        return;
      }
      if (props.paused === false) {
        void safePlay(el, onPlayBlocked);
        return;
      }
      if (autoPlay && !wasAutoPlay) void safePlay(el, onPlayBlocked);
      else if (!autoPlay && wasAutoPlay) el.pause();
    }, [props.autoPlay, props.paused, onPlayBlocked]);

    // Fullscreen is a document-level event; report only this element's changes.
    React.useEffect(() => {
      if (typeof document === 'undefined') return;
      const onFullscreenChange = (): void => {
        const el = elRef.current;
        const doc = document as Document & { webkitFullscreenElement?: Element | null };
        const isFullscreen = Boolean(el && (doc.fullscreenElement === el || doc.webkitFullscreenElement === el));
        if (isFullscreen === fullscreenRef.current) return;
        fullscreenRef.current = isFullscreen;
        propsRef.current.onFullscreenChange?.({ isFullscreen });
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      return () => {
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      };
    }, []);

    React.useEffect(() => detachHls, [detachHls]);

    // --- imperative surface ------------------------------------------------

    React.useImperativeHandle(
      ref,
      (): PortalVideoHandle => ({
        get element() {
          return elRef.current;
        },
        get currentTime() {
          return finiteOrZero(elRef.current?.currentTime);
        },
        get duration() {
          return finiteOrZero(elRef.current?.duration);
        },
        get paused() {
          return elRef.current?.paused ?? true;
        },
        get muted() {
          return elRef.current?.muted ?? Boolean(propsRef.current.muted);
        },
        async play() {
          const el = elRef.current;
          if (!el) return;
          activatePortalVideo(registration);
          await safePlay(el, onPlayBlocked);
        },
        pause() {
          elRef.current?.pause();
        },
        togglePlayback() {
          const el = elRef.current;
          if (!el) return;
          if (el.paused) {
            activatePortalVideo(registration);
            void safePlay(el, onPlayBlocked);
          } else {
            el.pause();
          }
        },
        seekTo(seconds: number) {
          const el = elRef.current;
          if (el) el.currentTime = Math.max(0, seconds);
        },
        seekBy(seconds: number) {
          const el = elRef.current;
          if (el) el.currentTime = Math.max(0, finiteOrZero(el.currentTime) + seconds);
        },
        async setPositionAsync(positionMillis: number) {
          const el = elRef.current;
          if (el) el.currentTime = Math.max(0, positionMillis / 1000);
        },
        setVolume(volume: number) {
          const el = elRef.current;
          if (el) el.volume = clamp01(volume);
        },
        setMuted(muted: boolean) {
          const el = elRef.current;
          if (el) el.muted = muted;
        },
        toggleMuted() {
          const el = elRef.current;
          if (el) el.muted = !el.muted;
        },
        setRate(rate: number) {
          const el = elRef.current;
          if (el) el.playbackRate = rate;
        },
        async enterFullscreen() {
          const el = elRef.current as
            | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
            | null;
          if (!el) return;
          try {
            if (typeof el.requestFullscreen === 'function') await el.requestFullscreen();
            else if (typeof el.webkitEnterFullscreen === 'function') el.webkitEnterFullscreen();
            else warnOnce('fullscreen', 'this browser exposes no fullscreen API for a media element.');
          } catch (error) {
            warnOnce('fullscreen-blocked', `fullscreen was refused (it needs a user gesture): ${String(error)}`);
          }
        },
        async exitFullscreen() {
          if (typeof document === 'undefined') return;
          const doc = document as Document & { webkitExitFullscreen?: () => void };
          try {
            if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
            else doc.webkitExitFullscreen?.();
          } catch (error) {
            warnOnce('fullscreen-exit', `exiting fullscreen failed: ${String(error)}`);
          }
        },
        async startPictureInPicture() {
          const el = elRef.current as
            | (HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> })
            | null;
          if (!el?.requestPictureInPicture) {
            warnOnce('pip', 'picture-in-picture is not available in this browser (Firefox has no web API for it).');
            return;
          }
          try {
            await el.requestPictureInPicture();
          } catch (error) {
            warnOnce('pip-blocked', `picture-in-picture was refused: ${String(error)}`);
          }
        },
        async stopPictureInPicture() {
          if (typeof document === 'undefined') return;
          const doc = document as Document & {
            pictureInPictureElement?: Element | null;
            exitPictureInPicture?: () => Promise<void>;
          };
          if (!doc.pictureInPictureElement || !doc.exitPictureInPicture) return;
          try {
            await doc.exitPictureInPicture();
          } catch {
            /* already left PiP */
          }
        },
      }),
      [onPlayBlocked, registration]
    );

    // --- render ------------------------------------------------------------

    if (props.children != null) {
      warnOnce(
        'children',
        'children of a video view render on the canvas, which composites BENEATH the portal element — they will be hidden by the video. Taps still reach them.'
      );
    }

    const attrs: Record<string, string | number | boolean> = {
      playsinline: true,
      'webkit-playsinline': true,
      'data-ns-video': key,
    };
    if (props.poster) attrs.poster = props.poster;
    if (props.preload) attrs.preload = props.preload;
    if (props.crossOrigin) attrs.crossorigin = props.crossOrigin;
    if (props.loop !== undefined) attrs.loop = props.loop;
    // The muted ATTRIBUTE (reflecting defaultMuted) is what the autoplay
    // heuristics read at load time; applyElementProps sets the property.
    if (props.muted !== undefined) attrs.muted = props.muted;
    if (props.controls !== undefined) attrs.controls = props.controls;
    if (props.autoPlay !== undefined) attrs.autoplay = props.autoPlay;
    if (props.accessibilityLabel) attrs['aria-label'] = props.accessibilityLabel;

    const portalStyle: Record<string, string> = {
      'object-fit': toObjectFit(props.contentFit ?? props.resizeMode, 'contain'),
      // Without native controls the element must not swallow taps: the app's
      // own controls are canvas-painted UNDER it, and the engine can only
      // hit-test what reaches the canvas.
      'pointer-events': props.controls ? 'auto' : 'none',
    };
    if (props.backgroundColor) portalStyle['background-color'] = props.backgroundColor;

    return (
      <HostView
        style={[{ flex: 1 }, props.style]}
        testID={props.testID}
        onLayout={props.onLayout}
        pointerEvents={props.pointerEvents}
        accessible={props.accessible}
        accessibilityLabel={props.accessibilityLabel}
        accessibilityHint={props.accessibilityHint}
      >
        <HostView
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          __portal={{ tag: 'video', key, attrs, style: portalStyle }}
          __portalRef={portalRef}
        />
        {props.children}
      </HostView>
    );
  });

  Component.displayName = `PortalVideo(${name})`;
  return Component;
}

/** Ready-made general video view for hosts that just want one. */
export const PortalVideo: PortalVideoComponent = createPortalVideoView({ name: 'PortalVideo' });

// ---------------------------------------------------------------------------
// 2. expo-video (SDK 57)
// ---------------------------------------------------------------------------

export type VideoContentFit = 'contain' | 'cover' | 'fill';
export type SurfaceType = 'textureView' | 'surfaceView';
export type VideoPlayerStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';
export type AudioMixingMode = 'mixWithOthers' | 'duckOthers' | 'auto' | 'doNotMix';
export type ContentType = 'auto' | 'progressive' | 'hls' | 'dash' | 'smoothStreaming';
export type DRMType = 'clearkey' | 'fairplay' | 'playready' | 'widevine';
export type VideoRange = 'SDR' | 'HDR' | 'unknown';
export type FullscreenOrientation =
  | 'default'
  | 'portrait'
  | 'portraitUp'
  | 'portraitDown'
  | 'landscape'
  | 'landscapeLeft'
  | 'landscapeRight';
export type KeepFullscreenOnPiPStopBehavior = 'always' | 'autoEnter' | 'never';

export interface VideoMetadata {
  title?: string;
  artist?: string;
  artwork?: string;
}

export interface DRMOptions {
  type: DRMType;
  licenseServer: string;
  headers?: Record<string, string>;
  multiKey?: boolean;
  contentId?: string;
  certificateUrl?: string;
}

export interface VideoSource {
  uri?: string;
  assetId?: number;
  drm?: DRMOptions;
  metadata?: VideoMetadata;
  headers?: Record<string, string>;
  useCaching?: boolean;
  contentType?: ContentType;
}

export type VideoSourceInput = string | number | VideoSource | null;

export interface PlayerError {
  message: string;
}

export interface BufferOptions {
  preferredForwardBufferDuration?: number;
  waitsToMinimizeStalling?: boolean;
  minBufferForPlayback?: number;
  maxBufferBytes?: number | null;
  prioritizeTimeOverSizeThreshold?: boolean;
}

export interface SeekTolerance {
  toleranceBefore?: number;
  toleranceAfter?: number;
}

export interface ScrubbingModeOptions {
  scrubbingModeEnabled?: boolean;
  increaseCodecOperatingRate?: boolean;
  enableDynamicScheduling?: boolean;
  useDecodeOnlyFlag?: boolean;
  allowSkippingMediaCodecFlush?: boolean;
}

export interface PlayerBuilderOptions {
  seekBackwardIncrement?: number;
  seekForwardIncrement?: number;
}

export interface VideoSize {
  width: number;
  height: number;
}

export interface AudioTrack {
  id?: string;
  language: string;
  label: string;
}

export interface SubtitleTrack {
  id?: string;
  language: string;
  label: string;
}

export interface VideoTrack {
  id: string;
  size: VideoSize;
  mimeType: string | null;
  isSupported: boolean;
  bitrate: number | null;
  frameRate: number | null;
}

export interface VideoThumbnailOptions {
  maxWidth?: number;
  maxHeight?: number;
}

export interface StatusChangeEventPayload {
  status: VideoPlayerStatus;
  oldStatus?: VideoPlayerStatus;
  error?: PlayerError;
}

export interface PlayingChangeEventPayload {
  isPlaying: boolean;
  oldIsPlaying?: boolean;
}

export interface PlaybackRateChangeEventPayload {
  playbackRate: number;
  oldPlaybackRate?: number;
}

export interface VolumeChangeEventPayload {
  volume: number;
  oldVolume?: number;
}

export interface MutedChangeEventPayload {
  muted: boolean;
  oldMuted?: boolean;
}

export interface SourceChangeEventPayload {
  source: VideoSource | null;
  oldSource?: VideoSource | null;
}

export interface TimeUpdateEventPayload {
  currentTime: number;
  currentLiveTimestamp: number | null;
  currentOffsetFromLive: number | null;
  bufferedPosition: number;
}

export interface SourceLoadEventPayload {
  duration: number;
  availableVideoTracks: VideoTrack[];
  availableSubtitleTracks: SubtitleTrack[];
  availableAudioTracks: AudioTrack[];
  videoSource: VideoSource | null;
}

export interface SubtitleTrackChangeEventPayload {
  subtitleTrack: SubtitleTrack | null;
  oldSubtitleTrack?: SubtitleTrack | null;
}

export interface AvailableSubtitleTracksChangeEventPayload {
  availableSubtitleTracks: SubtitleTrack[];
  oldAvailableSubtitleTracks?: SubtitleTrack[];
}

export interface AudioTrackChangeEventPayload {
  audioTrack: AudioTrack | null;
  oldAudioTrack?: AudioTrack | null;
}

export interface AvailableAudioTracksChangeEventPayload {
  availableAudioTracks: AudioTrack[];
  oldAvailableAudioTracks?: AudioTrack[];
}

export interface VideoTrackChangeEventPayload {
  videoTrack: VideoTrack | null;
  oldVideoTrack?: VideoTrack | null;
}

export interface IsExternalPlaybackActiveChangeEventPayload {
  isExternalPlaybackActive: boolean;
  oldIsExternalPlaybackActive?: boolean;
}

/**
 * The emitter shape the real module hands to useEvent/useEventListener. The
 * track and external-playback events are declared so subscribers typecheck;
 * nothing emits them here (a media element exposes no track switching and no
 * AirPlay).
 */
export type VideoPlayerEvents = {
  statusChange(payload: StatusChangeEventPayload): void;
  playingChange(payload: PlayingChangeEventPayload): void;
  playbackRateChange(payload: PlaybackRateChangeEventPayload): void;
  volumeChange(payload: VolumeChangeEventPayload): void;
  mutedChange(payload: MutedChangeEventPayload): void;
  playToEnd(): void;
  timeUpdate(payload: TimeUpdateEventPayload): void;
  sourceChange(payload: SourceChangeEventPayload): void;
  sourceLoad(payload: SourceLoadEventPayload): void;
  subtitleTrackChange(payload: SubtitleTrackChangeEventPayload): void;
  availableSubtitleTracksChange(payload: AvailableSubtitleTracksChangeEventPayload): void;
  audioTrackChange(payload: AudioTrackChangeEventPayload): void;
  availableAudioTracksChange(payload: AvailableAudioTracksChangeEventPayload): void;
  videoTrackChange(payload: VideoTrackChangeEventPayload): void;
  isExternalPlaybackActiveChange(payload: IsExternalPlaybackActiveChangeEventPayload): void;
};

function toVideoSource(source: VideoSourceInput): VideoSource | null {
  if (source === null || source === undefined) return null;
  if (typeof source === 'string') return source === '' ? null : { uri: source };
  if (typeof source === 'number') {
    warnOnce('numeric-source', 'a numeric asset id is not resolvable here — pass {uri} or a string URL.');
    return null;
  }
  return source;
}

/** Element events the player listens to; separate from the primitive's set. */
const PLAYER_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'canplay',
  'play',
  'pause',
  'playing',
  'waiting',
  'timeupdate',
  'ended',
  'error',
  'volumechange',
  'ratechange',
  'durationchange',
] as const;

/**
 * An expo-video player.
 *
 * The real thing owns a native player that a view attaches to. Here the
 * relationship is inverted: the browser gives one media element PER VIEW, so
 * this object holds intent (source, volume, loop, whether it should be
 * playing) and drives whichever element a mounted `VideoView` hands it. It
 * never touches `src` — the portal primitive owns that, because that is where
 * the HLS decision lives.
 */
export class VideoPlayer extends EventEmitter<VideoPlayerEvents> {
  /** Emitted every `timeUpdateEventInterval` SECONDS; 0 disables, as on native. */
  timeUpdateEventInterval = 0;

  // Accepted and inert — the browser, not the app, decides these.
  allowsExternalPlayback = true;
  audioMixingMode: AudioMixingMode = 'auto';
  preservesPitch = true;
  keepScreenOnWhilePlaying = false;
  showNowPlayingNotification = false;
  staysActiveInBackground = false;
  targetOffsetFromLive = 0;
  bufferOptions: BufferOptions = {};
  seekTolerance: SeekTolerance = {};
  scrubbingModeOptions: ScrubbingModeOptions = {};
  subtitleTrack: SubtitleTrack | null = null;
  audioTrack: AudioTrack | null = null;
  readonly availableAudioTracks: AudioTrack[] = [];
  readonly availableSubtitleTracks: SubtitleTrack[] = [];
  readonly availableVideoTracks: VideoTrack[] = [];
  readonly videoTrack: VideoTrack | null = null;
  readonly isExternalPlaybackActive = false;
  readonly currentLiveTimestamp: number | null = null;
  readonly currentOffsetFromLive: number | null = null;

  private el: HTMLVideoElement | null = null;
  private detachElement: (() => void) | null = null;
  private _source: VideoSource | null;
  private _status: VideoPlayerStatus = 'idle';
  private _playing = false;
  private _muted = false;
  private _volume = 1;
  private _loop = false;
  private _playbackRate = 1;
  private _shouldPlay = false;
  /** Survives a view swap, so a re-attached player resumes where it was. */
  private _currentTime = 0;
  private _duration = 0;
  private _bufferedPosition = 0;
  private _lastTimeUpdate = 0;

  constructor(source: VideoSourceInput = null, _useSynchronousReplace?: boolean, _options?: PlayerBuilderOptions) {
    super();
    this._source = toVideoSource(source);
    // status/timeUpdate do not emit on create — VideoFeed loops were not this path.
  }

  // --- state ---------------------------------------------------------------

  get source(): VideoSource | null {
    return this._source;
  }

  get playing(): boolean {
    return this._playing;
  }

  get status(): VideoPlayerStatus {
    return this._status;
  }

  get isLive(): boolean {
    return this.el ? this.el.duration === Infinity : false;
  }

  get duration(): number {
    return this._duration;
  }

  get bufferedPosition(): number {
    return this._bufferedPosition;
  }

  get currentTime(): number {
    return this.el ? finiteOrZero(this.el.currentTime) : this._currentTime;
  }

  set currentTime(seconds: number) {
    this._currentTime = Math.max(0, seconds);
    if (this.el) this.el.currentTime = this._currentTime;
  }

  get loop(): boolean {
    return this._loop;
  }

  set loop(value: boolean) {
    this._loop = value;
    if (this.el) this.el.loop = value;
  }

  get muted(): boolean {
    return this._muted;
  }

  set muted(value: boolean) {
    if (this._muted === value) return;
    const oldMuted = this._muted;
    this._muted = value;
    if (this.el) this.el.muted = value;
    this.emit('mutedChange', { muted: value, oldMuted });
  }

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    const next = clamp01(value);
    if (this._volume === next) return;
    const oldVolume = this._volume;
    this._volume = next;
    if (this.el) this.el.volume = next;
    this.emit('volumeChange', { volume: next, oldVolume });
  }

  get playbackRate(): number {
    return this._playbackRate;
  }

  set playbackRate(value: number) {
    const oldPlaybackRate = this._playbackRate;
    this._playbackRate = value;
    if (this.el) this.el.playbackRate = value;
    if (oldPlaybackRate !== value) this.emit('playbackRateChange', { playbackRate: value, oldPlaybackRate });
  }

  // --- commands ------------------------------------------------------------

  play(): void {
    this._shouldPlay = true;
    // play()/addListener do not emit; timeUpdate stays gated on interval > 0.
    const el = this.el;
    if (!el) return;
    void safePlay(el, (error) => {
      if (isAutoplayRejection(error)) {
        warnOnce('autoplay', 'the browser blocked autoplay — a video must be muted or follow a user gesture.');
        return;
      }
      this.setStatus('error', { message: `play() failed: ${String(error)}` });
    });
  }

  pause(): void {
    this._shouldPlay = false;
    this.el?.pause();
  }

  replace(source: VideoSourceInput, _disableWarning?: boolean): void {
    const oldSource = this._source;
    this._source = toVideoSource(source);
    this._currentTime = 0;
    this._duration = 0;
    this.setStatus(this._source ? 'loading' : 'idle');
    this.emit('sourceChange', { source: this._source, oldSource });
  }

  async replaceAsync(source: VideoSourceInput): Promise<void> {
    this.replace(source);
  }

  seekBy(seconds: number): void {
    this.currentTime = this.currentTime + seconds;
  }

  replay(): void {
    this.currentTime = 0;
    this.play();
  }

  async generateThumbnailsAsync(
    times: number | number[],
    _options?: VideoThumbnailOptions
  ): Promise<VideoThumbnail[]> {
    const uri = this._source?.uri;
    if (!uri) return [];
    const list = Array.isArray(times) ? times : [times];
    const out: VideoThumbnail[] = [];
    for (const time of list) {
      const frame = await grabVideoFrame(uri, time);
      out.push(new VideoThumbnail(frame.uri, frame.width, frame.height, time));
    }
    return out;
  }

  release(): void {
    this.attachElement(null);
    this.removeAllListeners();
  }

  // --- element binding (internal; VideoView is the only caller) ------------

  /** @internal */
  attachElement(el: HTMLVideoElement | null): void {
    if (this.el === el) return;
    this.detachElement?.();
    this.detachElement = null;
    this.el?.pause();
    this.el = el;
    if (!el) return;

    el.loop = this._loop;
    el.muted = this._muted;
    el.volume = this._volume;
    el.playbackRate = this._playbackRate;
    if (this._currentTime > 0) el.currentTime = this._currentTime;

    const handler = (event: Event): void => this.onElementEvent(event);
    for (const type of PLAYER_EVENTS) el.addEventListener(type, handler);
    this.detachElement = () => {
      for (const type of PLAYER_EVENTS) el.removeEventListener(type, handler);
    };
    if (this._shouldPlay) this.play();
  }

  private setStatus(next: VideoPlayerStatus, error?: PlayerError): void {
    if (this._status === next && !error) return;
    const oldStatus = this._status;
    this._status = next;
    this.emit('statusChange', { status: next, oldStatus, error });
  }

  private setPlaying(next: boolean): void {
    if (this._playing === next) return;
    const oldIsPlaying = this._playing;
    this._playing = next;
    this.emit('playingChange', { isPlaying: next, oldIsPlaying });
  }

  private onElementEvent(event: Event): void {
    const el = this.el;
    if (!el) return;
    switch (event.type) {
      case 'loadstart':
        this.setStatus('loading');
        break;
      case 'loadedmetadata':
        this._duration = finiteOrZero(el.duration);
        this.emit('sourceLoad', {
          duration: this._duration,
          availableVideoTracks: [],
          availableSubtitleTracks: [],
          availableAudioTracks: [],
          videoSource: this._source,
        });
        break;
      case 'durationchange':
        this._duration = finiteOrZero(el.duration);
        break;
      case 'canplay':
        this.setStatus('readyToPlay');
        break;
      case 'play':
      case 'playing':
        this._shouldPlay = true;
        this.setPlaying(true);
        break;
      case 'pause':
        this.setPlaying(false);
        break;
      case 'waiting':
        this._bufferedPosition = bufferedEnd(el);
        break;
      case 'timeupdate': {
        this._currentTime = finiteOrZero(el.currentTime);
        this._bufferedPosition = bufferedEnd(el);
        const interval = this.timeUpdateEventInterval;
        if (interval <= 0) break;
        const now = Date.now();
        if (now - this._lastTimeUpdate < interval * 1000) break;
        this._lastTimeUpdate = now;
        this.emit('timeUpdate', {
          currentTime: this._currentTime,
          currentLiveTimestamp: null,
          currentOffsetFromLive: null,
          bufferedPosition: this._bufferedPosition,
        });
        break;
      }
      case 'ended':
        this.setPlaying(false);
        this.emit('playToEnd');
        break;
      case 'error':
        this.setStatus('error', { message: mediaErrorMessage(el) });
        break;
      case 'volumechange':
        if (el.volume !== this._volume) {
          const oldVolume = this._volume;
          this._volume = el.volume;
          this.emit('volumeChange', { volume: el.volume, oldVolume });
        }
        if (el.muted !== this._muted) {
          const oldMuted = this._muted;
          this._muted = el.muted;
          this.emit('mutedChange', { muted: el.muted, oldMuted });
        }
        break;
      case 'ratechange':
        if (el.playbackRate !== this._playbackRate) {
          const oldPlaybackRate = this._playbackRate;
          this._playbackRate = el.playbackRate;
          this.emit('playbackRateChange', { playbackRate: el.playbackRate, oldPlaybackRate });
        }
        break;
    }
  }
}

/** A grabbed frame. The real class wraps a native image; here it is a blob URL. */
export class VideoThumbnail {
  readonly nativeRefType = 'image';
  constructor(
    public uri: string,
    public width: number,
    public height: number,
    public requestedTime: number = 0,
    public actualTime: number = requestedTime
  ) {}

  release(): void {
    if (this.uri.startsWith('blob:')) URL.revokeObjectURL(this.uri);
  }
}

export function createVideoPlayer(source: VideoSourceInput, _options?: PlayerBuilderOptions): VideoPlayer {
  return new VideoPlayer(source);
}

export function useVideoPlayer(
  source: VideoSourceInput,
  setup?: (player: VideoPlayer) => void,
  _options?: PlayerBuilderOptions
): VideoPlayer {
  const parsed = toVideoSource(source);
  return useReleasingSharedObject(() => {
    const player = new VideoPlayer(parsed);
    setup?.(player);
    return player;
  }, [JSON.stringify(parsed)]);
}

/** Firefox is the notable browser without a Picture-in-Picture API. */
export function isPictureInPictureSupported(): boolean {
  return typeof document !== 'undefined' && document.pictureInPictureEnabled === true;
}

/** The browser's HTTP cache governs video caching here; these are advisory. */
export async function clearVideoCacheAsync(): Promise<void> {
  warnOnce('video-cache', 'video caching is the browser HTTP cache here — clear/size calls are no-ops.');
}

export async function setVideoCacheSizeAsync(_sizeBytes: number): Promise<void> {
  warnOnce('video-cache', 'video caching is the browser HTTP cache here — clear/size calls are no-ops.');
}

export function getCurrentVideoCacheSize(): number {
  return 0;
}

export interface ButtonOptions {
  showNext?: boolean;
  showPrevious?: boolean;
  showSeekForward?: boolean;
  showSeekBackward?: boolean;
  showSubtitles?: boolean | null;
  showSettings?: boolean;
  showPlayPause?: boolean;
  showBottomBar?: boolean;
}

export interface FullscreenOptions {
  enable: boolean;
  orientation?: FullscreenOrientation;
  autoExitOnRotate?: boolean;
  keepFullscreenOnPiPStop?: KeepFullscreenOnPiPStopBehavior;
}

export interface VideoViewProps {
  player?: VideoPlayer | null;
  nativeControls?: boolean;
  contentFit?: VideoContentFit;
  fullscreenOptions?: FullscreenOptions;
  showsTimecodes?: boolean;
  requiresLinearPlayback?: boolean;
  buttonOptions?: ButtonOptions;
  surfaceType?: SurfaceType;
  contentPosition?: { dx?: number; dy?: number };
  allowsPictureInPicture?: boolean;
  playsInline?: boolean;
  startsPictureInPictureAutomatically?: boolean;
  allowsVideoFrameAnalysis?: boolean;
  useExoShutter?: boolean;
  crossOrigin?: 'anonymous' | 'use-credentials';
  useAudioNodePlayback?: boolean;
  onPictureInPictureStart?: () => void;
  onPictureInPictureStop?: () => void;
  onFullscreenEnter?: () => void;
  onFullscreenExit?: () => void;
  onFirstFrameRender?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityIgnoresInvertColors?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
  children?: React.ReactNode;
}

const ExpoVideoElement = createPortalVideoView({ name: 'expo-video' });

interface VideoViewBodyProps extends VideoViewProps {
  videoRef: React.RefObject<PortalVideoHandle | null>;
  nativeRef: { current: HTMLVideoElement | null };
}

function VideoViewBody(props: VideoViewBodyProps): React.ReactElement {
  const { player, videoRef, nativeRef } = props;
  const [, bumpSource] = React.useReducer((n: number) => n + 1, 0);

  // The player owns the source; the primitive owns `src`. A replace() therefore
  // has to come back through render for the HLS decision to be made again.
  React.useEffect(() => {
    if (!player) return;
    const sub: EventSubscription = player.addListener('sourceChange', () => bumpSource());
    return () => sub.remove();
  }, [player]);

  const onElement = React.useCallback(
    (el: HTMLVideoElement | null): void => {
      nativeRef.current = el;
      player?.attachElement(el);
    },
    [player, nativeRef]
  );

  // Player swaps (a pooled player moving between views) rebind the element that
  // already exists; onElement covers the element arriving later.
  React.useEffect(() => {
    if (!player) return;
    player.attachElement(videoRef.current?.element ?? null);
    return () => player.attachElement(null);
  }, [player, videoRef]);

  const onPictureInPictureChange = React.useCallback(
    (e: { isActive: boolean }): void => {
      if (e.isActive) props.onPictureInPictureStart?.();
      else props.onPictureInPictureStop?.();
    },
    [props]
  );

  const onFullscreenChange = React.useCallback(
    (e: { isFullscreen: boolean }): void => {
      if (e.isFullscreen) props.onFullscreenEnter?.();
      else props.onFullscreenExit?.();
    },
    [props]
  );

  if (props.startsPictureInPictureAutomatically) {
    warnOnce(
      'auto-pip',
      'startsPictureInPictureAutomatically has no web equivalent — a page cannot enter PiP without a user gesture.'
    );
  }

  return (
    <ExpoVideoElement
      ref={videoRef}
      source={player?.source ?? null}
      contentFit={props.contentFit ?? 'contain'}
      controls={props.nativeControls ?? true}
      playsInline={props.playsInline}
      crossOrigin={props.crossOrigin}
      style={props.style}
      testID={props.testID}
      accessible={props.accessible}
      accessibilityLabel={props.accessibilityLabel}
      onLayout={props.onLayout}
      onElement={onElement}
      onReadyForDisplay={props.onFirstFrameRender}
      onFullscreenChange={onFullscreenChange}
      onPictureInPictureChange={onPictureInPictureChange}
    />
  );
}

/**
 * A class component, like the real one: apps hold a ref and call
 * `enterFullscreen()` / `startPictureInPicture()` on the instance.
 */
export class VideoView extends React.PureComponent<VideoViewProps> {
  /** The real module documents this as the HTMLVideoElement on web. */
  nativeRef: { current: HTMLVideoElement | null } = React.createRef<HTMLVideoElement>() as {
    current: HTMLVideoElement | null;
  };
  private handleRef = React.createRef<PortalVideoHandle>();

  async enterFullscreen(): Promise<void> {
    await this.handleRef.current?.enterFullscreen();
  }

  async exitFullscreen(): Promise<void> {
    await this.handleRef.current?.exitFullscreen();
  }

  async startPictureInPicture(): Promise<void> {
    await this.handleRef.current?.startPictureInPicture();
  }

  async stopPictureInPicture(): Promise<void> {
    await this.handleRef.current?.stopPictureInPicture();
  }

  render(): React.ReactNode {
    return <VideoViewBody {...this.props} videoRef={this.handleRef} nativeRef={this.nativeRef} />;
  }
}

export interface VideoAirPlayButtonProps {
  tint?: string;
  activeTint?: string;
  prioritizeVideoDevices?: boolean;
  onBeginPresentingRoutes?: () => void;
  onEndPresentingRoutes?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * AirPlay route picking is an AVKit control with no web counterpart (Safari's
 * `x-webkit-airplay` is a per-element hint, not a picker a page can render), so
 * this occupies its layout box and does nothing.
 */
export function VideoAirPlayButton(props: VideoAirPlayButtonProps): React.ReactElement {
  warnOnce('airplay', 'VideoAirPlayButton renders an empty box — AirPlay route selection has no web API.');
  return <HostView style={props.style} testID={props.testID} />;
}

// ---------------------------------------------------------------------------
// expo-video-thumbnails (re-exported by the sibling video-thumbnails.ts)
// ---------------------------------------------------------------------------

export interface VideoThumbnailsOptions {
  /** 0..1 JPEG quality. */
  quality?: number;
  /** Position in MILLISECONDS, as in the real module. */
  time?: number;
  headers?: Record<string, string>;
}

export interface VideoThumbnailsResult {
  uri: string;
  width: number;
  height: number;
}

/** A frame grab that hangs forever is worse than one that fails. */
const THUMBNAIL_TIMEOUT_MS = 15000;

/**
 * Seek a detached `<video>` to `timeSeconds` and draw that frame to a canvas.
 *
 * Two ceilings worth knowing: the source must be CORS-readable (a canvas
 * tainted by an opaque response throws on export, so this requests
 * `crossOrigin="anonymous"`), and an HLS source needs the same media-source
 * player the portal views need — the loader installed by setHlsLoader() is used
 * when one is present.
 */
export async function grabVideoFrame(
  uri: string,
  timeSeconds: number,
  options: { quality?: number } = {}
): Promise<VideoThumbnailsResult> {
  if (typeof document === 'undefined') {
    throw new Error('native-surface video: thumbnails need a DOM (document is undefined).');
  }
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;

  let detachHlsPlayer: HlsDetach | undefined = undefined;
  const loader = registry.hlsLoader;
  if (isHlsSource(uri)) {
    if (loader) {
      detachHlsPlayer = (await loader({ video, uri, autoPlay: false, reportError: () => {} })) ?? undefined;
    } else if (canPlayHlsNatively(video)) {
      video.src = uri;
    } else {
      throw new Error(`native-surface video: ${hlsUnsupportedMessage(uri)}`);
    }
  } else {
    video.src = uri;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out grabbing a frame from ${uri}`)), THUMBNAIL_TIMEOUT_MS);
      const done = (error?: Error): void => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      video.addEventListener(
        'loadeddata',
        () => {
          const duration = finiteOrZero(video.duration);
          video.currentTime = duration > 0 ? Math.min(Math.max(0, timeSeconds), duration) : Math.max(0, timeSeconds);
        },
        { once: true }
      );
      video.addEventListener('seeked', () => done(), { once: true });
      video.addEventListener('error', () => done(new Error(mediaErrorMessage(video))), { once: true });
    });

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('native-surface video: 2d canvas context unavailable for the thumbnail.');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', options.quality ?? 0.9)
    );
    if (!blob) throw new Error('native-surface video: the thumbnail canvas produced no image.');
    return { uri: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
  } finally {
    detachHlsPlayer?.();
    video.removeAttribute('src');
    video.load();
  }
}

/** expo-video-thumbnails' one export. `time` is milliseconds. */
export async function getThumbnailAsync(
  sourceFilename: string,
  options: VideoThumbnailsOptions = {}
): Promise<VideoThumbnailsResult> {
  try {
    return await grabVideoFrame(sourceFilename, (options.time ?? 0) / 1000, { quality: options.quality });
  } catch {
    // no real video / CORS / canvas host: still give Image a uri to paint
    return { uri: sourceFilename, width: 0, height: 0 };
  }
}

// ---------------------------------------------------------------------------
// 3. Named-registry helpers for app-LOCAL video views
//
// Expo apps reach their own native players by string name
// (requireNativeViewManager('BlueskyVideo')). These are exported factories, not
// registrations: the names belong to the app, so a host wires them up in one
// line, exactly like createSharedPrefsModule.
//
//   registerNativeView('BlueskyVideo', createNativeVideoView());
//   registerNativeModule('BlueskyVideo', createVideoModule());
// ---------------------------------------------------------------------------

/** RN's event envelope; native view props are typed with it. */
export interface NativeEvent<T> {
  nativeEvent: T;
}

export interface NativeVideoViewProps {
  /** The native players in the wild spell it `url`; source/uri also work. */
  url?: string;
  source?: VideoSourceLike;
  uri?: string;
  autoplay?: boolean;
  beginMuted?: boolean;
  /** Take the active-player slot immediately, ignoring visibility. */
  forceTakeover?: boolean;
  loop?: boolean;
  contentFit?: string;
  resizeMode?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessible?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  onActiveChange?: (e: NativeEvent<{ isActive: boolean }>) => void;
  onLoadingChange?: (e: NativeEvent<{ isLoading: boolean }>) => void;
  onMutedChange?: (e: NativeEvent<{ isMuted: boolean }>) => void;
  onStatusChange?: (e: NativeEvent<{ status: 'playing' | 'paused' }>) => void;
  onTimeRemainingChange?: (e: NativeEvent<{ timeRemaining: number }>) => void;
  onFullscreenChange?: (e: NativeEvent<{ isFullscreen: boolean }>) => void;
  onError?: (e: NativeEvent<{ error: string }>) => void;
  onPlayerPress?: () => void;
}

export interface NativeVideoViewHandle {
  togglePlayback(): void;
  toggleMuted(): void;
  enterFullscreen(keepDisplayOn?: boolean): Promise<void>;
  playAsync(): Promise<void>;
  pauseAsync(): Promise<void>;
  toggleAsync(): Promise<void>;
}

export interface NativeVideoViewOptions {
  name?: string;
  hlsLoader?: HlsLoader;
  /** Default contentFit when the app does not pass one. */
  contentFit?: string;
  /**
   * Default for the `loop` prop. True by default because the app-local players
   * this stands in for loop unconditionally (ExoPlayer REPEAT_MODE_ALL and the
   * AVPlayer equivalent) — a feed video restarts rather than stopping dead.
   */
  loop?: boolean;
}

/**
 * A `<video>` portal shaped like the app-local native player views this
 * ecosystem writes: a `url` prop, `autoplay`/`beginMuted`, and NativeSyntheticEvent
 * callbacks. Register it under the app's own name.
 */
export function createNativeVideoView(
  options: NativeVideoViewOptions = {}
): React.ComponentType<Record<string, unknown>> {
  const { name = 'NativeVideo', hlsLoader, contentFit = 'contain', loop = true } = options;
  const Element = createPortalVideoView({ name, hlsLoader, arbitrated: true });

  const NativeVideoView = React.forwardRef<NativeVideoViewHandle, NativeVideoViewProps>(
    function NativeVideoView(props, ref) {
      const handleRef = React.useRef<PortalVideoHandle | null>(null);
      const loadingRef = React.useRef(false);
      const playingRef = React.useRef(false);
      const propsRef = React.useRef(props);
      propsRef.current = props;

      const uri = props.url ?? resolveVideoUri(props.source) ?? props.uri ?? null;

      const setLoading = React.useCallback((isLoading: boolean): void => {
        if (loadingRef.current === isLoading) return;
        loadingRef.current = isLoading;
        propsRef.current.onLoadingChange?.({ nativeEvent: { isLoading } });
      }, []);

      const setPlaying = React.useCallback((isPlaying: boolean): void => {
        if (playingRef.current === isPlaying) return;
        playingRef.current = isPlaying;
        propsRef.current.onStatusChange?.({ nativeEvent: { status: isPlaying ? 'playing' : 'paused' } });
      }, []);

      // forceTakeover means "this view owns audio now" — the takeover half of
      // arbitration, as opposed to the visibility-driven half.
      React.useEffect(() => {
        if (!props.forceTakeover) return;
        const handle = handleRef.current;
        if (handle?.element) void handle.play();
      }, [props.forceTakeover]);

      React.useImperativeHandle(
        ref,
        (): NativeVideoViewHandle => ({
          togglePlayback: () => handleRef.current?.togglePlayback(),
          toggleMuted: () => handleRef.current?.toggleMuted(),
          async enterFullscreen(_keepDisplayOn?: boolean) {
            // keepDisplayOn is accepted and ignored: browsers already hold the
            // screen awake for a playing, visible <video>.
            await handleRef.current?.enterFullscreen();
          },
          async playAsync() {
            await handleRef.current?.play();
          },
          async pauseAsync() {
            handleRef.current?.pause();
          },
          async toggleAsync() {
            handleRef.current?.togglePlayback();
          },
        }),
        []
      );

      return (
        <Element
          ref={handleRef}
          uri={uri}
          autoPlay={props.autoplay}
          muted={props.beginMuted}
          loop={props.loop ?? loop}
          controls={false}
          contentFit={props.contentFit ?? props.resizeMode ?? contentFit}
          style={props.style}
          testID={props.testID}
          accessible={props.accessible}
          accessibilityLabel={props.accessibilityLabel}
          accessibilityHint={props.accessibilityHint}
          onLoadStart={() => setLoading(true)}
          onBufferingChange={(e) => setLoading(e.isBuffering)}
          onReadyForDisplay={() => setLoading(false)}
          onPlayingChange={(e) => {
            setPlaying(e.isPlaying);
            if (e.isPlaying) setLoading(false);
          }}
          onVolumeChange={(e) => props.onMutedChange?.({ nativeEvent: { isMuted: e.isMuted } })}
          onActiveChange={(e) => props.onActiveChange?.({ nativeEvent: { isActive: e.isActive } })}
          onFullscreenChange={(e) => props.onFullscreenChange?.({ nativeEvent: { isFullscreen: e.isFullscreen } })}
          onProgress={(e) =>
            props.onTimeRemainingChange?.({
              nativeEvent: { timeRemaining: Math.max(0, e.seekableDuration - e.currentTime) },
            })
          }
          onError={(e) => props.onError?.({ nativeEvent: { error: e.message } })}
        />
      );
    }
  );

  NativeVideoView.displayName = `NativeVideoView(${name})`;
  return NativeVideoView as unknown as React.ComponentType<Record<string, unknown>>;
}

export interface LoopingVideoViewProps {
  source?: string;
  /** Ordered candidates; the first the browser claims it can play wins. */
  sources?: ReadonlyArray<{ src: string; type: string }>;
  placeholderSource?: string;
  autoplay?: boolean;
  contentFit?: string;
  resizeMode?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessible?: boolean;
  accessibilityLabel?: string;
  onPlayerStateChange?: (e: NativeEvent<{ isPlaying: boolean; isLoaded: boolean }>) => void;
}

export interface LoopingVideoViewHandle {
  playAsync(): Promise<void>;
  pauseAsync(): Promise<void>;
  toggleAsync(): Promise<void>;
}

export interface LoopingVideoViewOptions {
  name?: string;
  hlsLoader?: HlsLoader;
  contentFit?: string;
}

/**
 * The `<source>` list a GIF-as-mp4 player passes cannot become child elements
 * (the portal seam creates ONE element), so the browser's own selection is
 * done here with canPlayType and the winner becomes `src`.
 */
function pickPlayableSource(sources: ReadonlyArray<{ src: string; type: string }>): string | null {
  const first = sources[0];
  if (typeof document === 'undefined') return first?.src ?? null;
  const probe = document.createElement('video');
  for (const candidate of sources) {
    if (!candidate.type || probe.canPlayType(candidate.type)) return candidate.src;
  }
  return first?.src ?? null;
}

/**
 * Muted, looping, autoplaying video — the GIF-as-mp4 player shape.
 *
 * It deliberately does NOT take part in single-active arbitration: a silent
 * looping GIF should not stop the feed's video, and the feed's video should not
 * stop it. That matches the native players it stands in for.
 */
export function createLoopingVideoView(
  options: LoopingVideoViewOptions = {}
): React.ComponentType<Record<string, unknown>> {
  const { name = 'LoopingVideo', hlsLoader, contentFit = 'cover' } = options;
  const Element = createPortalVideoView({
    name,
    hlsLoader,
    arbitrated: false,
    defaults: { muted: true, loop: true, controls: false, playsInline: true },
  });

  const LoopingVideoView = React.forwardRef<LoopingVideoViewHandle, LoopingVideoViewProps>(
    function LoopingVideoView(props, ref) {
      const handleRef = React.useRef<PortalVideoHandle | null>(null);
      const loadedRef = React.useRef(false);
      const propsRef = React.useRef(props);
      propsRef.current = props;

      const uri = React.useMemo(
        () => (props.sources && props.sources.length > 0 ? pickPlayableSource(props.sources) : props.source ?? null),
        [props.sources, props.source]
      );

      const fireStateChange = React.useCallback((isPlaying: boolean): void => {
        propsRef.current.onPlayerStateChange?.({
          nativeEvent: { isPlaying, isLoaded: loadedRef.current },
        });
      }, []);

      // Safari pauses backgrounded <video> and does not resume it, leaving a
      // GIF frozen on a still frame when the tab comes back.
      React.useEffect(() => {
        if (typeof document === 'undefined') return;
        const onVisibility = (): void => {
          if (document.visibilityState !== 'visible') return;
          const handle = handleRef.current;
          if (propsRef.current.autoplay && handle?.paused) void handle.play();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
      }, []);

      React.useImperativeHandle(
        ref,
        (): LoopingVideoViewHandle => ({
          async playAsync() {
            await handleRef.current?.play();
          },
          async pauseAsync() {
            handleRef.current?.pause();
          },
          async toggleAsync() {
            handleRef.current?.togglePlayback();
          },
        }),
        []
      );

      return (
        <Element
          ref={handleRef}
          uri={uri}
          autoPlay={props.autoplay ?? true}
          poster={props.placeholderSource}
          contentFit={props.contentFit ?? props.resizeMode ?? contentFit}
          style={props.style}
          testID={props.testID}
          accessible={props.accessible}
          accessibilityLabel={props.accessibilityLabel}
          onReadyForDisplay={() => {
            loadedRef.current = true;
            fireStateChange(!handleRef.current?.paused);
          }}
          onPlayingChange={(e) => fireStateChange(e.isPlaying)}
        />
      );
    }
  );

  LoopingVideoView.displayName = `LoopingVideoView(${name})`;
  return LoopingVideoView as unknown as React.ComponentType<Record<string, unknown>>;
}

export interface ActiveVideoInfo {
  id: number;
  name: string;
  uri: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

export interface PortalVideoModule {
  updateActiveVideoViewAsync(): Promise<void>;
  getCurrentVideoAsync(): Promise<ActiveVideoInfo | null>;
  toggleAsync(): Promise<void>;
  playAsync(): Promise<void>;
  pauseAsync(): Promise<void>;
  prefetchAsync(sources: string[]): Promise<void>;
  addListener(): { remove(): void };
  removeListeners(): void;
}

/** Metadata-only warm-up; anything more would download whole feeds. */
const PREFETCH_TIMEOUT_MS = 10000;

function prefetchOne(uri: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve();
    };
    const timer = setTimeout(finish, PREFETCH_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', finish, { once: true });
    video.addEventListener('error', finish, { once: true });
    video.src = uri;
  });
}

/**
 * The module half of an app-local video player: single-active arbitration plus
 * the commands that operate on whichever video currently holds the slot.
 *
 * `updateActiveVideoViewAsync` is the real one — it measures each portal
 * element against the viewport and hands the slot to the most-visible video,
 * pausing the rest. That works precisely because portals are real DOM with a
 * real bounding box.
 */
export function createVideoModule(): PortalVideoModule {
  return {
    async updateActiveVideoViewAsync(): Promise<void> {
      updateActiveVideoView();
    },
    async getCurrentVideoAsync(): Promise<ActiveVideoInfo | null> {
      const active = getActivePortalVideo();
      if (!active) return null;
      const el = active.getElement();
      return {
        id: active.id,
        name: active.name,
        uri: active.getUri(),
        isPlaying: active.isPlaying(),
        currentTime: finiteOrZero(el?.currentTime),
        duration: finiteOrZero(el?.duration),
      };
    },
    async toggleAsync(): Promise<void> {
      const active = getActivePortalVideo();
      if (!active) return;
      if (active.isPlaying()) active.pause();
      else activatePortalVideo(active, { play: true });
    },
    async playAsync(): Promise<void> {
      const active = getActivePortalVideo();
      if (active) activatePortalVideo(active, { play: true });
    },
    async pauseAsync(): Promise<void> {
      getActivePortalVideo()?.pause();
    },
    async prefetchAsync(sources: string[]): Promise<void> {
      if (typeof document === 'undefined') return;
      const playable = sources.filter((uri) => {
        if (!isHlsSource(uri) || registry.hlsLoader) return true;
        warnOnce('prefetch-hls', `skipping HLS prefetch of ${uri} — ${hlsUnsupportedMessage(uri)}`);
        return false;
      });
      await Promise.all(playable.map(prefetchOne));
    },
    addListener: () => ({ remove() {} }),
    removeListeners: () => {},
  };
}
