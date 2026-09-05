/**
 * Image compat shim serving TWO aliased packages over one Skia-backed flow:
 *   - expo-image (SDK 57 surface): Image, ImageBackground, useImage, ImageRef
 *     with contentFit, blurhash/thumbhash placeholders (decoded locally and
 *     registered via the engine's putImagePixels), and duration-based
 *     cross-dissolve transitions on the engine's Animated.
 *   - react-native-fast-image: default FastImage mapping its source/resizeMode
 *     shapes and statics onto the same component.
 *
 * Rendering model: a clipping container View (user style, radii clip there)
 * stacks an absolutely-filled placeholder engine Image beneath an absolutely-
 * filled main engine Image; children render above both. Load callbacks ride
 * the engine Image's own onLoad/onError; onLoadStart/onLoadEnd/onDisplay are
 * emulated here (onDisplay ≈ first successful load — the engine exposes no
 * paint signal).
 *
 * Documented approximations:
 *   - contentFit 'scale-down' maps to 'contain' (the engine has no
 *     never-upscale mode); 'none' maps to 'center' (intrinsic scale, but the
 *     engine scales down when the bitmap exceeds the box, like RN 'center').
 *   - contentPosition other than 'center' is ignored (warn-once).
 *   - cachePolicy/priority/recyclingKey are accepted and inert: the browser's
 *     fetch cache governs disk/memory behavior and scheduling.
 *   - clearMemoryCache/clearDiskCache resolve false: the engine's LRU has no
 *     public clear and the HTTP cache is the browser's.
 *   - source.headers are ignored (warn-once): the engine fetches with a plain
 *     fetch(uri).
 *   - The container sizes purely from style/flex (like expo-image, which does
 *     not adopt the bitmap's intrinsic size).
 */
import * as React from 'react';
import {
  Animated,
  Image as EngineImage,
  StyleSheet,
  View,
  initEngine,
  hasImage,
  putImagePixels,
} from 'native-surface';
import type { ColorValue, ImageStyle, StyleProp, ViewStyle } from 'native-surface';
import { base64ToBytes, decodeBlurhash, isBlurhashString, thumbHashToRGBA } from './blurhash';

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`native-surface compat(image): ${message}`);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface ImageSourceObject {
  uri?: string;
  width?: number;
  height?: number;
  scale?: number;
  headers?: Record<string, string>;
  cacheKey?: string;
  blurhash?: string;
  thumbhash?: string;
}

export type ImageSource =
  | string
  | number
  | ImageSourceObject
  | ReadonlyArray<string | number | ImageSourceObject>
  | null;

interface ResolvedSource {
  uri: string;
  width?: number;
  height?: number;
  scale?: number;
}

function resolveSource(source: ImageSource | undefined): ResolvedSource | null {
  if (source == null) return null;
  if (Array.isArray(source)) {
    for (const s of source as ReadonlyArray<string | number | ImageSourceObject>) {
      const r = resolveSource(s);
      if (r) return r; // first usable wins
    }
    return null;
  }
  if (typeof source === 'string') return source ? { uri: source } : null;
  if (typeof source === 'number') {
    // A numeric require() id needs RN's asset registry, which never exists
    // under the vite preset (bundled assets arrive as url-string imports).
    warnOnce(
      'require-id',
      'numeric require() sources cannot be resolved without the RN asset registry; import the asset (vite turns it into a url) instead.'
    );
    return null;
  }
  const obj = source as ImageSourceObject;
  if (obj.headers) warnOnce('headers', 'source.headers is ignored — the engine loads images with a plain fetch(uri).');
  if (!obj.uri) return null;
  return { uri: obj.uri, width: obj.width, height: obj.height, scale: obj.scale };
}

// ---------------------------------------------------------------------------
// contentFit
// ---------------------------------------------------------------------------

export type ImageContentFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
type EngineResizeMode = 'cover' | 'contain' | 'stretch' | 'center';

function fitToResizeMode(fit: ImageContentFit): EngineResizeMode {
  switch (fit) {
    case 'contain':
      return 'contain';
    case 'fill':
      return 'stretch';
    case 'none':
      return 'center';
    case 'scale-down':
      // No never-upscale mode in the engine: 'contain' matches exactly when
      // the bitmap exceeds the box and only over-enlarges smaller bitmaps.
      return 'contain';
    default:
      return 'cover';
  }
}

