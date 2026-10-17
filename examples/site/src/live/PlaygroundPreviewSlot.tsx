import { colors } from 'ignite-demo';
import type { LayoutNode, NativeRoot } from 'native-surface';
import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { composeStory } from '@native-surface/playground/src/csf';
import { contentWidth, type Device } from '../playground/devices';
import { GlobalsContext, type ColorScheme } from '../playground/globals';
import type { Args, PlaygroundItem, StoryEntry } from '../playground/types';
import { LiveSurface } from './LiveSurface';
import './live.css';

export interface PlaygroundPreviewSlotProps {
  item: PlaygroundItem;
  story: StoryEntry;
  /** Full args, callbacks already bound. Keep identity stable between edits (timing is keyed on it). */
  args: Args;
  device: Device;
  theme: ColorScheme;
  /** This commit → engine reconciled, laid out and painted; plus the painted tree's node count. */
  onRendered?: (info: { ms: number; nodes: number }) => void;
  /** Laid-out size of the component (shadow excluded), or the device size for screens. */
  onSize?: (size: { width: number; height: number }) => void;
  onError?: (error: Error | null) => void;
}

const SHEET = { light: colors.background, dark: '#191015' } as const;
const SHEET_PAD = 16;
/** Widest pad any layout uses (card shadow bleed): the component surface fits it on both sides. */
const MAX_PAD = 24;
/** Component surface height; grows (in steps) only for a component taller than this. */
const COMPONENT_HEIGHT = 360;

/**
 * The playground canvas: the selected story, live on ONE native-surface for
 * the whole session (a remount per entry would cost a WebGL context each
 * time — review B2).
 *
 * The surface also avoids resizing: every resize makes CanvasKit build a new
 * GPU surface (≈1.7 s on SwiftShader). Components share one fixed surface,
 * device content width + shadow room, and a DOM clip shows exactly the
 * component's measured box; only a component ↔ screen switch or a device
 * change resizes it. Screens run at the device size with its safe-area
 * insets, scaled to fit, fully interactive.
 */
