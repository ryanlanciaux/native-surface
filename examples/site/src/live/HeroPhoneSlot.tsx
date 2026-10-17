import { IgniteApp, device } from 'ignite-demo';
import { useCallback, useRef } from 'react';
import { LiveSurface } from './LiveSurface';
import type { HeroPhoneSlotProps } from './types';
import './live.css';

const STATUS_BAR = 50;

/**
 * The hero phone's app: a live `<IgniteApp/>` on a 320×684 surface that sits
 * behind the shell's DOM status bar (safe-area top 50), exactly like the app
 * under a real device's status bar. Reports its first paint so the hero
 * device (src/hero3d/HeroDevice.tsx) can start the spin-in with the app on
 * screen.
 */
export function HeroPhoneSlot({
  width,
  height,
  onPainted,
}: HeroPhoneSlotProps & {
  /** The live app's first frame is on screen (once). */
  onPainted?: () => void;
}) {
  const onPaintedRef = useRef(onPainted);
  onPaintedRef.current = onPainted;
  const onReady = useCallback(() => onPaintedRef.current?.(), []);

  return (
    <div className="live-hero" style={{ width, height }}>
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
