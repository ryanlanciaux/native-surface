import { cubicBezier, type Pose } from './math';
import type { PhoneRig } from './Phone3D';

export const INTRO_MS = 3000;
/** Fraction of the intro at which the phone first touches the ring. */
export const LANDS_AT = 0.66;

/**
 * The design's three-quarter pose (node "Phone 3D", in CSS degrees): the
 * phone touches the ring at this tilt, then turns to face the viewer.
 */
export const LAND_TILT = { rx: -6, ry: 24, rz: 0 } as const;

type Ease = (t: number) => number;
type Frame = { at: number; pose: Pose; ease: Ease; liftEase?: Ease };
const linear: Ease = (t) => t;
// The drop gets on screen fast and brakes into the ring; the spin brakes
// later, so most of the turn (back, walls, buttons) plays in view.
const DROP = cubicBezier(0.22, 0.55, 0.3, 1);
const SPIN = cubicBezier(0.32, 0.3, 0.3, 1);
const SETTLE = cubicBezier(0.45, 0, 0.4, 1);

/**
 * The spin-in: from `startLift` px above the rest pose (out of the viewport),
 * one and a half turns about the long axis, tilted so the underside, side
 * walls and back read on the way down; it touches the ring at LANDS_AT in
 * the design's three-quarter tilt (with the sparkle), then turns to face the
 * viewer with a slight overshoot and settles exactly on `rest` (face-on).
 */
function frames(rest: Pose, startLift: number): Frame[] {
  const T = LAND_TILT;
  return [
    {
      at: 0,
      ease: SPIN,
      liftEase: DROP,
      pose: { lift: startLift, ry: T.ry - 540, rx: T.rx + 46, rz: -16, scale: 0.82 },
    },
    { at: LANDS_AT, ease: SETTLE, pose: { lift: 14, ry: T.ry + 6, rx: T.rx - 4, rz: T.rz + 1, scale: rest.scale * 1.012 } },
    { at: 0.86, ease: SETTLE, pose: { lift: -4, ry: rest.ry - 2.5, rx: rest.rx + 1.2, rz: rest.rz - 0.3, scale: rest.scale * 0.998 } },
    { at: 1, ease: linear, pose: rest },
  ];
}

export function introPose(rest: Pose, startLift: number, progress: number): Pose {
  const fs = frames(rest, startLift);
  let i = 0;
  while (i < fs.length - 2 && progress >= fs[i + 1]!.at) i++;
  const a = fs[i]!;
  const b = fs[i + 1]!;
  const u = Math.min(1, Math.max(0, (progress - a.at) / (b.at - a.at)));
  const t = a.ease(u);
  const tl = (a.liftEase ?? a.ease)(u);
  const mix = (k: keyof Pose, w = t) => a.pose[k] + (b.pose[k] - a.pose[k]) * w;
  return { lift: mix('lift', tl), rx: mix('rx'), ry: mix('ry'), rz: mix('rz'), scale: mix('scale') };
}

export interface IntroHandle {
  /** Starts (or resumes) the spin; no-op once running. */
  play(): void;
  cancel(): void;
}

/**
 * Holds the phone on the first frame (call before first paint) and runs the
 * spin on `play()`, rAF-driven so every frame relights the device.
 */
export function createIntro(
  rig: PhoneRig,
  startLift: number,
  { onLand, onDone }: { onLand?: () => void; onDone?: () => void },
): IntroHandle {
  const rest = rig.rest;
  rig.setPose(introPose(rest, startLift, 0));
  let raf = 0;
  let t0 = -1;
  let landed = false;
  let done = false;
  const tick = (now: number) => {
    if (t0 < 0) t0 = now;
    const p = Math.min(1, (now - t0) / INTRO_MS);
    rig.setPose(p >= 1 ? rest : introPose(rest, startLift, p));
    if (!landed && p >= LANDS_AT) {
      landed = true;
      onLand?.();
    }
    if (p < 1) raf = requestAnimationFrame(tick);
    else {
      done = true;
      onDone?.();
    }
  };
  return {
    play() {
      if (raf || done) return;
      raf = requestAnimationFrame(tick);
    },
    cancel() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!done) rig.setPose(rest);
      done = true;
    },
  };
}
