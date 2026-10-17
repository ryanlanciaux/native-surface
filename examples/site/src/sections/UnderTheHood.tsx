import { AppWindow, Brush, FileCode, LayoutGrid, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './under-the-hood.css';

// Claims checked against the repo: the bundle is built by Vite through the
// native-surface/vite preset (not Metro); layout is yoga-layout 3.x (wasm) with
// Errata.All like RN (packages/native-surface/src/engine/init.ts); paint is
// canvaskit-wasm. The demo app needed three marked edits in app/, so this
// section does not say "unchanged".
const STEPS: { index: string; title: string; body: string; color: string; Icon: LucideIcon }[] = [
  {
    index: '01',
    title: 'Your bundle',
    body: 'Your React Native components and JS, bundled by Vite with a preset that resolves like Metro. The same React tree, the same navigation, the same state.',
    color: '#22D3EE',
    Icon: FileCode,
  },
  {
    index: '02',
    title: 'Yoga, compiled to wasm',
    body: 'yoga-layout, React Native’s own flexbox engine, built to wasm and configured with RN’s errata, so boxes size and place by the same rules as on device.',
    color: '#38BDF8',
    Icon: LayoutGrid,
  },
  {
    index: '03',
    title: 'Skia, compiled to wasm',
    body: 'Paint and text (SkParagraph) through Skia’s CanvasKit build. A pressed state is a repaint.',
    color: '#818CF8',
    Icon: Brush,
  },
  {
    index: '04',
    title: 'One <canvas>',
    body: 'A modern browser tab is the runtime. Deploy the bundle and anyone with the URL can open the app: no install, no simulator.',
    color: '#A78BFA',
    Icon: AppWindow,
  },
];

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * One-shot reveal: the rail draws 01 → 04 and each step follows as the line
 * reaches it. Pure CSS keyframes driven by one class toggle; JS only flips
 * the class when the pipeline is 35% visible. Reduced motion (or no
 * IntersectionObserver) never arms, so the final state renders as is.
 */
function useReveal<T extends Element>() {
  const ref = useRef<T>(null);
  const [armed] = useState(() => typeof IntersectionObserver === 'function' && !prefersReducedMotion());
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!armed || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [armed]);

  return { ref, armed, shown };
}

export function UnderTheHood() {
  const { ref, armed, shown } = useReveal<HTMLOListElement>();
  const pipelineClass = ['pipeline', armed && 'pipeline--armed', shown && 'pipeline--in'].filter(Boolean).join(' ');

  return (
    <section className="uth" aria-labelledby="uth-title">
      <div className="uth__header">
        <div className="uth__title-col">
          <p className="eyebrow">{'03  ·  UNDER THE HOOD'}</p>
          <h2 className="section-title uth__title" id="uth-title">
            The same layout engine. Real Skia pixels.
          </h2>
        </div>
        <p className="uth__body">
          Your JS bundle runs next to Yoga and Skia, both compiled to WebAssembly. Layout comes from Yoga, the
          engine React Native uses on iOS and Android, and the whole app paints through Skia into a single{' '}
          {'<canvas>'}.
        </p>
      </div>

      <ol className={pipelineClass} ref={ref}>
        <span className="pipeline__rail" aria-hidden="true" />
        <span className="pipeline__head" aria-hidden="true" />
        {STEPS.map(({ index, title, body, color, Icon }, i) => (
          <li key={index} className="step" style={{ '--c': color, '--i': i } as CSSProperties}>
            <span className="step__node">
              <Icon size={24} strokeWidth={2} color={color} />
            </span>
            <div className="step__text">
              <span className="step__index">{index}</span>
              <h3 className="step__title">{title}</h3>
              <p className="step__body">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
