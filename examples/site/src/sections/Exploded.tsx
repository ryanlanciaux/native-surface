import { useRef } from 'react';
import { Extrusion } from '../components/Extrusion';
import { COLLAPSE_TOP, FLAT_SCALE, calloutAt, calloutParts, explodeAt, lerp, tiltAt } from '../exploded/timeline';
import { useExplodeScroll } from '../exploded/useExplodeScroll';
import { ExplodedLayersSlot } from '../live/ExplodedLayersSlot';
import { glossGradient, perspectiveTransform } from '../shaders';
import { CALLOUTS, FRAME, GLASS, LAYERS, PLANE, POSE, type Callout, type LayerSpec } from './exploded/layers';
import './exploded.css';

const pose = perspectiveTransform(POSE, FRAME);
/**
 * Explode order, top plane first (LAYERS runs device → heading): the page
 * scrolls up, so the top of the stack is on screen first and its callouts
 * draw while they can be seen.
 */
const ORDER = new Map(LAYERS.map((l, i) => [l.id, LAYERS.length - 1 - i]));
const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]));

export function Exploded() {
  const trackRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  useExplodeScroll(stackRef, viewportRef, trackRef, (p) => paint(stackRef.current, p));

  return (
    <section className="exploded" aria-labelledby="exploded-title">
      <header className="exploded__header">
        <p className="eyebrow">{'02  ·  TAKE IT APART'}</p>
        <h2 className="section-title exploded__title" id="exploded-title">
          Every screen is just components.
        </h2>
        <p className="exploded__body">
          Your app is a series of components. The native-surface playground lets you see each one in isolation, change
          its props, and watch it render live.
        </p>
      </header>

      <div className="stack-track" ref={trackRef}>
        <div className="stack-viewport" ref={viewportRef}>
          <div className="stack" ref={stackRef}>
            {LAYERS.map((layer) => (
              <Layer key={layer.id} layer={layer} />
            ))}
            {CALLOUTS.map((c) => (
              <CalloutGroup key={c.component} callout={c} />
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: the callouts don't fit beside the phone, so the layers are named in a short legend. */}
      <ul className="callout-legend" aria-label="Layers">
        {CALLOUTS.map((c) => (
          <li key={c.component}>
            <code>{c.component}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

const GLASS_BOX = { left: GLASS.x, top: GLASS.y, width: GLASS.width, height: GLASS.height, borderRadius: GLASS.radius };

function Layer({ layer }: { layer: LayerSpec }) {
  return (
    <div className="xl-frame" data-layer={layer.id} style={{ top: layer.top, perspective: pose.perspective }}>
      <div className="xl-space" style={{ transform: pose.transform }}>
        <div
          className={`xl-plane xl-plane--${layer.id}`}
          style={{
            left: PLANE.x,
            top: PLANE.y,
            width: PLANE.width,
            height: PLANE.height,
            borderRadius: PLANE.radius,
            transform: `scale(${PLANE.scale})`,
          }}
        >
          {layer.sheet && <div className="xl-sheet" />}
          {layer.solids.map((s, i) => (
            <div
              key={i}
              className="xl-solid"
              style={{ left: s.x, top: s.y, width: s.width, height: s.height, borderRadius: s.radius }}
            >
              <Extrusion depth={layer.depth} edge={layer.edge} rim="#C4CAD4" radius={s.radius} slices={layer.depth > 10 ? 8 : 4} />
            </div>
          ))}
          {layer.id === 'device' && <div className="xl-glass" style={GLASS_BOX} />}
          {layer.id === 'screen' && (
            <div className="xl-screen" style={GLASS_BOX}>
              <span className="xl-screen__island" />
              <span className="xl-screen__time">9:41</span>
            </div>
          )}
          {layer.id !== 'device' && (
            <ExplodedLayersSlot layer={layer.id} items={layer.items} width={PLANE.width} height={PLANE.height} active />
          )}
          {layer.gloss > 0 && (
            <div
              className="xl-gloss"
              style={{ background: glossGradient(layer.gloss, PLANE.width, PLANE.height, FRAME / PLANE.scale, FRAME / PLANE.scale) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CalloutGroup({ callout: c }: { callout: Callout }) {
  return (
    <div className="callout-group" data-layer={c.layer} data-side={c.side}>
      <div className={`callout callout--${c.side}`} style={{ left: c.x, top: c.y }}>
        <code>{c.component}</code>
        <span>{c.meta}</span>
      </div>
      <span className={`leader leader--${c.side}`} style={{ left: c.leader[0], top: c.leader[1], width: c.leader[2] }} />
      <span className="anchor" style={{ left: c.anchor[0], top: c.anchor[1] }} />
    </div>
  );
}

/**
 * Writes one frame of the timeline straight onto the stack's elements
 * (transform / opacity only, no React render). At p = 1 every inline value
 * is cleared, so the resting state is exactly the static design layout.
 */
function paint(stack: HTMLElement | null, p: number) {
  if (!stack) return;
  const t = tiltAt(p);
  const space =
    t === 1
      ? pose.transform
      : perspectiveTransform(
          { ...POSE, rotX: POSE.rotX * t, rotY: POSE.rotY * t, rotZ: POSE.rotZ * t, scale: lerp(FLAT_SCALE, POSE.scale, t) },
          FRAME,
        ).transform;
  const { frames, callouts } = partsOf(stack);

  for (const f of frames) {
    const e = explodeAt(p, f.order);
    const dy = f.travel * (1 - e);
    f.frame.style.transform = dy === 0 ? '' : `translateY(${dy.toFixed(2)}px)`;
    f.space.style.transform = space;
    // Sheet chrome and the stage-coloured ink only belong to a lifted plane.
    const lifted = e === 1 ? '' : e.toFixed(3);
    const flat = e === 1 ? '' : (1 - e).toFixed(3);
    for (const el of f.lifted) el.style.opacity = lifted;
    for (const el of f.flat) el.style.opacity = flat;
  }

  for (const { order, slideFrom, label, line, dot } of callouts) {
    const c = calloutAt(p, order);
    if (c === 1) {
      for (const el of [label, line, dot]) el.style.opacity = el.style.transform = '';
      continue;
    }
    const k = calloutParts(c);
    label.style.opacity = k.label.toFixed(3);
    label.style.transform = `translateX(${(slideFrom * (1 - k.label)).toFixed(2)}px)`;
    line.style.opacity = k.line > 0 ? '1' : '0';
    line.style.transform = `scaleX(${k.line.toFixed(4)})`;
    dot.style.opacity = k.dotOpacity.toFixed(3);
    dot.style.transform = `scale(${k.dotScale.toFixed(4)})`;
  }
}

/** The elements paint() drives, looked up once per stack (not per frame). */
const parts = new WeakMap<HTMLElement, ReturnType<typeof collectParts>>();
function partsOf(stack: HTMLElement) {
  let p = parts.get(stack);
  if (!p) parts.set(stack, (p = collectParts(stack)));
  return p;
}
function collectParts(stack: HTMLElement) {
  const all = (root: Element, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  return {
    frames: all(stack, '.xl-frame').map((frame) => {
      const layer = LAYER_BY_ID.get(frame.dataset.layer as LayerSpec['id'])!;
      return {
        frame,
        space: frame.firstElementChild as HTMLElement,
        order: ORDER.get(layer.id)!,
        travel: COLLAPSE_TOP - layer.top,
        lifted: all(frame, '.xl-sheet, .xl-ink--lifted'),
        flat: all(frame, '.xl-ink--flat'),
      };
    }),
    callouts: all(stack, '.callout-group').map((group) => ({
      order: ORDER.get(group.dataset.layer as LayerSpec['id'])!,
      // Labels slide in from their leader's side.
      slideFrom: group.dataset.side === 'left' ? 16 : -16,
      label: group.children[0] as HTMLElement,
      line: group.children[1] as HTMLElement,
      dot: group.children[2] as HTMLElement,
    })),
  };
}