export function PlaygroundPreviewSlot({ item, story, args, device, theme, onRendered, onSize, onError }: PlaygroundPreviewSlotProps) {
  const layout = item.parameters.layout ?? 'padded';
  const fullscreen = layout === 'fullscreen';
  const transparent = !fullscreen && item.parameters.surface === 'transparent';
  const pad = fullscreen ? 0 : transparent ? Math.min(MAX_PAD, item.parameters.bleed ?? MAX_PAD) : SHEET_PAD;
  const width = layout === 'fullwidth' ? device.width : layout === 'padded' ? contentWidth(device) : undefined;

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
  useEffect(() => onSizeRef.current?.({ width: Math.round(box.width), height: Math.round(box.height) }), [item, box.width, box.height]);

  const hostRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(hostRef, visible);
  // Browsers without `overflow: clip` fall back to hidden, which focus can scroll: pin it.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const pin = () => {
      if (el.scrollTop || el.scrollLeft) el.scrollTo(0, 0);
    };
    el.addEventListener('scroll', pin);
    return () => el.removeEventListener('scroll', pin);
  }, []);

  // "rendered in X ms": from the commit that changed the inputs to the engine
  // having painted them (root.flush resolves after the paint). Passive
  // effects run child-first, so NativeSurface has handed the tree to its
  // root before this measures.
  const rootRef = useRef<NativeRoot | null>(null);
  const engineReadyAt = useRef(0);
  const setRoot = useCallback((root: NativeRoot | null) => {
    rootRef.current = root;
    root?.whenReady().then(() => {
      engineReadyAt.current = performance.now();
    });
  }, []);
  const t0 = useRef(0);
  const inputs = [item, story, args, device, theme] as const;
  const last = useRef<readonly unknown[]>([]);
  if (inputs.some((x, i) => x !== last.current[i])) {
    last.current = inputs;
    t0.current = performance.now();
  }
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const report = (root: NativeRoot | null, start: number) => {
    root?.flush().then(
      () => onRenderedRef.current?.({ ms: performance.now() - start, nodes: countNodes(safeTree(root)) }),
      () => {},
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
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => onErrorRef.current?.(null), [item, story]);

  const context = { id: story.id, title: story.title, name: story.name, args, theme: device.chrome === 'android' ? 'android' : 'ios' } as const;
  const tree = (
    <GlobalsContext.Provider value={{ theme }}>
      <StoryBoundary
        // A chip or entry switch remounts the story (fresh component state) and retries after an error.
        key={story.id}
        onError={(e) => onErrorRef.current?.(e)}
      >
        <ComposedStory story={story} args={args} context={context} />
      </StoryBoundary>
    </GlobalsContext.Provider>
  );

  const content = fullscreen ? (
    tree
  ) : (
    // The whole surface is the sheet; the clip below shows the component's box of it.
    <View style={{ flex: 1, backgroundColor: transparent ? colors.transparent : SHEET[theme] }}>
      <View
        style={{ position: 'absolute', left: pad, top: pad, width, alignItems: layout === 'centered' ? 'flex-start' : 'stretch' }}
        onLayout={(e: LayoutChangeEvent) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          setMeasured((m) => (m && Math.abs(m.width - w) < 0.5 && Math.abs(m.height - h) < 0.5 ? m : { width: w, height: h }));
        }}
      >
        {tree}
      </View>
    </View>
  );

  const radius = fullscreen ? device.radius : transparent ? 0 : 14;
  return (
    <div
      ref={hostRef}
      className={`live-pg${transparent ? '' : ' live-pg--framed'}`}
      style={{
        width: visible.width * scale,
        height: visible.height * scale,
        margin: transparent ? -pad * scale : 0,
        borderRadius: radius * scale,
      }}
    >
      <div className="live-pg__frame" style={{ width: surface.width, height: surface.height, transform: scale === 1 ? undefined : `scale(${scale})` }}>
        <LiveSurface
          width={surface.width}
          height={surface.height}
          rootRef={setRoot}
          // live-fix: one surface for every entry (no key → no new WebGL context);
          // only scrollable screens capture the wheel, components let the page scroll.
          wheel={fullscreen}
          safeAreaInsets={fullscreen ? { top: device.insets.top, bottom: device.insets.bottom } : undefined}
          onReady={(root) => report(root, Math.max(t0.current, engineReadyAt.current))}
        >
          {content}
        </LiveSurface>
        {fullscreen && <DeviceChrome device={device} theme={theme} hidden={args.showStatusBar === true} />}
      </div>
    </div>
  );
}

/** Calls the story's render (user code) inside the canvas tree, so the boundary below catches it. */
function ComposedStory({ story, args, context }: { story: StoryEntry; args: Args; context: Parameters<typeof composeStory>[2] }) {
  return composeStory(story, args, context);
}

/**
 * Lives inside the canvas tree: the engine's reconciler reports render errors
 * through its own root, never into the DOM tree, so the boundary must be a
 * canvas-tree component (as in the playground package's Preview).
 */
class StoryBoundary extends Component<{ onError: (e: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[playground] story failed to render', error, info.componentStack);
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The OS chrome a device draws over the app's safe area: status bar, island, home indicator. */
function DeviceChrome({ device, theme, hidden }: { device: Device; theme: ColorScheme; hidden: boolean }): ReactElement | null {
  if (hidden) return null;
  return (
    <div className={`pg-device pg-device--${device.chrome} pg-device--${theme}`} aria-hidden="true">
      <div className="pg-device__bar" style={{ height: device.insets.top }}>
        <span className="pg-device__time">9:41</span>
        {device.chrome === 'island' && <span className="pg-device__island" />}
        <span className="pg-device__icons">
          <i className="pg-device__signal" />
          <i className="pg-device__wifi" />
          <i className="pg-device__battery" />
        </span>
      </div>
      {device.insets.bottom > 0 && device.chrome !== 'android' && <span className="pg-device__home" />}
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

/** Largest scale ≤ 1 at which the box fits the playground canvas (pills, caption and padding reserved). */
function useFitScale(ref: React.RefObject<HTMLElement | null>, box: { width: number; height: number }) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const canvas = ref.current?.closest<HTMLElement>('.ide__canvas');
    if (!canvas) return;
    const RESERVED_Y = 26 + 20 + 14 + 20 + 40;
    const fit = () => {
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
