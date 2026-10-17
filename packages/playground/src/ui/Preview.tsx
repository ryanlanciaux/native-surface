import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { NativeSurface } from 'native-surface';
import type { LayoutNode, NativeRoot } from 'native-surface';
import { View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { composeStory } from '../csf';
import type { StoryEntry } from '../csf';
import { PlaygroundGlobalsContext } from '../globals';
import type { PlaygroundItem } from '../items';
import type { Args, ColorScheme, StoryContext, Theme } from '../story-types';
import type { Viewport } from '../viewports';

/** What a surface slot receives: the embedder renders the canvas (or wraps NativeSurface). */
export interface SurfaceSlotProps {
  /** Logical points; the slot must lay out at exactly this size (no shrinking). */
  width: number;
  height: number;
  dpr: number;
  platform: Theme;
  safeAreaInsets?: { top: number; bottom: number };
  /** Screens scroll with the wheel; components let it scroll the page. */
  wheel: boolean;
  rootRef: (root: NativeRoot | null) => void;
  onReady: (root: NativeRoot) => void;
  onAction: (name: string, payload?: unknown) => void;
  children: ReactElement;
}

export type RenderSurface = (props: SurfaceSlotProps) => ReactNode;

/** The package's own slot: a plain NativeSurface (debug: the shoot driver finds its root). */
export function DefaultSurface(props: SurfaceSlotProps): ReactElement {
  return (
    <NativeSurface
      debug
      className="surface"
      width={props.width}
      height={props.height}
      dpr={props.dpr}
      theme={props.platform}
      safeAreaInsets={props.safeAreaInsets}
      onAction={props.onAction}
      rootRef={props.rootRef}
      onReady={props.onReady}
    >
      {props.children}
    </NativeSurface>
  );
}

export function StoryErrorPanel({ error }: { error: Error }): ReactElement {
  // The import-audit stub's Proxy throws this exact phrase on use — a missing
  // bridge is a known gap, not a broken story, so it gets its own treatment
  // (and a pointer at the Audit tab).
  const notBridged = /has no web bridge yet/.test(error.message);
  return (
    <div className={notBridged ? 'story-error not-bridged' : 'story-error'} role="alert" data-not-bridged={notBridged || undefined}>
      <strong>{notBridged ? 'Not bridged yet' : 'Story failed to render'}</strong>
      <pre>{error.message}</pre>
      {notBridged ? (
        <p className="story-error-hint">
          This story uses a native module without a web bridge in native-surface yet. The Audit tab lists every import
          stubbed this session.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Lives INSIDE the canvas tree: the engine's reconciler reports uncaught
 * errors through its own root (never rethrowing into the DOM tree), so story
 * errors must be caught by a boundary that is itself a canvas-tree component.
 * It renders nothing on error and hands the error to the DOM chrome.
 */
class InnerStoryBoundary extends Component<{ onError: (error: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[playground] story failed to render', error, info.componentStack);
    this.props.onError(error);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

interface DomBoundaryState {
  error: Error | null;
  resetKey: string;
}

/** Catches DOM-side failures (the surface itself, engine load) the same way. */
class PreviewBoundary extends Component<{ resetKey: string; children: ReactNode }, DomBoundaryState> {
  state: DomBoundaryState = { error: null, resetKey: this.props.resetKey };
  static getDerivedStateFromProps(props: { resetKey: string }, state: DomBoundaryState): DomBoundaryState | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }
  static getDerivedStateFromError(error: Error): Partial<DomBoundaryState> {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[playground] preview failed', error, info.componentStack);
  }
  render(): ReactNode {
    return this.state.error ? <StoryErrorPanel error={this.state.error} /> : this.props.children;
  }
}

/** Runs the story's render/decorators (user code) inside the canvas tree, under the boundary. */
function StoryShell({ story, args, context }: { story: StoryEntry; args: Args; context: StoryContext }): ReactElement {
  return composeStory(story, args, context);
}

function storyTree(story: StoryEntry, args: Args, platform: Theme, scheme: ColorScheme, onError: (e: Error) => void): ReactElement {
  const context: StoryContext = {
    id: story.id,
    title: story.title,
    name: story.name,
    args,
    theme: platform,
    globals: { colorScheme: scheme },
  };
  return (
    <PlaygroundGlobalsContext.Provider value={{ colorScheme: scheme }}>
      {/* A chip, entry or platform switch remounts the story (fresh state) and retries after an error. */}
      <InnerStoryBoundary key={`${story.id}:${platform}`} onError={onError}>
        <StoryShell story={story} args={args} context={context} />
      </InnerStoryBoundary>
    </PlaygroundGlobalsContext.Provider>
  );
}

export interface PreviewProps {
  item: PlaygroundItem;
  story: StoryEntry;
  /** Full args, callbacks already bound. Keep identity stable between edits (timing is keyed on it). */
  args: Args;
  device: Viewport;
  scheme: ColorScheme;
  dpr: number;
  /** Canvas sheet behind components, per scheme. */
  sheet: Record<ColorScheme, string>;
  /** Screen padding components lay out inside: they get device width minus twice this. */
  gutter: number;
  renderSurface: RenderSurface;
  onAction: (name: string, payload?: unknown) => void;
  /** This commit → engine reconciled, laid out and painted; plus the painted tree's node count. */
  onRendered?: (info: { ms: number; nodes: number }) => void;
  /** Laid-out size of the component (shadow excluded), or the device size for screens. */
  onSize?: (size: { width: number; height: number }) => void;
  onError?: (error: Error | null) => void;
}

const SHEET_PAD = 16;
/** Widest pad any layout uses (shadow bleed): the component surface fits it on both sides. */
const MAX_PAD = 24;
/** Component surface height; grows (in steps) only for a component taller than this. */
const COMPONENT_HEIGHT = 360;

/**
 * The canvas: the selected story, live on ONE surface for the whole session
 * (a remount per entry would cost a WebGL context each time).
 *
 * The surface also avoids resizing: every resize makes CanvasKit build a new
 * GPU surface. Components share one fixed surface (device content width +
 * shadow room) and a DOM clip shows exactly the component's measured box;
 * only a component ↔ screen switch or a device change resizes it. Screens run
 * at the device's true logical size with its safe-area insets, scaled to fit
 * by a CSS transform on the whole device, fully interactive.
 */
export function Preview(props: PreviewProps): ReactElement {
  const { item, story, args, device, scheme, dpr, sheet, gutter, renderSurface, onAction, onRendered, onSize, onError } = props;
  const layout = item.parameters.layout ?? 'padded';
  const fullscreen = layout === 'fullscreen';
  const transparent = !fullscreen && item.parameters.surface === 'transparent';
  const pad = fullscreen ? 0 : transparent ? Math.min(MAX_PAD, item.parameters.bleed ?? MAX_PAD) : SHEET_PAD;
  const width =
    layout === 'fullwidth' ? device.width : layout === 'padded' ? Math.max(80, device.width - 2 * gutter) : undefined;

  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  // Until the new entry has laid out, keep showing the last box (no flash to a placeholder size).
  const lastBox = useRef({ width: width ?? 120, height: 80 });
  const box = fullscreen ? { width: device.width, height: device.height } : (measured ?? lastBox.current);
  if (!fullscreen && measured) lastBox.current = measured;
  const visible = { width: Math.ceil(box.width + 2 * pad), height: Math.ceil(box.height + 2 * pad) };

  const [componentHeight, setComponentHeight] = useState(COMPONENT_HEIGHT);
  useEffect(() => {
    if (!fullscreen && visible.height > componentHeight) setComponentHeight(Math.ceil(visible.height / 120) * 120);
  }, [fullscreen, visible.height, componentHeight]);
  const surface = fullscreen ? visible : { width: device.width + 2 * MAX_PAD, height: componentHeight };

  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  useEffect(
    () => onSizeRef.current?.({ width: Math.round(box.width), height: Math.round(box.height) }),
    [item, box.width, box.height]
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(hostRef, visible);
  // Browsers without `overflow: clip` fall back to hidden, which focus can scroll: pin it.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const pin = (): void => {
      if (el.scrollTop || el.scrollLeft) el.scrollTo(0, 0);
    };
    el.addEventListener('scroll', pin);
    return () => el.removeEventListener('scroll', pin);
  }, []);

  // "rendered in X ms": from the commit that changed the inputs to the engine
  // having painted them (root.flush resolves after the paint). Passive
  // effects run child-first, so the surface has handed the tree to its root
  // before this measures.
  const rootRef = useRef<NativeRoot | null>(null);
  const engineReadyAt = useRef(0);
  const setRoot = useCallback((root: NativeRoot | null) => {
    rootRef.current = root;
    void root?.whenReady().then(() => {
      engineReadyAt.current = performance.now();
    });
  }, []);
  const t0 = useRef(0);
  const inputs = [item, story, args, device, scheme] as const;
  const last = useRef<readonly unknown[]>([]);
  if (inputs.some((x, i) => x !== last.current[i])) {
    last.current = inputs;
    t0.current = performance.now();
  }
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const report = (root: NativeRoot | null, start: number): void => {
    root?.flush().then(
      () => onRenderedRef.current?.({ ms: performance.now() - start, nodes: countNodes(safeTree(root)) }),
      () => {}
    );
  };
  useEffect(() => {
    report(rootRef.current, t0.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, inputs);

  // A new entry (or a new content width) is measured afresh.
  useLayoutEffect(() => {
    setMeasured(null);
  }, [item, width]);

  const [error, setError] = useState<{ key: string; error: Error } | null>(null);
  const errorKey = `${story.id}:${device.platform}`;
  const activeError = error && error.key === errorKey ? error.error : null;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => onErrorRef.current?.(null), [errorKey]);
  const fail = useCallback(
    (e: Error) => {
      setError({ key: errorKey, error: e });
      onErrorRef.current?.(e);
    },
    [errorKey]
  );

  const tree = storyTree(story, args, device.platform, scheme, fail);
  const content = fullscreen ? (
    tree
  ) : (
    // The whole surface is the sheet; the clip below shows the component's box of it.
    <View style={{ flex: 1, backgroundColor: transparent ? 'transparent' : sheet[scheme] }}>
      <View
        style={{ position: 'absolute', left: pad, top: pad, width, alignItems: layout === 'centered' ? 'flex-start' : 'stretch' }}
        onLayout={(event: LayoutChangeEvent) => {
          const { width: w, height: h } = event.nativeEvent.layout;
          setMeasured((m) => (m && Math.abs(m.width - w) < 0.5 && Math.abs(m.height - h) < 0.5 ? m : { width: w, height: h }));
        }}
      >
        {tree}
      </View>
    </View>
  );

  const radius = fullscreen ? device.radius : transparent ? 0 : 14;
  return (
    <div className="nsp__preview">
      <div
        ref={hostRef}
        className={`nsp-live${transparent ? '' : ' nsp-live--framed'}`}
        style={{
          width: visible.width * scale,
          height: visible.height * scale,
          margin: transparent ? -pad * scale : 0,
          borderRadius: radius * scale,
        }}
      >
        <div
          className="nsp-live__frame"
          style={{ width: surface.width, height: surface.height, transform: scale === 1 ? undefined : `scale(${scale})` }}
        >
          <PreviewBoundary resetKey={errorKey}>
            {renderSurface({
              width: surface.width,
              height: surface.height,
              dpr,
              platform: device.platform,
              // Only scrollable screens capture the wheel; components let the page scroll.
              wheel: fullscreen,
              safeAreaInsets: fullscreen ? device.insets : undefined,
              rootRef: setRoot,
              onReady: (root) => report(root, Math.max(t0.current, engineReadyAt.current)),
              onAction,
              children: content,
            })}
          </PreviewBoundary>
          {fullscreen && <DeviceChrome device={device} scheme={scheme} hidden={args.showStatusBar === false} />}
        </div>
      </div>
      {activeError && <StoryErrorPanel error={activeError} />}
    </div>
  );
}

/** The OS chrome a device draws over the app's safe area: status bar, island, home indicator. */
function DeviceChrome({ device, scheme, hidden }: { device: Viewport; scheme: ColorScheme; hidden: boolean }): ReactElement | null {
  if (hidden || device.chrome === 'none' || device.insets.top === 0) return null;
  return (
    <div className={`nsp-device nsp-device--${device.chrome} nsp-device--${scheme}`} aria-hidden="true">
      <div className="nsp-device__bar" style={{ height: device.insets.top }}>
        <span className="nsp-device__time">9:41</span>
        {device.chrome === 'island' && <span className="nsp-device__island" />}
        <span className="nsp-device__icons">
          <i className="nsp-device__signal" />
          <i className="nsp-device__wifi" />
          <i className="nsp-device__battery" />
        </span>
      </div>
      {device.insets.bottom > 0 && device.chrome !== 'android' && <span className="nsp-device__home" />}
    </div>
  );
}

/**
 * Shoot mode's stage (`native-surface playground shoot`): the story fills a
 * fixed viewport-sized canvas at scale 1, dpr 1, inset by the configured
 * story padding — the canvas element alone is what the driver captures.
 */
export function ShootStage(props: {
  story: StoryEntry;
  args: Args;
  device: Viewport;
  padding: number;
  onAction: (name: string, payload?: unknown) => void;
}): ReactElement {
  const { story, args, device, padding, onAction } = props;
  const [error, setError] = useState<{ id: string; error: Error } | null>(null);
  const active = error && error.id === story.id ? error.error : null;
  return (
    <div className="nsp-shoot" style={{ width: device.width, height: device.height, padding }}>
      {active ? (
        <StoryErrorPanel error={active} />
      ) : (
        <PreviewBoundary resetKey={story.id}>
          <DefaultSurface
            width={Math.max(1, device.width - padding * 2)}
            height={Math.max(1, device.height - padding * 2)}
            dpr={1}
            platform={device.platform}
            wheel
            rootRef={() => {}}
            onReady={() => {}}
            onAction={onAction}
          >
            {storyTree(story, args, device.platform, 'light', (e) => setError({ id: story.id, error: e }))}
          </DefaultSurface>
        </PreviewBoundary>
      )}
    </div>
  );
}

function safeTree(root: NativeRoot): LayoutNode | null {
  try {
    return root.getLayoutTree();
  } catch {
    return null;
  }
}

function countNodes(node: LayoutNode | null): number {
  if (!node) return 0;
  return 1 + node.children.reduce((n, c) => n + countNodes(c), 0);
}

/** Largest scale ≤ 1 at which the box fits the canvas (chips, caption and padding reserved). */
function useFitScale(ref: React.RefObject<HTMLElement | null>, box: { width: number; height: number }): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const canvas = ref.current?.closest<HTMLElement>('.nsp__canvas');
    if (!canvas) return;
    const RESERVED_Y = 26 + 20 + 14 + 20 + 40;
    const fit = (): void => {
      const s = Math.min(1, (canvas.clientWidth - 32) / box.width, (canvas.clientHeight - RESERVED_Y) / box.height);
      setScale(Math.max(0.25, Math.floor(s * 1000) / 1000));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [ref, box.width, box.height]);
  return scale;
}
