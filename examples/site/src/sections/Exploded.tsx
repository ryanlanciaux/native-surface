import { useEffect, useRef, type CSSProperties } from 'react';
import { Extrusion } from '../components/Extrusion';
import { useOnScreen } from '../components/useOnScreen';
import { ExplodedLayersSlot } from '../live/ExplodedLayersSlot';
import { FILLS, ShaderCanvas, glossGradient, perspectiveTransform } from '../shaders';
import { CALLOUTS, FRAME, LAYERS, PLANE, POSE, type LayerSpec } from './exploded/layers';
import './exploded.css';

const pose = perspectiveTransform(POSE, FRAME);
const DEVICE_TOP = LAYERS[0]!.top;

export function Exploded() {
  const sectionRef = useRef<HTMLElement>(null);
  const active = useOnScreen(sectionRef, '300px');
  useExplodeProgress(sectionRef);

  return (
    <section className="exploded" ref={sectionRef} aria-labelledby="exploded-title">
      <ShaderCanvas className="shader-fill" {...FILLS.exploded} />
      <div className="exploded__top-fade" aria-hidden="true" />

      <header className="exploded__header">
        <p className="eyebrow">{'02  ·  SCROLL TO EXPLODE'}</p>
        <h2 className="section-title exploded__title" id="exploded-title">
          Every component, in isolation.
        </h2>
        <p className="exploded__body">
          Scroll and the phone comes apart into the layers your app is built from. Each one is a live WebAssembly
          module you can render, poke and test on its own.
        </p>
      </header>

      <div className="stack-viewport">
        <div className="stack">
          {LAYERS.map((layer) => (
            <Layer key={layer.id} layer={layer} active={active} />
          ))}
          {CALLOUTS.map((c) => (
            <div key={c.component} className="callout-group">
              <div className={`callout callout--${c.side}`} style={{ left: c.x, top: c.y }}>
                <code>{c.component}</code>
                <span>{c.meta}</span>
              </div>
              <span
                className={`leader leader--${c.side}`}
                style={{ left: c.leader[0], top: c.leader[1], width: c.leader[2] }}
              />
              <span className="anchor" style={{ left: c.anchor[0], top: c.anchor[1] }} />
            </div>
          ))}
        </div>
      </div>

      <ul className="callout-list" aria-label="Layers">
        {CALLOUTS.map((c) => (
          <li key={c.component}>
            <code>{c.component}</code>
            <span>{c.meta}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Layer({ layer, active }: { layer: LayerSpec; active: boolean }) {
  return (
    <div
      className="xl-frame"
      style={{ top: layer.top, perspective: pose.perspective, '--collapse': `${DEVICE_TOP - layer.top}px` } as CSSProperties}
    >
      <div className="xl-space" style={{ transform: pose.transform }}>
        <div className={`xl-plane xl-plane--${layer.id}${layer.sheet ? ' xl-plane--sheet' : ''}`}>
          {layer.solids.map((s, i) => (
            <div
              key={i}
              className="xl-solid"
              style={{ left: s.x, top: s.y, width: s.width, height: s.height, borderRadius: s.radius }}
            >
              <Extrusion depth={layer.depth} edge={layer.edge} rim="#22D3EE" radius={s.radius} slices={layer.depth > 10 ? 8 : 4} />
            </div>
          ))}
          {layer.id === 'device' && <div className="xl-glass" />}
          {layer.id === 'screen' && (
            <div className="xl-screen">
              <span className="xl-screen__island" />
              <span className="xl-screen__time">9:41</span>
            </div>
          )}
          {layer.id !== 'device' && (
            <ExplodedLayersSlot
              layer={layer.id}
              items={layer.items}
              width={PLANE.width}
              height={PLANE.height}
              active={active}
            />
          )}
          {layer.gloss > 0 && (
            <div
              className="xl-gloss"
              style={{ background: glossGradient(layer.gloss, PLANE.width, PLANE.height, FRAME, FRAME) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Scroll-linked explode: `--explode` runs 0 → 1 as the section scrolls up to
 * the viewport top; 1 is the design's pose. Reduced motion pins it at 1.
 */
function useExplodeProgress(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    const update = () => {
      raf = 0;
      if (mq.matches) {
        el.style.setProperty('--explode', '1');
        return;
      }
      const vh = window.innerHeight;
      const top = el.getBoundingClientRect().top;
      const p = Math.min(1, Math.max(0, (vh - top) / (vh * 0.8)));
      const eased = 1 - Math.pow(1 - p, 3);
      el.style.setProperty('--explode', eased.toFixed(4));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    mq.addEventListener('change', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      mq.removeEventListener('change', onScroll);
    };
  }, [ref]);
}
