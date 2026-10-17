import { NativeSurface } from 'native-surface';
import type { NativeRoot, NativeSurfaceProps } from 'native-surface';
import { loadIgniteFonts } from 'ignite-demo';
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type Ref } from 'react';
import { applyHomography, solveHomography, type Pt } from './homography';

// Start CanvasKit + Space Grotesk as soon as any live slot module loads, so
// the first surface paints with the right metrics and no second font pass.
void loadIgniteFonts().catch(() => {});

/**
 * Browsers cap live WebGL contexts (Chromium drops the oldest past 16), and
 * every surface is one context. The budget is the page's total: the section
 * backgrounds' ShaderCanvas contexts (hero, exploded, playground, CTA) are
 * always live, so surfaces get the rest. Past it a surface waits for another
 * to unmount instead of knocking out a visible one (or a shader).
 */
const MAX_CONTEXTS = 16;
const SHADER_CONTEXTS = 4;
const MAX_SURFACES = MAX_CONTEXTS - SHADER_CONTEXTS;
let liveCount = 0;
const waiters = new Set<() => void>();

function useSurfaceSlot(wanted: boolean): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!wanted) return;
    let held = false;
    const tryAcquire = () => {
      if (held || liveCount >= MAX_SURFACES) return;
      held = true;
      liveCount++;
      waiters.delete(tryAcquire);
      setGranted(true);
    };
    tryAcquire();
    if (!held) waiters.add(tryAcquire);
    return () => {
      waiters.delete(tryAcquire);
      if (!held) return;
      liveCount--;
      setGranted(false);
      for (const w of [...waiters]) w();
    };
  }, [wanted]);
  return granted;
}

/** Sticky "has been near the viewport": a mounted surface keeps its app state. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>, eager: boolean, rootMargin: string) {
  const [near, setNear] = useState(eager);
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near, rootMargin]);
  return near;
}

const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

/**
 * Re-targets pointer input for a canvas inside CSS 3D transforms.
 *
 * The engine maps `clientX/Y` through the canvas's `getBoundingClientRect()`,
 * which under perspective/rotation is the bounding box of the projected quad,
 * so taps land off target. The browser itself hit-tests transformed elements
 * correctly; this measures where the four corners of the surface actually are
 * on screen (zero-cost probes in the same plane), inverts that homography to
 * get the true local point, and re-dispatches the event to the canvas with
 * client coordinates the engine's bounding-box math turns back into exactly
 * that point. Flat, scaled or untransformed surfaces map to themselves.
 */
function usePerspectivePointer(
  wrapRef: React.RefObject<HTMLDivElement | null>,
  width: number,
  height: number,
  wheel: boolean,
) {
  const size = useRef({ width, height });
  size.current = { width, height };
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const synthetic = new WeakSet<Event>();
    const probes = [...wrap.querySelectorAll<HTMLElement>(':scope > [data-probe]')];

    const toLocal = (x: number, y: number): [number, number] | null => {
      const { width: w, height: h } = size.current;
      const screen = probes.map((p): Pt => {
        const r = p.getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      });
      const local: Pt[] = [
        [0.5, 0.5],
        [w - 0.5, 0.5],
        [w - 0.5, h - 0.5],
        [0.5, h - 0.5],
      ];
      const H = solveHomography(screen, local);
      return H ? applyHomography(H, [x, y]) : null;
    };

    const forward = (e: Event) => {
      if (synthetic.has(e)) return;
      const canvas = wrap.querySelector('canvas');
      if (!canvas) return;
      const src = e as PointerEvent | WheelEvent;
      const local = toLocal(src.clientX, src.clientY);
      if (!local) return;
      const { width: w, height: h } = size.current;
      const rect = canvas.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: rect.left + (local[0] * rect.width) / w,
        clientY: rect.top + (local[1] * rect.height) / h,
        screenX: src.screenX,
        screenY: src.screenY,
        button: src.button,
        buttons: src.buttons,
        ctrlKey: src.ctrlKey,
        shiftKey: src.shiftKey,
        altKey: src.altKey,
        metaKey: src.metaKey,
      };
      let next: Event;
      if (e.type === 'wheel') {
        const we = e as WheelEvent;
        next = new WheelEvent('wheel', { ...init, deltaX: we.deltaX, deltaY: we.deltaY, deltaMode: we.deltaMode });
      } else {
        const pe = e as PointerEvent;
        next = new PointerEvent(e.type, {
          ...init,
          pointerId: pe.pointerId,
          pointerType: pe.pointerType,
          isPrimary: pe.isPrimary,
          pressure: pe.pressure,
          width: pe.width,
          height: pe.height,
        });
      }
      e.stopPropagation();
      // The engine cancels these on its own listener; the copy it receives is
      // synthetic, so the original has to be cancelled here (no text
      // selection on press, no page scroll under a wheel over the app).
      if (e.type === 'pointerdown' || e.type === 'wheel') e.preventDefault();
      synthetic.add(next);
      canvas.dispatchEvent(next);
    };

    // Surfaces with nothing to scroll let the wheel through to the page: stop
    // it short of the canvas (whose listener cancels it) but don't cancel it.
    const passWheel = (e: Event) => e.stopPropagation();
    const onWheel = wheel ? forward : passWheel;

    for (const t of POINTER_EVENTS) wrap.addEventListener(t, forward, { capture: true });
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: !wheel });
    return () => {
      for (const t of POINTER_EVENTS) wrap.removeEventListener(t, forward, { capture: true });
      wrap.removeEventListener('wheel', onWheel, { capture: true });
    };
  }, [wrapRef, wheel]);
}

