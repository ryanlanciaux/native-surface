import { applyHomography, solveHomography, type Pt } from '../live/homography';
import { DEVICE } from './geometry';
import { apply, poseRotation, type Pose } from './math';
import type { PhoneRig } from './Phone3D';

// Drag-to-rotate for the hero phone, once the intro has settled.
//
// Who gets a press (decided once, at pointerdown):
// - On the screen glass (the target is inside the live surface `.live-hero`,
//   or the hit lands inside the glass while the front faces the viewer): the
//   app, 100%. No capture, no preventDefault, no drag threshold, touch-action
//   untouched, so the app's lists scroll (wheel, trackpad, touch) and taps and
//   swipes behave normally.
// - On the frame (bezel, sides, or anywhere while the back/edge faces the
//   viewer): rotation, straight away. Locked: frame presses only count taps.
// Touch on the frame keeps vertical page scroll: the device is
// `touch-action: pan-y` (the canvas's own `none` wins inside the glass).
//
// Double-tap / double-click on the FRAME toggles the lock; double taps inside
// the app go to the app. The second tap only toggles within DOUBLE_MS and
// DOUBLE_PX of the first.
//
// Release: inertia plus a gentle spring that settles face-on (the nearest
// whole turn). Locking springs face-on, stiffer. Reduced motion: the drag
// follows the pointer, but there is no inertia or spring (the phone stays
// where it is let go) and the lock snaps instantly.

const DRAG_SLOP = 6;
const DOUBLE_MS = 320;
const DOUBLE_PX = 30;
/** Degrees per CSS px of pointer travel. */
const SENSITIVITY = 0.45;
const MAX_TILT = 75;
const MAX_SPEED = 1500;
/** Velocity window at release (ms). */
const FLICK_MS = 80;
const FREE = { k: 7, c: 3.2 };
const LOCK = { k: 170, c: 24 };

export interface DragRotateHandle {
  /** Interaction on (after the intro). */
  enable(): void;
  dispose(): void;
}

export interface DragRotateOptions {
  /** Takes the pointer listeners (`.hero__device`). */
  root: HTMLElement;
  /** `.phone`, holding the four corner probes. */
  phone: HTMLElement;
  rig: PhoneRig;
  /** First drag or lock toggle (hides the hint). */
  onInteract?: () => void;
}

type Hit = 'screen' | 'frame' | null;
type Gesture = {
  id: number;
  hit: 'screen' | 'frame';
  x0: number;
  y0: number;
  t0: number;
  x: number;
  y: number;
  dragging: boolean;
  samples: { t: number; rx: number; ry: number }[];
};