// ---------------------------------------------------------------------------
// Placeholders (uri | blurhash | thumbhash)
// ---------------------------------------------------------------------------

type PlaceholderSpec =
  | { kind: 'uri'; uri: string }
  | { kind: 'blurhash'; hash: string }
  | { kind: 'thumbhash'; b64: string };

export type ImagePlaceholder =
  | string
  | number
  | ImageSourceObject
  | ReadonlyArray<string | number | ImageSourceObject>
  | null;

function resolvePlaceholder(placeholder: ImagePlaceholder | undefined): PlaceholderSpec | null {
  if (placeholder == null) return null;
  if (Array.isArray(placeholder)) {
    for (const p of placeholder as ReadonlyArray<string | number | ImageSourceObject>) {
      const r = resolvePlaceholder(p);
      if (r) return r;
    }
    return null;
  }
  if (typeof placeholder === 'string') {
    if (placeholder.startsWith('blurhash:')) return { kind: 'blurhash', hash: placeholder.slice('blurhash:'.length) };
    if (placeholder.startsWith('thumbhash:')) return { kind: 'thumbhash', b64: placeholder.slice('thumbhash:'.length) };
    // Bare-string placeholders that look like a blurhash are one (expo docs);
    // anything else is a url/data uri.
    if (isBlurhashString(placeholder)) return { kind: 'blurhash', hash: placeholder };
    return placeholder ? { kind: 'uri', uri: placeholder } : null;
  }
  if (typeof placeholder === 'object') {
    const obj = placeholder as ImageSourceObject;
    if (obj.blurhash) return { kind: 'blurhash', hash: obj.blurhash };
    if (obj.thumbhash) return { kind: 'thumbhash', b64: obj.thumbhash };
  }
  const r = resolveSource(placeholder as ImageSource);
  return r ? { kind: 'uri', uri: r.uri } : null;
}

const BLURHASH_SIZE = 32;

function placeholderCacheKey(spec: PlaceholderSpec): string {
  return spec.kind === 'blurhash'
    ? `blurhash:${spec.hash}@${BLURHASH_SIZE}x${BLURHASH_SIZE}`
    : spec.kind === 'thumbhash'
      ? `thumbhash:${spec.b64}`
      : spec.uri;
}

/**
 * Decodes + registers a hash placeholder's pixels (once per key — hasImage
 * short-circuits repeats) and returns its cache key once the engine can paint
 * it; uri placeholders pass straight through.
 */