/**
 * Frees the surface's WebGL context when its canvas goes away. CanvasKit's
 * `surface.delete()` keeps the context, which then counts against the
 * browser's cap until GC, so remounts would evict live contexts. Rendered
 * after the NativeSurface so this cleanup runs after the engine's teardown.
 */
function ReleaseContextOnUnmount({ wrapRef }: { wrapRef: React.RefObject<HTMLDivElement | null> }) {
  useEffect(() => {
    const canvas = wrapRef.current?.querySelector('canvas');
    return () => {
      // Still attached = StrictMode's dev remount reusing this canvas.
      if (!canvas || canvas.isConnected) return;
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [wrapRef]);
  return null;
}

const PROBE: CSSProperties = { position: 'absolute', width: 1, height: 1, visibility: 'hidden', pointerEvents: 'none' };

export interface LiveSurfaceProps {
  width: number;
  height: number;
  children: ReactElement;
  /** Mount right away instead of when the box nears the viewport. */
  eager?: boolean;
  rootMargin?: string;
  /** Pointer input reaches the app (default true). */
  interactive?: boolean;
  /** The wheel scrolls the app (default true); false lets it scroll the page. */
  wheel?: boolean;
  dpr?: number;
  safeAreaInsets?: NativeSurfaceProps['safeAreaInsets'];
  onReady?: (root: NativeRoot) => void;
  rootRef?: Ref<NativeRoot>;
  className?: string;
  /** Wrapper box (the canvas fills it at width × height). */
  style?: CSSProperties;
  canvasStyle?: CSSProperties;
  /** Shown until the surface has painted (e.g. a DOM stand-in). */
  fallback?: ReactElement | null;
}

/** Device pixel ratio for surfaces; at least 2 so scaled-up 3D planes stay crisp. */
export const SURFACE_DPR = typeof devicePixelRatio === 'number' ? Math.min(3, Math.max(2, devicePixelRatio)) : 2;

/**
 * A live native-surface canvas for the landing page: lazily mounted, capped
 * against the WebGL context limit, and with pointer input that stays correct
 * under the page's CSS 3D transforms.
 */
export function LiveSurface({
  width,
  height,
  children,
  eager = false,
  rootMargin = '400px',
  interactive = true,
  wheel = true,
  dpr = SURFACE_DPR,
  safeAreaInsets,
  onReady,
  rootRef,
  className,
  style,
  canvasStyle,
  fallback = null,
}: LiveSurfaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(wrapRef, eager, rootMargin);
  const granted = useSurfaceSlot(near);
  const [painted, setPainted] = useState(false);
  usePerspectivePointer(wrapRef, width, height, wheel);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // Stable identity: NativeSurface keeps the first onReady anyway, and this
  // lets the caller pass an inline function.
  const handleReady = useRef((root: NativeRoot) => {
    setPainted(true);
    onReadyRef.current?.(root);
  }).current;

  return (
    <div
      ref={wrapRef}
      className={className}
      data-live-surface={granted ? (painted ? 'painted' : 'mounted') : 'pending'}
      style={{ position: 'relative', width, height, pointerEvents: interactive ? 'auto' : 'none', ...style }}
    >
      <span data-probe style={{ ...PROBE, left: 0, top: 0 }} />
      <span data-probe style={{ ...PROBE, left: width - 1, top: 0 }} />
      <span data-probe style={{ ...PROBE, left: width - 1, top: height - 1 }} />
      <span data-probe style={{ ...PROBE, left: 0, top: height - 1 }} />
      {!painted && fallback}
      {granted && (
        <>
          <NativeSurface
            width={width}
            height={height}
            dpr={dpr}
            safeAreaInsets={safeAreaInsets}
            onReady={handleReady}
            rootRef={rootRef}
            style={{ position: 'absolute', left: 0, top: 0, ...canvasStyle }}
          >
            {children}
          </NativeSurface>
          <ReleaseContextOnUnmount wrapRef={wrapRef} />
        </>
      )}
    </div>
  );
}
