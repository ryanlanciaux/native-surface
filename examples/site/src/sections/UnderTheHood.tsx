import { AppWindow, Brush, FileCode, LayoutGrid, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import './under-the-hood.css';

// Claims checked against the repo: layout is yoga-layout 3.x (wasm) with
// Errata.All like RN (packages/native-surface/src/engine/init.ts); paint is
// canvaskit-wasm.
const STEPS: { index: string; title: string; color: string; Icon: LucideIcon }[] = [
  {
    index: '01',
    title: 'Your bundle',
    color: '#22D3EE',
    Icon: FileCode,
  },
  {
    index: '02',
    title: 'Yoga, compiled to wasm',
    color: '#38BDF8',
    Icon: LayoutGrid,
  },
  {
    index: '03',
    title: 'Skia, compiled to wasm',
    color: '#818CF8',
    Icon: Brush,
  },
  {
    index: '04',
    title: 'One <canvas>',
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

/**
 * Sizes the rail (and its travelling spark) from the first to the last step
 * node's centre, measured from layout offsets (unaffected by the nodes' reveal
 * transforms) and kept current with a ResizeObserver, so the line runs through
 * all four icons at every width, horizontal or stacked.
 */
function useRailGeometry(ref: RefObject<HTMLOListElement | null>) {
  useLayoutEffect(() => {
    const ol = ref.current;
    if (!ol) return;
    const center = (node: HTMLElement) => {
      // node → .step (position: relative) → ol (position: relative)
      const step = node.offsetParent as HTMLElement | null;
      const x = node.offsetLeft + (step && step !== ol ? step.offsetLeft : 0) + node.offsetWidth / 2;
      const y = node.offsetTop + (step && step !== ol ? step.offsetTop : 0) + node.offsetHeight / 2;
      return { x, y };
    };
    const measure = () => {
      const nodes = ol.querySelectorAll<HTMLElement>('.step__node');
      if (nodes.length < 2) return;
      const a = center(nodes[0]!);
      const b = center(nodes[nodes.length - 1]!);
      const vertical = getComputedStyle(ol).flexDirection.startsWith('column');
      ol.style.setProperty('--rail-x', `${a.x - (vertical ? 1 : 0)}px`);
      ol.style.setProperty('--rail-y', `${a.y - (vertical ? 0 : 1)}px`);
      ol.style.setProperty('--rail-len', `${Math.max(0, vertical ? b.y - a.y : b.x - a.x)}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ol);
    ol.querySelectorAll('.step').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [ref]);
}

export function UnderTheHood() {
  const { ref, armed, shown } = useReveal<HTMLOListElement>();
  useRailGeometry(ref);
  const pipelineClass = ['pipeline', armed && 'pipeline--armed', shown && 'pipeline--in'].filter(Boolean).join(' ');

  return (
    <section className="uth" aria-labelledby="uth-title">
      <div className="uth__header">
        <div className="uth__title-col">
          <p className="eyebrow">{'02  ·  UNDER THE HOOD'}</p>
          <h2 className="section-title uth__title" id="uth-title">
            The same layout engine. Real Skia pixels.
          </h2>
        </div>
        <p className="uth__body">Laid out by Yoga, painted by Skia, both running in WebAssembly.</p>
      </div>

      <ol className={pipelineClass} ref={ref}>
        <span className="pipeline__rail" aria-hidden="true" />
        <span className="pipeline__head" aria-hidden="true" />
        {STEPS.map(({ index, title, color, Icon }, i) => (
          <li key={index} className="step" style={{ '--c': color, '--i': i } as CSSProperties}>
            <span className="step__node">
              <Icon size={24} strokeWidth={2} color={color} />
            </span>
            <div className="step__text">
              <span className="step__index">{index}</span>
              <h3 className="step__title">{title}</h3>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
