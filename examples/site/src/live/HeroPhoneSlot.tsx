import { IgniteApp, device } from 'ignite-demo';
import { useCallback, useRef } from 'react';
import { LiveSurface } from './LiveSurface';
import type { HeroPhoneSlotProps } from './types';
import './live.css';

const INSETS = device.safeAreaInsets;

/**
 * The hero phone's app: a live `<IgniteApp/>` on the full iPhone 16 Pro
 * screen (402×874 pt, the true logical size; the device is scaled by CSS)
 * behind the shell's DOM status bar and home indicator (safe area 62 top /
 * 34 bottom), exactly like the app on a real device. Reports its first paint
 * so the hero device (src/hero3d/HeroDevice.tsx) can start the spin-in with
 * the app on screen.
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
        width={width}
        height={height}
        safeAreaInsets={INSETS}
        onReady={onReady}
        style={{ position: 'absolute', left: 0, top: 0 }}
        fallback={
          <img
            src={`${import.meta.env.BASE_URL}placeholders/hero-phone-content.png`}
            alt=""
            width={width}
            height={height - INSETS.top}
            draggable={false}
            style={{ position: 'absolute', left: 0, top: INSETS.top, width, height: height - INSETS.top, objectFit: 'cover', objectPosition: 'top' }}
          />
        }
      >
        <IgniteApp />
      </LiveSurface>
    </div>
  );
}
