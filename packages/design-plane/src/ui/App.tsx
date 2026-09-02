import { Component, createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { NativeSurface } from 'native-surface';
import type { NativeRoot } from 'native-surface';
import { routes, Wrapper, type PlaneRoute } from 'virtual:design-plane';
import {
  DEFAULT_FRAME,
  fitRect,
  hitPath,
  jumpId,
  layoutFrames,
  zoomAt,
  type HitNode,
} from '../plane';

type Camera = { zoom: number; panX: number; panY: number };
type Selection = { routeId: string; node: HitNode; path: HitNode[] };

function roots(): Set<NativeRoot> {
  return (globalThis as unknown as { __nativeSurfaceRoots?: Set<NativeRoot> }).__nativeSurfaceRoots ?? new Set();
}

function rootFor(canvas: HTMLCanvasElement | null): NativeRoot | null {
  if (!canvas) return null;
  for (const root of roots()) if (root.canvas === canvas) return root;
  return null;
}

class InnerBoundary extends Component<{ onError: (error: Error) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[design-plane] route failed', error, info.componentStack);
    this.props.onError(error);
  }
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function inspectRows(node: HitNode): Array<[string, string]> {
  const r = node.painted ?? node.frame;
  const rows: Array<[string, string]> = [
    ['type', node.type],
    ['frame', `${Math.round(r.x)}, ${Math.round(r.y)}  ${Math.round(r.width)}×${Math.round(r.height)}`],
  ];
  if (node.testID) rows.push(['testID', node.testID]);
  if (node.role) rows.push(['role', node.role]);
  if (node.label) rows.push(['label', node.label]);
  if (node.text) rows.push(['text', node.text]);
  if (node.placeholder) rows.push(['placeholder', node.placeholder]);
  return rows;
}

export function App(): ReactElement {
  const worldRef = useRef<HTMLDivElement>(null);
  const [inspect, setInspect] = useState(true);
  const [camera, setCamera] = useState<Camera>({ zoom: 0.45, panX: 64, panY: 72 });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const space = useRef(false);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const frames = useMemo(() => layoutFrames(routes), []);
  const routeIds = useMemo(() => new Set(routes.map((route) => route.id)), []);

  const fit = useCallback(
    (index: number) => {
      const frame = frames[index];
      const el = worldRef.current;
      if (!frame || !el) return;
      setCamera(fitRect(frame, el.clientWidth, el.clientHeight));
    },
    [frames]
  );

  const jumpTo = useCallback(
    (id: string) => {
      const index = routes.findIndex((route) => route.id === id);
      if (index >= 0) fit(index);
    },
    [fit]
  );

  useEffect(() => {
    const el = worldRef.current;
    if (el && frames[0]) setCamera(fitRect(
      {
        x: 0,
        y: 0,
        width: (frames[frames.length - 1]?.x ?? 0) + (frames[frames.length - 1]?.width ?? 0),
        height: Math.max(...frames.map((f) => f.height), 1),
      },
      el.clientWidth,
      el.clientHeight
    ));
  }, [frames]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        if (event.type === 'keydown') event.preventDefault();
        space.current = event.type === 'keydown';
      }
      if (event.type !== 'keydown') return;
      if (event.key === 'i' || event.key === 'I') setInspect((value) => !value);
      if (event.key === '0') {
        const el = worldRef.current;
        if (el && frames[0]) {
          setCamera(fitRect(
            {
              x: 0,
              y: 0,
              width: (frames[frames.length - 1]?.x ?? 0) + (frames[frames.length - 1]?.width ?? 0),
              height: Math.max(...frames.map((f) => f.height), 1),
            },
            el.clientWidth,
            el.clientHeight
          ));
        }
      }
      if (event.key === '=' || event.key === '+') {
        const el = worldRef.current;
        if (!el) return;
        setCamera((c) => zoomAt(el.clientWidth / 2, el.clientHeight / 2, c.panX, c.panY, c.zoom, c.zoom * 1.15));
      }
      if (event.key === '-' || event.key === '_') {
        const el = worldRef.current;
        if (!el) return;
        setCamera((c) => zoomAt(el.clientWidth / 2, el.clientHeight / 2, c.panX, c.panY, c.zoom, c.zoom / 1.15));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [frames]);

  const pickAt = useCallback(
    (event: PointerEvent | React.PointerEvent, route: PlaneRoute, frameEl: HTMLElement): Selection | null => {
      const canvas = frameEl.querySelector('canvas');
      const root = rootFor(canvas);
      if (!canvas || !root) return null;
      const size = { width: route.width ?? DEFAULT_FRAME.width, height: route.height ?? DEFAULT_FRAME.height };
      const pt = {
        x: ((event.clientX - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width) * size.width,
        y: ((event.clientY - canvas.getBoundingClientRect().top) / canvas.getBoundingClientRect().height) * size.height,
      };
      const path = hitPath(root.getLayoutTree() as HitNode, pt.x, pt.y);
      const node = path[path.length - 1];
      return node ? { routeId: route.id, node, path } : null;
    },
    []
  );

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!event.shiftKey) return;
      const frameEl = (event.target as Element | null)?.closest?.('[data-plane-frame]');
      if (!(frameEl instanceof HTMLElement)) return;
      const id = frameEl.dataset.planeFrame;
      const route = routes.find((item) => item.id === id);
      if (!route) return;
      event.preventDefault();
      event.stopPropagation();
      const picked = pickAt(event, route, frameEl);
      const dest = picked ? jumpId(picked.path, routeIds) : null;
      if (dest && dest !== route.id) jumpTo(dest);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [jumpTo, pickAt, routeIds]);

  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      const sx = event.clientX - box.left;
      const sy = event.clientY - box.top;
      const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08;
      setCamera((c) => zoomAt(sx, sy, c.panX, c.panY, c.zoom, c.zoom * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === 1 || event.button === 0 && (space.current || event.target === event.currentTarget)) {
      drag.current = { x: event.clientX, y: event.clientY, panX: camera.panX, panY: camera.panY };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = drag.current;
    if (!start) return;
    setCamera({
      zoom: camera.zoom,
      panX: start.panX + (event.clientX - start.x),
      panY: start.panY + (event.clientY - start.y),
    });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onInspect = (event: React.PointerEvent, route: PlaneRoute) => {
    if (!inspect || event.shiftKey || event.button !== 0) return;
    event.stopPropagation();
    const frameEl = event.currentTarget as HTMLElement;
    const picked = pickAt(event, route, frameEl);
    if (picked) setSelected(picked);
  };

  const selectedRect = selected?.node ? selected.node.painted ?? selected.node.frame : null;

  return (
    <div className="plane">
      <header className="bar">
        <a className="brand" href="/">
          Stories
        </a>
        <span className="title">Design plane</span>
        <button type="button" className={inspect ? 'chip on' : 'chip'} onClick={() => setInspect((v) => !v)}>
          Inspect {inspect ? 'on' : 'off'}
        </button>
        <span className="hint">wheel zoom · space-drag pan · shift-click jumps · I inspect · 0 fit</span>
        <span className="zoom">{Math.round(camera.zoom * 100)}%</span>
      </header>
      <div className="body">
        <div
          ref={worldRef}
          className="world"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div
            className="scene"
            style={{ transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})` }}
          >
            {routes.length === 0 ? (
              <div className="empty">
                No routes. Add <code>.native-surface/plane.tsx</code> — see @native-surface/design-plane/SKILL.md
              </div>
            ) : (
              routes.map((route, index) => {
                const frame = frames[index]!;
                const width = route.width ?? DEFAULT_FRAME.width;
                const height = route.height ?? DEFAULT_FRAME.height;
                const err = errors[route.id];
                return (
                  <div
                    key={route.id}
                    className="frame"
                    data-plane-frame={route.id}
                    style={{ left: frame.x, top: frame.y, width: width + 2, height: height + 28 }}
                  >
                    <div className="frame-head">
                      <button type="button" onClick={() => fit(index)}>
                        {route.title}
                      </button>
                      <span>{width}×{height}</span>
                    </div>
                    <div
                      className="frame-body"
                      style={{ width, height }}
                      onPointerDown={(event) => onInspect(event, route)}
                    >
                      {err ? (
                        <pre className="err">{err}</pre>
                      ) : (
                        <NativeSurface width={width} height={height} className="surface">
                          <InnerBoundary
                            onError={(error) => setErrors((prev) => ({ ...prev, [route.id]: error.message }))}
                          >
                            <Wrapper route={route}>
                              {createElement(route.component, route.props ?? {})}
                            </Wrapper>
                          </InnerBoundary>
                        </NativeSurface>
                      )}
                      {inspect ? <div className="hit" /> : null}
                      {selected?.routeId === route.id && selectedRect ? (
                        <div
                          className="hl"
                          style={{
                            left: selectedRect.x,
                            top: selectedRect.y,
                            width: selectedRect.width,
                            height: selectedRect.height,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
        <aside className="inspector">
          <h2>Inspector</h2>
          {selected ? (
            <dl>
              {inspectRows(selected.node).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted">{inspect ? 'Click a component.' : 'Turn Inspect on, then click.'}</p>
          )}
          {selected ? (
            <p className="muted">
              Shift-click a node whose testID matches a route id to jump.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
