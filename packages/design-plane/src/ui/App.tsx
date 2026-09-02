import { Component, createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';
import { NativeSurface } from 'native-surface';
import type { NativeRoot } from 'native-surface';
import { routes, Wrapper, type PlaneRoute } from 'virtual:design-plane';
import {
  DEFAULT_FRAME,
  fitRect,
  formatEdges,
  frameLive,
  hitPath,
  jumpId,
  layoutGroups,
  worldView,
  zoomAt,
  type HitNode,
} from '../plane';
import { loadStoryCatalog, matchStory, type StoryRef } from '../stories';

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
  if (node.name) rows.push(['component', node.name]);
  if (node.testID) rows.push(['testID', node.testID]);
  if (node.role) rows.push(['role', node.role]);
  if (node.label) rows.push(['label', node.label]);
  if (node.text) rows.push(['text', node.text]);
  if (node.placeholder) rows.push(['placeholder', node.placeholder]);
  if (node.padding) rows.push(['padding', formatEdges(node.padding)]);
  if (node.margin) rows.push(['margin', formatEdges(node.margin)]);
  if (node.gap != null) rows.push(['gap', String(node.gap)]);
  if (node.font) {
    const bits = [
      node.font.family,
      node.font.size != null ? `${node.font.size}px` : null,
      node.font.weight,
      node.font.lineHeight != null ? `lh ${node.font.lineHeight}` : null,
      node.font.color,
    ].filter(Boolean);
    if (bits.length) rows.push(['font', bits.join(' · ')]);
  }
  return rows;
}

