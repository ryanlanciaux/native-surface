import { useLayoutEffect, useRef, type RefObject } from 'react';
import { clamp01 } from './timeline';

/** Stack y (design px) of the fused phone's centre: COLLAPSE_TOP + 490. */
const FLAT_CENTRE = 338;
/** Half the fused phone's height on the stage (704 · FLAT_SCALE / 2). */
const FLAT_HALF = 289;

/**
 * Drives `apply(p)` from the scroll position alone (no tweening, so the view
 * never rests mid-state and scrolling back reverses it):
 *
 * - p = 0 once the fused phone is mostly on screen (its top 70 % showing),
 * - p = 1 by the time the stage is in view: centred in the viewport when it
 *   fits, else with its bottom edge (the device frame's callout) on the
 *   viewport bottom; its top callouts have drawn on the way there.
 *
 * The span is at least 30 % of the viewport so it never feels like a snap.
 * Reduced motion pins p at 1. Geometry is measured on resize / reflow only;
 * scrolling just reads `scrollY`, so frames never force layout.
 *
 * `stage` is the scaled 1440-wide stack; `viewport` the box clipping it.
 */
export function useExplodeScroll(
  stage: RefObject<HTMLElement | null>,
  viewport: RefObject<HTMLElement | null>,
  apply: (p: number) => void,
) {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useLayoutEffect(() => {
    const stageEl = stage.current;
    const viewportEl = viewport.current;
    if (!stageEl || !viewportEl) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    // Scroll offsets (document px) where p = 0 and p = 1.
    let start = 0;
    let end = 1;
    let last = -1;
    let raf = 0;

    const measure = () => {
      const vh = window.innerHeight;
      const s = stageEl.getBoundingClientRect();
      const v = viewportEl.getBoundingClientRect();
      const scale = s.width / 1440;
      const top = s.top + window.scrollY; // stage top, document px
      const height = v.bottom - s.top; // visible stage below its top
      const endTop = Math.min(vh - height, (vh - height) / 2);
      let startTop = vh - (FLAT_CENTRE + 0.4 * FLAT_HALF) * scale;
      startTop = Math.max(startTop, endTop + 0.3 * vh);
      start = top - startTop;
      end = top - endTop;
      // Read by the verification scripts (scripts/site, work/shots/exploded).
      (stageEl as HTMLElement & { explodeRange?: [number, number] }).explodeRange = [start, end];
    };
    const update = () => {
      raf = 0;
      const p = reduced.matches ? 1 : clamp01((window.scrollY - start) / (end - start));
      if (p === last) return;
      last = p;
      applyRef.current(p);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const remeasure = () => {
      measure();
      last = -1;
      schedule();
    };

    measure();
    update();
    const ro = new ResizeObserver(remeasure);
    ro.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', remeasure);
    reduced.addEventListener('change', remeasure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', remeasure);
      reduced.removeEventListener('change', remeasure);
    };
  }, [stage, viewport]);
}
