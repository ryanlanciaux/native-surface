import { IgniteApp, device } from 'ignite-demo';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { LiveSurface } from './LiveSurface';
import type { HeroPhoneSlotProps } from './types';
import './live.css';

const STATUS_BAR = 50;
/** Longest the intro waits for the first paint before spinning in anyway. */
const PAINT_TIMEOUT = 6000;
const INTRO_MS = 2200;
/** Fraction of the intro at which the phone first touches the ring. */
const LANDS_AT = 0.7;

declare global {
  interface Window {
    __siteReady?: boolean;
  }
}

/**
 * The hero phone's app: a live `<IgniteApp/>` on a 320×684 surface that sits
 * behind the shell's DOM status bar (safe-area top 50), exactly like the app
 * under a real device's status bar. Also drives the spin-down intro through
 * the shell's `--phone-*` pose vars, and sets `window.__siteReady` once the
 * app has painted and the phone has settled.
 */
export function HeroPhoneSlot({ width, height }: HeroPhoneSlotProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [painted, setPainted] = useState(false);
  const onReady = useCallback(() => setPainted(true), []);
  useHeroIntro(anchorRef, painted);

  return (
    <div ref={anchorRef} className="live-hero" style={{ width, height }}>
      <LiveSurface
        eager
        width={device.screenWidth}
        height={device.screenHeight}
        safeAreaInsets={{ top: STATUS_BAR }}
        onReady={onReady}
        style={{ position: 'absolute', left: 0, top: -STATUS_BAR }}
        fallback={
          <img
            src={`${import.meta.env.BASE_URL}placeholders/hero-phone-content.png`}
            alt=""
            width={width}
            height={height}
            draggable={false}
            style={{ position: 'absolute', left: 0, top: STATUS_BAR, width, height }}
          />
        }
      >
        <IgniteApp />
      </LiveSurface>
    </div>
  );
}

const POSE_VARS = ['--phone-lift', '--phone-rotate-x', '--phone-rotate-y', '--phone-rotate-z', '--phone-scale'] as const;

/**
 * Spin-down intro. The phone waits above the viewport (paused on the first
 * keyframe from before the first page paint) until the live app has painted,
 * so the spin shows the real app, then falls in with 1½ turns, overshoots the
 * ring, settles, pulses the ring and fades the caption in.
 * Reduced motion: no intro, the phone is at rest from the start.
 */
function useHeroIntro(anchorRef: React.RefObject<HTMLElement | null>, painted: boolean) {
  const anim = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const plane = anchor?.closest<HTMLElement>('.phone3d__plane');
    const deviceEl = anchor?.closest<HTMLElement>('.hero__device');
    if (!plane || !deviceEl) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof plane.animate !== 'function' || !CSS.registerProperty) {
      anim.current = null;
      return;
    }
    const cs = getComputedStyle(plane);
    const rest = Object.fromEntries(POSE_VARS.map((v) => [v, cs.getPropertyValue(v).trim()]));
    const restY = parseFloat(rest['--phone-rotate-y']!) || 24;
    const restX = parseFloat(rest['--phone-rotate-x']!) || -6;
    const deg = (n: number) => `${n}deg`;
    const a = plane.animate(
      [
        {
          offset: 0,
          '--phone-lift': '-125vh',
          '--phone-rotate-y': deg(restY - 540),
          '--phone-rotate-x': deg(restX + 44),
          '--phone-rotate-z': '-16deg',
          '--phone-scale': '0.84',
          easing: 'cubic-bezier(0.2, 0.62, 0.32, 1)',
        },
        {
          offset: LANDS_AT,
          '--phone-lift': '16px',
          '--phone-rotate-y': deg(restY + 7),
          '--phone-rotate-x': deg(restX - 5),
          '--phone-rotate-z': '1.2deg',
          '--phone-scale': '1.015',
          easing: 'cubic-bezier(0.45, 0, 0.4, 1)',
        },
        {
          offset: 0.86,
          '--phone-lift': '-5px',
          '--phone-rotate-y': deg(restY - 2),
          '--phone-rotate-x': deg(restX + 1.5),
          '--phone-rotate-z': '-0.3deg',
          '--phone-scale': '0.997',
          easing: 'cubic-bezier(0.45, 0, 0.4, 1)',
        },
        { offset: 1, ...rest },
      ] as Keyframe[],
      { duration: INTRO_MS, fill: 'backwards' },
    );
    a.pause();
    anim.current = a;
    deviceEl.classList.add('is-intro');
    return () => {
      a.cancel();
      anim.current = null;
      deviceEl.classList.remove('is-intro', 'is-landed', 'is-settled');
    };
  }, [anchorRef]);

  // Start once painted (or after a timeout, so a GPU-less browser still lands).
  const [timedOut, setTimedOut] = useState(false);
  useLayoutEffect(() => {
    if (painted) return;
    const t = setTimeout(() => setTimedOut(true), PAINT_TIMEOUT);
    return () => clearTimeout(t);
  }, [painted]);

  const go = painted || timedOut;
  useLayoutEffect(() => {
    if (!go) return;
    const a = anim.current;
    const deviceEl = anchorRef.current?.closest<HTMLElement>('.hero__device');
    const settle = () => {
      deviceEl?.classList.add('is-landed', 'is-settled');
      deviceEl?.classList.remove('is-intro');
      // Painted, or given up waiting: either way the page is as ready as it gets.
      requestAnimationFrame(() => {
        window.__siteReady = true;
      });
    };
    if (!a) {
      settle();
      return;
    }
    // Idempotent (StrictMode re-runs this): play once, re-arm the timers
    // from wherever the animation currently is.
    if (a.playState === 'paused') a.play();
    const elapsed = Number(a.currentTime ?? 0);
    const land = setTimeout(() => deviceEl?.classList.add('is-landed'), Math.max(0, INTRO_MS * LANDS_AT - elapsed));
    let alive = true;
    a.finished.then(
      () => alive && settle(),
      () => {},
    );
    return () => {
      alive = false;
      clearTimeout(land);
    };
  }, [go, anchorRef]);
}
