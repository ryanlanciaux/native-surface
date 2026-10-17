// Scroll timeline of the exploded view, as pure functions of one progress
// value p ∈ [0, 1] (0 = a flat phone seen face-on, 1 = the design's pose):
//
//   tilt     0 → .38   face-on → perspective3d pose, the layers still fused
//   explode  .14 → .82 layers part along the plane normal, top first,
//                      each on its own eased window, the windows overlapping
//   callouts .44 → 1   each callout draws in as its layer settles
//                      (dot pops, leader draws out of it, label slides in)
//
// Nothing here knows about time: scrolling back runs it in reverse.

/** Face-on scale of the fused phone (the pose itself is 1.22). */
export const FLAT_SCALE = 0.82;
/** Frame top every layer collapses onto (the toggle plane's, mid-stack). */
export const COLLAPSE_TOP = -152;

const TILT = [0, 0.38] as const;
const EXPLODE_START = 0.14;
const EXPLODE_STEP = 0.06;
const EXPLODE_LEN = 0.32;
const CALLOUT_LEAD = 0.02;
const CALLOUT_LEN = 0.2;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

/** Pose blend: 0 face-on, 1 the design's tilt. */
export const tiltAt = (p: number) => easeInOutSine(span(p, TILT[0], TILT[1]));

/** Window of the layer that leaves `order`-th (0 = first out). */
function explodeWindow(order: number): [number, number] {
  const a = EXPLODE_START + EXPLODE_STEP * order;
  return [a, a + EXPLODE_LEN];
}

/** How far the `order`-th layer has travelled from the fused stack (0 → 1). */
export const explodeAt = (p: number, order: number) => easeInOutCubic(span(p, ...explodeWindow(order)));

/** Local progress of the callout of the `order`-th layer. */
export function calloutAt(p: number, order: number) {
  const settle = explodeWindow(order)[1];
  const a = Math.min(settle - CALLOUT_LEAD, 1 - CALLOUT_LEN);
  return span(p, a, a + CALLOUT_LEN);
}

/** One callout's parts at local progress c (all exactly at rest when c = 1). */
export function calloutParts(c: number) {
  return {
    dotOpacity: clamp01(c / 0.15),
    dotScale: easeOutBack(clamp01(c / 0.3)),
    line: easeOutCubic(span(c, 0.12, 0.62)),
    label: easeOutCubic(span(c, 0.45, 1)),
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
