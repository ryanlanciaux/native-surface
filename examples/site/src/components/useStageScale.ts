import { useEffect } from 'react';

/**
 * Publishes `--stage-scale` = min(1, viewport / 1440) on <html>. Sections laid
 * out on the design's absolute 1440 px stage (hero, exploded view) scale by it
 * on laptop widths so they stay pixel-faithful instead of reflowing.
 * `--vw-num` (unitless viewport width) feeds the mobile scale calcs.
 */
export function useStageScale() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--stage-scale', String(Math.min(1, root.clientWidth / 1440)));
      root.style.setProperty('--vw-num', String(root.clientWidth));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
}
