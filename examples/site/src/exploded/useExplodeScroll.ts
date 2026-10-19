import { useLayoutEffect, useRef, type RefObject } from 'react';
import { clamp01 } from './timeline';

/** Stack y (design px) of the fused phone's centre: COLLAPSE_TOP + 490. */
const FLAT_CENTRE = 338;
/** Half the fused phone's height on the stage (704 px footprint · FLAT_SCALE / 2). */
const FLAT_HALF = 289;
/** Extra scroll, as a share of the natural range, spent with the stack pinned. */
const HOLD = 0.6;

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
 * On the way, the stack pins (sticky) with the fused phone centred for an
 * extra HOLD share of that span, so the layers part more gradually while it
 * stays put. Reduced motion pins p at 1 and drops the hold. Geometry is
 * measured on resize / reflow only; scrolling just reads `scrollY`, so frames
 * never force layout.
 *
 * `stage` is the scaled 1440-wide stack; `viewport` the sticky box clipping
 * it; `track` its parent, as tall as the viewport plus the hold.
 */
export function useExplodeScroll(
  stage: RefObject<HTMLElement | null>,
  viewport: RefObject<HTMLElement | null>,
  track: RefObject<HTMLElement | null>,
  apply: (p: number) => void,
) {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useLayoutEffect(() => {
    const stageEl = stage.current;
    const viewportEl = viewport.current;
    const trackEl = track.current;
    if (!stageEl || !viewportEl || !trackEl) return;
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
      // Unstuck, the stage's top sits at the track's top (the track never moves with the pin).
      const top = trackEl.getBoundingClientRect().top + window.scrollY + (s.top - v.top);
      const height = v.bottom - s.top; // visible stage below its top
      const endTop = Math.min(vh - height, (vh - height) / 2);
      let startTop = vh - (FLAT_CENTRE + 0.4 * FLAT_HALF) * scale;
      startTop = Math.max(startTop, endTop + 0.3 * vh);
      // Pin with the fused phone centred, inside the natural travel.
      const pinTop = Math.min(startTop, Math.max(endTop, vh / 2 - FLAT_CENTRE * scale));
      const hold = reduced.matches ? 0 : Math.round(HOLD * (startTop - endTop));
      viewportEl.style.top = `${Math.round(pinTop - (s.top - v.top))}px`;
      trackEl.style.height = `${viewportEl.offsetHeight + hold}px`;
      start = top - startTop;
      end = top - endTop + hold;
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
  }, [stage, viewport, track]);
}