function usePlaceholderUri(spec: PlaceholderSpec | null): string | null {
  const key = spec ? placeholderCacheKey(spec) : null;
  const isHash = spec !== null && spec.kind !== 'uri';
  // The key encodes the whole spec, so the effect deps on it alone; the ref
  // just hands the effect the matching spec without retriggering on identity.
  const specRef = useLatest(spec);
  const [readyKey, setReadyKey] = React.useState<string | null>(() => (key && isHash && hasImage(key) ? key : null));
  React.useEffect(() => {
    if (!key || !isHash) return;
    if (hasImage(key)) {
      setReadyKey(key);
      return;
    }
    let live = true;
    // Wait for the engine so the putImagePixels insert is synchronous and the
    // underlay Image cache-hits a loaded entry on mount.
    void initEngine()
      .then(() => {
        if (!live) return;
        const s = specRef.current;
        if (!s || placeholderCacheKey(s) !== key) return;
        if (!hasImage(key)) {
          try {
            if (s.kind === 'blurhash') {
              const pixels = decodeBlurhash(s.hash, BLURHASH_SIZE, BLURHASH_SIZE);
              putImagePixels(key, pixels, BLURHASH_SIZE, BLURHASH_SIZE);
            } else if (s.kind === 'thumbhash') {
              const { w, h, rgba } = thumbHashToRGBA(base64ToBytes(s.b64));
              putImagePixels(key, rgba, w, h);
            }
          } catch (err) {
            warnOnce(`placeholder:${key}`, `failed to decode placeholder ${key}: ${String(err)}`);
            return;
          }
        }
        setReadyKey(key);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key, isHash, specRef]);
  if (spec && spec.kind === 'uri') return spec.uri;
  return readyKey === key ? readyKey : null;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface ImageTransition {
  duration?: number;
  effect?: 'cross-dissolve' | 'flip-from-top' | 'flip-from-right' | 'flip-from-bottom' | 'flip-from-left' | 'curl-up' | 'curl-down' | null;
  timing?: 'ease-in-out' | 'ease-in' | 'ease-out' | 'linear';
}

function transitionDuration(transition: number | ImageTransition | null | undefined): number {
  if (!transition) return 0;
  if (typeof transition === 'number') return Math.max(0, transition);
  if (transition.effect && transition.effect !== 'cross-dissolve')
    warnOnce('transition-effect', `transition effect '${transition.effect}' is not supported; using cross-dissolve.`);
  return Math.max(0, transition.duration ?? 0);
}

// ---------------------------------------------------------------------------
// Events (expo-image shapes)
// ---------------------------------------------------------------------------

export interface ImageLoadEventData {
  cacheType: 'none' | 'disk' | 'memory';
  source: { url: string; width: number; height: number; mediaType: string | null; isAnimated: boolean };
}

export interface ImageErrorEventData {
  error: string;
}

export interface ImageProps {
  source?: ImageSource;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  /** Only 'center' (the default) is supported; anything else warns once. */
  contentPosition?: unknown;
  placeholder?: ImagePlaceholder;
  /** Defaults: 'cover' for hash placeholders, 'scale-down' (≈contain) for uri placeholders. */
  placeholderContentFit?: ImageContentFit;
  transition?: number | ImageTransition | null;
  /** Accepted and inert: the browser's fetch cache governs caching. */
  cachePolicy?: 'none' | 'disk' | 'memory' | 'memory-disk';
  /** Accepted and inert: the browser schedules fetches. */
  priority?: 'low' | 'normal' | 'high';
  /** Accepted and inert: the engine keys its cache by uri already. */
  recyclingKey?: string | null;
  tintColor?: ColorValue;
  /** Applied to the inner image layers (used by ImageBackground). */
  imageStyle?: StyleProp<ImageStyle>;
  onLoad?: (event: ImageLoadEventData) => void;
  onLoadStart?: () => void;
  onLoadEnd?: () => void;
  onError?: (event: ImageErrorEventData) => void;
  /** Approximated as "first successful load" — the engine has no paint signal. */
  onDisplay?: () => void;
  children?: React.ReactNode;
  testID?: string;
  onLayout?: (e: unknown) => void;
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const AnimatedEngineImage = Animated.Image as React.ComponentType<any>;

function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  ref.current = value;
  return ref;
}

export function Image(props: ImageProps): React.JSX.Element {
  const {
    source,
    style,
    contentFit = 'cover',
    contentPosition,
    placeholder,
    placeholderContentFit,
    transition,
    tintColor,
    imageStyle,
    onLoad,
    onLoadStart,
    onLoadEnd,
    onError,
    onDisplay,
    children,
    testID,
    onLayout,
  } = props;

  if (contentPosition !== undefined && contentPosition !== 'center')
    warnOnce('contentPosition', `contentPosition '${String(contentPosition)}' is ignored (only 'center' is supported).`);

  const resolved = resolveSource(source);
  const uri = resolved?.uri ?? null;

  const placeholderSpec = React.useMemo(() => resolvePlaceholder(placeholder), [placeholder]);
  const placeholderUri = usePlaceholderUri(placeholderSpec);
  const placeholderIsHash = placeholderSpec !== null && placeholderSpec.kind !== 'uri';

  const duration = transitionDuration(transition);
  const opacity = React.useRef(new Animated.Value(duration > 0 ? 0 : 1)).current;

  const onLoadRef = useLatest(onLoad);
  const onLoadStartRef = useLatest(onLoadStart);
  const onLoadEndRef = useLatest(onLoadEnd);
  const onErrorRef = useLatest(onError);
  const onDisplayRef = useLatest(onDisplay);

  // Source-change bookkeeping in the render phase so the reset lands before
  // the engine's settle callbacks (which may run on the very next microtask
  // on a cache hit — a passive effect would arrive too late and could stomp
  // an already-started fade). Callbacks fire from a microtask, never within
  // render; the ref-guard keeps StrictMode's double render to one shot.
  const prevUriRef = React.useRef<{ uri: string | null } | null>(null);
  if (prevUriRef.current === null || prevUriRef.current.uri !== uri) {
    const isFirst = prevUriRef.current === null;
    prevUriRef.current = { uri };
    if (!isFirst) opacity.setValue(duration > 0 ? 0 : 1);
    if (uri) queueMicrotask(() => onLoadStartRef.current?.());
  }

  const handleLoad = React.useMemo(() => {
    if (!uri) return undefined;
    const fallbackW = resolved?.width && resolved.width > 0 ? resolved.width : 1;
    const fallbackH = resolved?.height && resolved.height > 0 ? resolved.height : 1;
    return () => {
      if (duration > 0) Animated.timing(opacity, { toValue: 1, duration }).start();
      const fire = (width: number, height: number) => {
        onLoadRef.current?.({
          cacheType: 'none',
          source: { url: uri, width, height, mediaType: null, isAnimated: false },
        });
        onDisplayRef.current?.();
        onLoadEndRef.current?.();
      };
      // Engine onLoad means pixels are in cache; getSize should hit. If it
      // fails/throws, still fire onLoad so callers (Lightbox imageAspect) unhide.
      try {
        EngineImage.getSize(
          uri,
          (width, height) => fire(width > 0 ? width : fallbackW, height > 0 ? height : fallbackH),
          () => fire(fallbackW, fallbackH)
        );
      } catch {
        fire(fallbackW, fallbackH);
      }
    };
  }, [uri, resolved?.width, resolved?.height, duration, opacity, onLoadRef, onDisplayRef, onLoadEndRef]);

  const handleError = React.useMemo(() => {
    return (e: { nativeEvent: { error: string } }) => {
      onErrorRef.current?.({ error: e.nativeEvent.error });
      onLoadEndRef.current?.();
    };
  }, [onErrorRef, onLoadEndRef]);

  const flat = StyleSheet.flatten(style) as Record<string, unknown>;
  const tint = (tintColor ?? flat.tintColor) as ColorValue | undefined;
  const tintStyle = tint !== undefined ? ({ tintColor: tint } as ImageStyle) : null;

  const placeholderResizeMode: EngineResizeMode = placeholderContentFit
    ? fitToResizeMode(placeholderContentFit)
    : placeholderIsHash
      ? 'cover' // a hash is a blur meant to fill the box
      : 'contain'; // expo's placeholderContentFit default 'scale-down' ≈ contain

  return (
    <View
      style={[style as StyleProp<ViewStyle>, { overflow: 'hidden' }]}
      testID={testID}
      onLayout={onLayout as any}
    >
      {placeholderUri ? (
        <EngineImage
          source={{ uri: placeholderUri }}
          resizeMode={placeholderResizeMode}
          style={[StyleSheet.absoluteFill as StyleProp<ImageStyle>, imageStyle]}
        />
      ) : null}
      {uri ? (
        <AnimatedEngineImage
          source={{ uri, scale: resolved?.scale }}
          resizeMode={fitToResizeMode(contentFit)}
          onLoad={handleLoad}
          onError={handleError}
          style={[StyleSheet.absoluteFill, imageStyle, tintStyle, { opacity }]}
        />
      ) : null}
      {children}
    </View>
  );
}

/**
 * expo-image statics. prefetch loads + decodes through the engine cache
 * (which also warms the browser's HTTP cache); the clear* methods resolve
 * false because neither the engine LRU nor the browser cache exposes a clear.
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Image {
  export function prefetch(urls: string | string[], _options?: unknown): Promise<boolean> {
    const list = Array.isArray(urls) ? urls : [urls];
    return Promise.all(list.map((u) => EngineImage.prefetch(u))).then((results) => results.every(Boolean));
  }
  export async function clearMemoryCache(): Promise<boolean> {
    return false;
  }
  export async function clearDiskCache(): Promise<boolean> {
    return false;
  }
  /** SDK 52+ static loader: resolves an ImageRef once the source is decoded. */
  export async function loadAsync(source: ImageSource, _options?: unknown): Promise<ImageRef> {
    const r = resolveSource(source);
    if (!r) throw new Error('expo-image compat: loadAsync got an unusable source');
    return new Promise((resolve, reject) => {
      EngineImage.getSize(
        r.uri,
        (width, height) => resolve(new ImageRef(r.uri, width, height)),
        (err) => reject(err instanceof Error ? err : new Error(String(err)))
      );
    });
  }
}

/**
 * Minimal stand-in for expo-image's shared-object ImageRef: wraps a uri plus
 * decoded dimensions. Our Image accepts it as a source (it has a `uri`).
 * The native handle/scale/mediaType surface does not apply here.
 */
export class ImageRef {
  readonly mediaType: string | null = null;
  readonly scale = 1;
  readonly isAnimated = false;
  constructor(
    readonly uri: string,
    readonly width = 0,
    readonly height = 0
  ) {}
  release(): void {}
}

/**
 * expo-image's useImage: loads the source through the engine cache and
 * returns an ImageRef (null while loading / on failure). `deps` retriggers
 * like the upstream API.
 */
export function useImage(
  source: ImageSource,
  options?: { maxWidth?: number; maxHeight?: number; onError?: (error: Error) => void },
  deps: React.DependencyList = []
): ImageRef | null {
  const resolvedUri = resolveSource(source)?.uri ?? null;
  const onErrorRef = useLatest(options?.onError);
  const [ref, setRef] = React.useState<ImageRef | null>(null);
  React.useEffect(() => {
    if (!resolvedUri) {
      setRef(null);
      return;
    }
    let live = true;
    EngineImage.getSize(
      resolvedUri,
      (width, height) => {
        if (live) setRef(new ImageRef(resolvedUri, width, height));
      },
      (err) => {
        if (live) onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      }
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedUri, onErrorRef, ...deps]);
  return ref;
}

/** expo-image's ImageBackground: an Image whose children flow inside it. */
export function ImageBackground(props: ImageProps): React.JSX.Element {
  return <Image {...props} />;
}
export type ImageBackgroundProps = ImageProps;

// ---------------------------------------------------------------------------
// react-native-fast-image
// ---------------------------------------------------------------------------

export interface FastImageSource {
  uri?: string;
  headers?: Record<string, string>;
  priority?: 'low' | 'normal' | 'high';
  cache?: 'immutable' | 'web' | 'cacheOnly';
}

export interface FastImageProps {
  source?: FastImageSource | number;
  defaultSource?: number | string;
  resizeMode?: 'contain' | 'cover' | 'stretch' | 'center';
  style?: StyleProp<ImageStyle>;
  tintColor?: ColorValue;
  onLoadStart?: () => void;
  onLoad?: (event: { nativeEvent: { width: number; height: number } }) => void;
  onError?: () => void;
  onLoadEnd?: () => void;
  /** Inert: fetch exposes no byte-level progress here. */
  onProgress?: (event: { nativeEvent: { loaded: number; total: number } }) => void;
  fallback?: boolean;
  children?: React.ReactNode;
  testID?: string;
}

const fastResizeModeToFit: Record<string, ImageContentFit> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  center: 'none',
};

function FastImageComponent(props: FastImageProps): React.JSX.Element {
  const { source, defaultSource, resizeMode = 'cover', onLoad, onError, onProgress, fallback: _fallback, ...rest } = props;
  if (onProgress) warnOnce('fast-image-progress', 'FastImage onProgress is not supported (no byte-level fetch progress).');
  return (
    <Image
      {...rest}
      source={source as ImageSource}
      placeholder={defaultSource as ImagePlaceholder}
      contentFit={fastResizeModeToFit[resizeMode] ?? 'cover'}
      onLoad={onLoad ? (e) => onLoad({ nativeEvent: { width: e.source.width, height: e.source.height } }) : undefined}
      onError={onError ? () => onError() : undefined}
    />
  );
}

const FastImage = Object.assign(FastImageComponent, {
  resizeMode: { contain: 'contain', cover: 'cover', stretch: 'stretch', center: 'center' } as const,
  priority: { low: 'low', normal: 'normal', high: 'high' } as const,
  cacheControl: { immutable: 'immutable', web: 'web', cacheOnly: 'cacheOnly' } as const,
  preload(sources: FastImageSource[]): void {
    for (const s of sources) if (s?.uri) void Image.prefetch(s.uri);
  },
  clearMemoryCache: (): Promise<boolean> => Image.clearMemoryCache(),
  clearDiskCache: (): Promise<boolean> => Image.clearDiskCache(),
});

export { FastImage };
export default FastImage;
