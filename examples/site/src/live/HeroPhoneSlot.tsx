import type { HeroPhoneSlotProps } from './types';

/**
 * App area of the hero phone (320×634 below the status bar). The shell owns
 * the bezel, island, status bar, 3D pose, landing ring and caption.
 * Placeholder: the design's exported phone screen.
 */
export function HeroPhoneSlot({ width, height }: HeroPhoneSlotProps) {
  return (
    <img
      className="slot-placeholder"
      src={`${import.meta.env.BASE_URL}placeholders/hero-phone-content.png`}
      alt="Ignite demo app: React Native Radio episodes list"
      width={width}
      height={height}
      draggable={false}
      style={{ display: 'block', width, height }}
    />
  );
}