export function createDragRotate({ root, phone, rig, onInteract }: DragRotateOptions): DragRotateHandle {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const probes = [...phone.querySelectorAll<HTMLElement>(':scope > [data-phone-probe]')];
  const { width: W, height: H, radius: R, bezel: B } = DEVICE;

  let enabled = false;
  let locked = false;
  let interacted = false;
  let rx = rig.rest.rx;
  let ry = rig.rest.ry;
  let vx = 0;
  let vy = 0;
  let spring = FREE;
  let raf = 0;
  let last = 0;
  let g: Gesture | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;

  const pose = (): Pose => ({ ...rig.rest, rx, ry });
  const set = () => rig.setPose(pose());
  const interact = () => {
    if (interacted) return;
    interacted = true;
    onInteract?.();
  };

  /** The screen glass faces the viewer (else the whole device is frame). */
  const frontFacing = () => apply(poseRotation(pose()), [0, 0, 1])[2] >= 0.1;

  /** Where a client point lands on the device's front plane, in device pt. */
  const classify = (x: number, y: number): Hit => {
    const screen = probes.map((p): Pt => {
      const r = p.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    const local: Pt[] = [
      [0.5, 0.5],
      [W - 0.5, 0.5],
      [W - 0.5, H - 0.5],
      [0.5, H - 0.5],
    ];
    const h = solveHomography(screen, local);
    if (!h) return null;
    const [u, v] = applyHomography(h, [x, y]);
    if (!inRoundRect(u, v, 0, 0, W, H, R)) return null;
    if (!frontFacing()) return 'frame';
    return inRoundRect(u, v, B, B, W - B, H - B, R - B) ? 'screen' : 'frame';
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const ty = Math.round(ry / 360) * 360;
    vy += (-spring.k * (ry - ty) - spring.c * vy) * dt;
    vx += (-spring.k * rx - spring.c * vx) * dt;
    ry += vy * dt;
    rx = clamp(rx + vx * dt, -MAX_TILT, MAX_TILT);
    if (Math.abs(ry - ty) < 0.05 && Math.abs(rx) < 0.05 && Math.abs(vy) < 0.5 && Math.abs(vx) < 0.5) {
      rx = 0;
      ry = 0; // a whole number of turns is the same pose
      vx = vy = 0;
      set();
      raf = 0;
      return;
    }
    set();
    raf = requestAnimationFrame(tick);
  };
  const settle = (s: typeof FREE) => {
    spring = s;
    stop();
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };
  const faceOn = () => {
    if (reduced.matches) {
      stop();
      rx = ry = vx = vy = 0;
      set();
    } else settle(LOCK);
  };

  const toggleLock = () => {
    locked = !locked;
    root.classList.toggle('is-locked', locked);
    if (locked) root.style.cursor = ''; // locked frame: no grab affordance
    interact();
    if (locked) faceOn();
  };

  const startDrag = (e: PointerEvent) => {
    if (!g) return;
    g.dragging = true;
    stop();
    vx = vy = 0;
    // Capture moves the pointer off the canvas: the engine cancels the app's
    // gesture on lostpointercapture.
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already gone.
    }
    root.classList.add('is-dragging');
    g.samples = [{ t: e.timeStamp, rx, ry }];
    interact();
  };

  const onDown = (e: PointerEvent) => {
    if (!enabled || !e.isTrusted || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const hit = classify(e.clientX, e.clientY);
    // Screen (or off the device): the app / the page own it. Never touched.
    if (hit !== 'frame') return;
    if (frontFacing() && (e.target as Element | null)?.closest?.('.live-hero')) return;
    g = { id: e.pointerId, hit, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, x: e.clientX, y: e.clientY, dragging: false, samples: [] };
    if (locked) return; // frame taps still count toward the unlock double-tap
    e.preventDefault();
    startDrag(e);
  };

  const onMove = (e: PointerEvent) => {
    if (!e.isTrusted) return;
    if (!g || e.pointerId !== g.id) {
      if (enabled && !locked && e.pointerType === 'mouse' && !e.buttons) {
        root.style.cursor = classify(e.clientX, e.clientY) === 'frame' ? 'grab' : '';
      }
      return;
    }
    if (!g.dragging) return; // locked frame press: tap counting only
    e.stopPropagation();
    ry += (e.clientX - g.x) * SENSITIVITY;
    rx = clamp(rx - (e.clientY - g.y) * SENSITIVITY, -MAX_TILT, MAX_TILT);
    g.x = e.clientX;
    g.y = e.clientY;
    g.samples.push({ t: e.timeStamp, rx, ry });
    while (g.samples.length > 2 && e.timeStamp - g.samples[0]!.t > FLICK_MS) g.samples.shift();
    set();
  };

  const onEnd = (e: PointerEvent) => {
    if (!e.isTrusted || !g || e.pointerId !== g.id) return;
    const ended = g;
    g = null;
    root.classList.remove('is-dragging');
    if (ended.dragging) {
      e.stopPropagation();
      const travel = Math.hypot(e.clientX - ended.x0, e.clientY - ended.y0);
      if (e.type === 'pointerup' && travel < DRAG_SLOP) tap(e);
      else lastTap = null;
      release(ended, e.timeStamp);
      return;
    }
    if (e.type === 'pointerup') tap(e);
  };

  const tap = (e: PointerEvent) => {
    const t = e.timeStamp;
    if (lastTap && t - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_PX) {
      lastTap = null;
      toggleLock();
      return;
    }
    lastTap = { t, x: e.clientX, y: e.clientY };
  };

  const release = (ended: Gesture, t: number) => {
    if (locked) return;
    if (reduced.matches) return; // no inertia, no automatic motion
    const first = ended.samples[0];
    const span = first ? (t - first.t) / 1000 : 0;
    if (first && span > 0.004 && t - ended.samples[ended.samples.length - 1]!.t < FLICK_MS) {
      vy = clamp((ry - first.ry) / span, -MAX_SPEED, MAX_SPEED);
      vx = clamp((rx - first.rx) / span, -MAX_SPEED, MAX_SPEED);
    } else vx = vy = 0;
    settle(FREE);
  };

  const opts = { capture: true };
  root.addEventListener('pointerdown', onDown, opts);
  root.addEventListener('pointermove', onMove, opts);
  root.addEventListener('pointerup', onEnd, opts);
  root.addEventListener('pointercancel', onEnd, opts);

  return {
    enable() {
      enabled = true;
      rx = rig.rest.rx;
      ry = rig.rest.ry;
      root.classList.add('is-rotatable');
    },
    dispose() {
      stop();
      root.removeEventListener('pointerdown', onDown, opts);
      root.removeEventListener('pointermove', onMove, opts);
      root.removeEventListener('pointerup', onEnd, opts);
      root.removeEventListener('pointercancel', onEnd, opts);
      root.classList.remove('is-rotatable', 'is-locked', 'is-dragging');
      root.style.cursor = '';
    },
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function inRoundRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x;
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
