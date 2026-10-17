import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createDragRotate } from './dragRotate';
import { DEVICE } from './geometry';
import { createIntro, introPose, type IntroHandle } from './intro';
import type { Pose } from './math';
import { Phone3D, rigFor } from './Phone3D';
import { sparkle } from './sparkle';

/** Longest the intro waits for the first paint before spinning in anyway. */
const PAINT_TIMEOUT = 6000;

declare global {
  interface Window {
    __siteReady?: boolean;
  }
}

// Ring (.hero__pad) and phone foot in the sparkle canvas's px: the canvas
// sits at device (-80, 240), the ring is centred at device (280, 731).
const SPARKLE = { cx: 360, cy: 491, rx: 190, ry: 31, baseY: 486, halfWidth: 150 };

export interface HeroDeviceProps {
  rest: Pose;
  perspective: string;
  /** The live app has painted: start the intro. */
  ready: boolean;
  /** First drag or lock toggle on the settled phone. */
  onInteract?: () => void;
  children: ReactNode;
}

/**
 * The hero's 3D phone plus its intro. The phone waits above the viewport
 * (set before first paint) until the live app has painted, so the spin shows
 * the real app, then spins in, touches the ring (ring pulse + sparkle burst),
 * in the design's tilt, then turns face-on (`rest`) and settles. Toggles
 * `is-intro` / `is-landed` / `is-settled` on `.hero__device` and sets
 * `window.__siteReady` once settled; from then on the phone can be dragged
 * round and double-tapped to lock (dragRotate.ts).
 * Reduced motion: no spin, no sparkle, at rest from the start.
 */
export function HeroDevice({ rest, perspective, ready, onInteract, children }: HeroDeviceProps) {
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const sparkRef = useRef<HTMLCanvasElement>(null);
  const intro = useRef<IntroHandle | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Runs after Phone3D's layout effect (parents after children), so the rig
  // exists and the device is at rest for measuring.
  useLayoutEffect(() => {
    const canvas = sparkRef.current;
    const deviceEl = canvas?.closest<HTMLElement>('.hero__device');
    const phone = deviceEl?.querySelector<HTMLElement>('.phone');
    const rig = rigFor(phone);
    if (!canvas || !deviceEl || !phone || !rig) return;
    const drag = createDragRotate({ root: deviceEl, phone, rig, onInteract: () => onInteractRef.current?.() });
    const settle = () => {
      deviceEl.classList.add('is-landed', 'is-settled');
      deviceEl.classList.remove('is-intro');
      drag.enable();
      requestAnimationFrame(() => {
        window.__siteReady = true;
      });
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      intro.current = { play: settle, cancel() {} };
      return () => {
        drag.dispose();
        intro.current = null;
      };
    }
    // Start far enough up that the tilted, spinning phone is fully above
    // the viewport (in the plane's own px: the stage may be scaled, and
    // `.phone` is scaled by DEVICE.scale inside the plane).
    const r = phone.getBoundingClientRect();
    const k = r.height / (phone.offsetHeight * DEVICE.scale) || 1;
    const lift = -Math.max(r.top + 0.95 * r.height + 40, 360) / k;
    // Inspection hooks: `?hero-progress=0.4` freezes the intro at that
    // point, `?hero-pose=rx,ry,rz` holds an arbitrary pose.
    const q = new URLSearchParams(location.search);
    const frozen = parseFloat(q.get('hero-progress') ?? '');
    const held = q.get('hero-pose')?.split(',').map(Number);
    if ((frozen >= 0 && frozen <= 1) || held?.length === 3) {
      const [rx, ry, rz] = held ?? [];
      rig.setPose(held ? { ...rig.rest, rx: rx!, ry: ry!, rz: rz! } : introPose(rig.rest, lift, frozen));
      return () => drag.dispose();
    }
    let stopSparkle = () => {};
    const handle = createIntro(rig, lift, {
      onLand() {
        deviceEl.classList.add('is-landed');
        stopSparkle = sparkle(canvas, SPARKLE);
      },
      onDone: settle,
    });
    deviceEl.classList.add('is-intro');
    intro.current = handle;
    return () => {
      handle.cancel();
      drag.dispose();
      stopSparkle();
      intro.current = null;
      deviceEl.classList.remove('is-intro', 'is-landed', 'is-settled');
    };
  }, [rest]);

  useLayoutEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setTimedOut(true), PAINT_TIMEOUT);
    return () => clearTimeout(t);
  }, [ready]);

  const go = ready || timedOut;
  useLayoutEffect(() => {
    if (go) intro.current?.play();
  }, [go, rest]);

  return (
    <>
      <Phone3D rest={rest} perspective={perspective}>
        {children}
      </Phone3D>
      <canvas ref={sparkRef} className="hero3d-sparkle" aria-hidden="true" />
    </>
  );
}
