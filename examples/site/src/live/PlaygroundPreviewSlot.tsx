import { IgniteFontGate, catalogSurfaceSize, colors } from 'ignite-demo';
import type { NativeRoot } from 'native-surface';
import { isValidElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { LiveSurface } from './LiveSurface';
import type { PlaygroundPreviewSlotProps } from './types';
import './live.css';

/**
 * The component under test in the playground canvas: the selected catalog
 * entry, live, with the props the panel holds. The shell owns the window
 * chrome, pills, timing caption, drawer and props panel.
 *
 * Components draw on a transparent surface (the canvas grid shows through,
 * with the card shadow) and size it to their measured layout; screens draw
 * at their device size, scaled down to fit the canvas.
 */
export function PlaygroundPreviewSlot({ entry, props, width, onRendered, onSize }: PlaygroundPreviewSlotProps) {
  const isScreen = entry.kind === 'screen';
  const bleed = isScreen ? 0 : entry.bleed;
  // Cards bring their own surface and shadow and float on the canvas grid, as
  // designed; everything else sits on a sheet of the app background (dark
  // text on the dark grid would be unreadable).
  const sheet = !isScreen && bleed === 0;
  const pad = sheet ? 12 : bleed;
  // Design-width components (272) widen to the preview width (340 in the design).
  const widen = !isScreen && entry.size.width === 272 ? width : null;
  const base = isScreen ? entry.size : { width: widen ?? entry.size.width, height: entry.size.height };
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const box = isScreen ? base : (measured ?? base);
  const surface = { width: Math.ceil(box.width + 2 * pad), height: Math.ceil(box.height + 2 * pad) };

  useEffect(() => setMeasured(null), [entry]);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  useEffect(() => onSizeRef.current?.({ width: Math.round(box.width), height: Math.round(box.height) }), [box.width, box.height]);

  // Fit screens (684 tall) into the canvas.
  const hostRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(hostRef, surface, isScreen);

  // "rendered in X ms": from this commit to the engine having reconciled,
  // laid out and painted it (root.flush resolves after the paint).
  const rootRef = useRef<NativeRoot | null>(null);
  // The first paint is timed from the engine being ready, not from page load.
  const engineReadyAt = useRef(0);
  const setRoot = useCallback((root: NativeRoot | null) => {
    rootRef.current = root;
    root?.whenReady().then(() => {
      engineReadyAt.current = performance.now();
    });
  }, []);
  const t0 = useRef(0);
  const lastInputs = useRef<unknown[]>([]);
  if (lastInputs.current[0] !== entry || lastInputs.current[1] !== props || lastInputs.current[2] !== width) {
    lastInputs.current = [entry, props, width];
    t0.current = performance.now();
  }
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const report = (root: NativeRoot | null, start: number) => {
    root?.flush().then(() => onRenderedRef.current?.({ ms: performance.now() - start }), () => {});
  };
  // Keyed on the inputs, not every render: reporting re-renders the parent.
  useLayoutEffect(() => {
    report(rootRef.current, t0.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, props, width]);

  const element = entry.render(widen ? { ...props, style: { width: widen } } : props);
  const content = isScreen ? element : (
    <IgniteFontGate>
      <View style={{ flex: 1, padding: pad, alignItems: 'flex-start', backgroundColor: sheet ? colors.background : colors.transparent }}>
        <View
          onLayout={(e: LayoutChangeEvent) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            setMeasured((m) => (m && Math.abs(m.width - w) < 0.5 && Math.abs(m.height - h) < 0.5 ? m : { width: w, height: h }));
          }}
        >
          {catalogBody(element)}
        </View>
      </View>
    </IgniteFontGate>
  );

  return (
    <div
      ref={hostRef}
      className="live-pg"
      style={{ width: surface.width * scale, height: surface.height * scale, margin: -bleed }}
    >
      {/* One surface for every entry (no key): switching resizes it and
          re-renders the tree instead of creating another WebGL context. */}
      <LiveSurface
        width={surface.width}
        height={surface.height}
        wheel={isScreen}
        rootRef={setRoot}
        onReady={(root) => report(root, Math.max(t0.current, engineReadyAt.current))}
        style={{ transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: '0 0' }}
        canvasStyle={isScreen ? { borderRadius: 28 } : sheet ? { borderRadius: 12, boxShadow: '0 24px 60px #000000a0' } : undefined}
      >
        {content}
      </LiveSurface>
    </div>
  );
}

/**
 * `entry.render()` is `<Preview>{component}</Preview>`, and Preview paints the
 * app background for the catalog's own gallery. The playground canvas wants
 * the component alone, so take Preview's child (the catalog's live wrapper,
 * taps included); fall back to the whole element if that shape changes.
 */
function catalogBody(element: ReactElement): ReactElement {
  const child = (element.props as { children?: unknown }).children;
  return isValidElement(child) ? child : element;
}

/** Largest scale ≤ 1 at which the box fits the playground canvas. */
function useFitScale(ref: React.RefObject<HTMLElement | null>, box: { width: number; height: number }, enabled: boolean) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const canvas = ref.current?.closest<HTMLElement>('.ide__canvas');
    if (!enabled || !canvas) {
      setScale(1);
      return;
    }
    // Room left for the pills (26 + 24 gap), the caption (14 + 24) and padding.
    const RESERVED_Y = 26 + 24 + 14 + 24 + 32;
    const fit = () => {
      const s = Math.min(1, (canvas.clientWidth - 32) / box.width, (canvas.clientHeight - RESERVED_Y) / box.height);
      setScale(Math.max(0.3, Math.round(s * 1000) / 1000));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [ref, box.width, box.height, enabled]);
  return scale;
}
