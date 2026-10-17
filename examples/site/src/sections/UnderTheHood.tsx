import { AppWindow, Brush, FileCode, LayoutGrid, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import './under-the-hood.css';

const STEPS: { index: string; title: string; body: string; color: string; Icon: LucideIcon }[] = [
  {
    index: '01',
    title: 'Your bundle',
    body: 'Your components and JS, unchanged. The same React tree, the same navigation, the same state.',
    color: '#22D3EE',
    Icon: FileCode,
  },
  {
    index: '02',
    title: 'Yoga → wasm',
    body: 'yoga-layout, React Native’s own flexbox engine, built to wasm with RN’s errata, so boxes size and place by the same rules as on device.',
    color: '#38BDF8',
    Icon: LayoutGrid,
  },
  {
    index: '03',
    title: 'Skia → wasm',
    body: 'Paint and text (SkParagraph) through Skia’s CanvasKit build. A pressed state is a repaint.',
    color: '#818CF8',
    Icon: Brush,
  },
  {
    index: '04',
    title: 'One <canvas>',
    body: 'Any browser, any tab. Share a URL and the app opens, no install and no simulator.',
    color: '#A78BFA',
    Icon: AppWindow,
  },
];

export function UnderTheHood() {
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
          Your JS bundle runs next to Yoga and Skia, both compiled to WebAssembly. Layout comes from the same Yoga
          engine the phone uses, and the whole app paints through Skia into a single {'<canvas>'}.
        </p>
      </div>

      <ol className="pipeline">
        <span className="pipeline__rail" aria-hidden="true" />
        {STEPS.map(({ index, title, body, color, Icon }) => (
          <li key={index} className="step" style={{ '--c': color } as CSSProperties}>
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