export function App(): ReactElement {
  const worldRef = useRef<HTMLDivElement>(null);
  const [inspect, setInspect] = useState(true);
  const [camera, setCamera] = useState<Camera>({ zoom: 0.85, panX: 48, panY: 48 });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<StoryRef[]>([]);
  const [view, setView] = useState({ width: 1200, height: 800 });
  const space = useRef(false);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const didFit = useRef(false);

  useEffect(() => {
    void loadStoryCatalog().then(setCatalog);
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, PlaneRoute[]>();
    for (const route of routes) {
      const key = route.group ?? route.title;
      const list = map.get(key) ?? [];
      list.push(route);
      map.set(key, list);
    }
    return [...map.entries()].map(([title, items]) => ({ title, items }));
  }, []);

  const { frames, boxes } = useMemo(
    () => layoutGroups(groups.map((group) => ({ title: group.title, items: group.items }))),
    [groups]
  );
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const routeIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  const viewport = useMemo(
    () => worldView(camera.panX, camera.panY, camera.zoom, view.width, view.height),
    [camera, view]
  );
  const live = useMemo(() => {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      const frame = frames[index];
      if (frame && frameLive(frame, viewport)) ids.add(item.id);
    });
    return ids;
  }, [items, frames, viewport]);

  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    const measure = (): void => setView({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(
    (index: number) => {
      const frame = frames[index];
      const el = worldRef.current;
      if (!frame || !el) return;
      setCamera(fitRect(frame, el.clientWidth, el.clientHeight, 72));
    },
    [frames]
  );

  const jumpTo = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) fit(index);
    },
    [fit, items]
  );

  useEffect(() => {
    if (didFit.current || !frames[0] || !worldRef.current) return;
    didFit.current = true;
    fit(0);
  }, [fit, frames]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ') {
        if (event.type === 'keydown') event.preventDefault();
        space.current = event.type === 'keydown';
      }
      if (event.type !== 'keydown') return;
      if (event.key === 'i' || event.key === 'I') setInspect((value) => !value);
      if (event.key === '0') fit(0);
      if (event.key === '=' || event.key === '+') {
        setCamera((c) => zoomAt(view.width / 2, view.height / 2, c.panX, c.panY, c.zoom, c.zoom * 1.15));
      }
      if (event.key === '-' || event.key === '_') {
        setCamera((c) => zoomAt(view.width / 2, view.height / 2, c.panX, c.panY, c.zoom, c.zoom / 1.15));
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [fit, view.height, view.width]);

  const pickAt = useCallback((event: PointerEvent | React.PointerEvent, item: PlaneRoute, frameEl: HTMLElement): Selection | null => {
    const canvas = frameEl.querySelector('canvas');
    const root = rootFor(canvas);
    if (!canvas || !root) return null;
    const size = { width: item.width ?? DEFAULT_FRAME.width, height: item.height ?? DEFAULT_FRAME.height };
    const box = canvas.getBoundingClientRect();
    const path = hitPath(
      root.getLayoutTree() as HitNode,
      ((event.clientX - box.left) / box.width) * size.width,
      ((event.clientY - box.top) / box.height) * size.height
    );
    const node = path[path.length - 1];
    return node ? { routeId: item.id, node, path } : null;
  }, []);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!event.shiftKey) return;
      const frameEl = (event.target as Element | null)?.closest?.('[data-plane-frame]');
      if (!(frameEl instanceof HTMLElement)) return;
      const id = frameEl.dataset.planeFrame;
      const item = items.find((entry) => entry.id === id);
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      const picked = pickAt(event, item, frameEl);
      const dest = picked ? jumpId(picked.path, routeIds) : null;
      if (dest && dest !== item.id) jumpTo(dest);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [items, jumpTo, pickAt, routeIds]);

  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = el.getBoundingClientRect();
      const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08;
      setCamera((c) => zoomAt(event.clientX - box.left, event.clientY - box.top, c.panX, c.panY, c.zoom, c.zoom * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button === 1 || (event.button === 0 && (space.current || event.target === event.currentTarget))) {
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

  const onInspect = (event: React.PointerEvent, item: PlaneRoute) => {
    if (!inspect || event.shiftKey || event.button !== 0) return;
    event.stopPropagation();
    const picked = pickAt(event, item, event.currentTarget as HTMLElement);
    if (picked) setSelected(picked);
  };

  const selectedRect = selected?.node ? selected.node.painted ?? selected.node.frame : null;
  const storyHit = selected ? matchStory(selected.node.name, catalog) : null;

  let frameIndex = 0;
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
        <span className="hint">
          {live.size}/{items.length} live · wheel zoom · space-drag · 0 fits first screen
        </span>
        <span className="zoom">{Math.round(camera.zoom * 100)}%</span>
      </header>
      <div className="body">
        <div
          ref={worldRef}
          className="world"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          <div
            className="scene"
            style={{ transform: `translate(${camera.panX}px, ${camera.panY}px) scale(${camera.zoom})` }}
          >
            {items.length === 0 ? (
              <div className="empty">
                No routes. Add <code>.native-surface/plane.tsx</code>
              </div>
            ) : (
              boxes.map((box) => (
                <div key={box.title} className="group-label" style={{ left: box.x, top: box.y }}>
                  {box.title}
                </div>
              ))
            )}
            {groups.flatMap((group) =>
              group.items.map((item) => {
                const index = frameIndex++;
                const frame = frames[index]!;
                const width = item.width ?? DEFAULT_FRAME.width;
                const height = item.height ?? DEFAULT_FRAME.height;
                const err = errors[item.id];
                const mounted = live.has(item.id);
                return (
                  <div
                    key={item.id}
                    className="frame"
                    data-plane-frame={item.id}
                    style={{ left: frame.x, top: frame.y, width: width + 2, height: height + 28 }}
                  >
                    <div className="frame-head">
                      <button type="button" onClick={() => jumpTo(item.id)}>
                        {item.title}
                      </button>
                      <span>
                        {width}×{height}
                        {mounted ? '' : ' · parked'}
                      </span>
                    </div>
                    <div className="frame-body" style={{ width, height }} onPointerDown={(event) => onInspect(event, item)}>
                      {err ? (
                        <pre className="err">{err}</pre>
                      ) : mounted ? (
                        <NativeSurface key={item.id} width={width} height={height} className="surface">
                          <InnerBoundary onError={(error) => setErrors((prev) => ({ ...prev, [item.id]: error.message }))}>
                            <Wrapper route={item}>{createElement(item.component, item.props ?? {})}</Wrapper>
                          </InnerBoundary>
                        </NativeSurface>
                      ) : (
                        <div className="dormant">out of view</div>
                      )}
                      {inspect && mounted ? <div className="hit" /> : null}
                      {mounted && selected?.routeId === item.id && selectedRect ? (
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
          <h2>Screens</h2>
          <nav className="rail">
            {items.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={live.has(item.id) ? 'on' : undefined}
                onClick={() => fit(index)}
              >
                {(item.group ?? item.title) === item.title ? item.title : `${item.group} · ${item.title}`}
              </button>
            ))}
          </nav>
          <h2>Inspector</h2>
          {selected ? (
            <>
              <dl>
                {inspectRows(selected.node).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {storyHit ? (
                <a className="show-story" href={`/#/story/${encodeURIComponent(storyHit.id)}`}>
                  Show {storyHit.group}
                </a>
              ) : null}
            </>
          ) : (
            <p className="muted">{inspect ? 'Click a component.' : 'Turn Inspect on, then click.'}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
