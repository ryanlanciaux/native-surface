import { useEffect, useRef, type CSSProperties } from 'react';
import { ShaderRunner, type ShaderRunnerOptions } from './runner';
import type { UniformOverrides } from './uniforms';

export interface ShaderCanvasProps extends ShaderRunnerOptions {
  source: string;
  uniforms?: UniformOverrides;
  className?: string;
  style?: CSSProperties;
  /** Seconds added to the clock; also the frozen time under reduced motion. */
  timeOffset?: number;
  /** Render once and never animate (static fills such as the dot grid). */
  still?: boolean;
  /** Feed `u_pointer` (uv xy, eased strength z) from the pointer over the parent. */
  pointer?: boolean;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Absolutely-positioned canvas that paints a design shader behind its parent.
 * Animates only while on screen and the tab is visible; under
 * prefers-reduced-motion it paints a single frame.
 */
export function ShaderCanvas({
  source,
  uniforms,
  className,
  style,
  timeOffset = 0,
  still = false,
  pointer = false,
  maxDpr,
  resolutionScale,
}: ShaderCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const uniformsKey = JSON.stringify(uniforms ?? {});

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let runner: ShaderRunner;
    try {
      runner = new ShaderRunner(canvas, source, JSON.parse(uniformsKey), { maxDpr, resolutionScale });
    } catch (err) {
      console.warn('[ShaderCanvas]', err);
      canvas.dataset.failed = 'true';
      return;
    }
    canvas.dataset.ready = 'true';

    let frame = 0;
    let visible = false;
    let animate = !still && !reducedMotion();
    const start = performance.now();
    const now = () => timeOffset + (animate ? (performance.now() - start) / 1000 : 0);

    // Pointer target (uv, origin bottom-left like gl_FragCoord) and an eased strength.
    const ptr = { x: 0.5, y: 0.5, on: 0, k: 0 };
    const paint = () => {
      runner.resize();
      if (pointer) {
        ptr.k += (ptr.on - ptr.k) * 0.08;
        runner.setUniforms({ u_pointer: [ptr.x, ptr.y, ptr.k] });
      }
      runner.draw(now());
    };
    const loop = () => {
      frame = 0;
      if (!visible || !animate) return;
      paint();
      frame = requestAnimationFrame(loop);
    };
    const kick = () => {
      if (frame) return;
      if (animate && visible) frame = requestAnimationFrame(loop);
      else paint();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = !!entry?.isIntersecting;
        if (visible) kick();
      },
      { rootMargin: '100px' },
    );
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      if (!animate || !visible) paint();
    });
    ro.observe(canvas);

    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const onMotion = () => {
      animate = !still && !mq.matches;
      kick();
    };
    mq.addEventListener('change', onMotion);

    const host = pointer ? canvas.parentElement : null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = canvas.getBoundingClientRect();
      ptr.x = (e.clientX - r.left) / r.width;
      ptr.y = 1 - (e.clientY - r.top) / r.height;
      ptr.on = 1;
    };
    const onLeave = () => {
      ptr.on = 0;
    };
    host?.addEventListener('pointermove', onMove, { passive: true });
    host?.addEventListener('pointerleave', onLeave);
    paint();

    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      ro.disconnect();
      mq.removeEventListener('change', onMotion);
      host?.removeEventListener('pointermove', onMove);
      host?.removeEventListener('pointerleave', onLeave);
      runner.dispose();
    };
  }, [source, uniformsKey, timeOffset, still, pointer, maxDpr, resolutionScale]);

  return <canvas ref={ref} className={className} style={style} aria-hidden="true" />;
}
