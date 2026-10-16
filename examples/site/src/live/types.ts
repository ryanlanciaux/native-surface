import type { AnyCatalogEntry } from 'ignite-demo';

// Contracts between the landing-page sections (static chrome, owned by the
// shell) and the live native-surface content that fills their slots.
// The shell renders the frame, bezel, 3D transforms, callouts and IDE chrome;
// a slot only paints the app area it is handed, at exactly that size.

export interface SlotSize {
  /** CSS px, pre-transform (the design's own coordinates). */
  width: number;
  height: number;
}

/** Hero phone: the screen area below the device status bar. */
export interface HeroPhoneSlotProps extends SlotSize {
  /**
   * True while the device group is on screen (IntersectionObserver only; it
   * says nothing about the intro, which the live slot itself owns).
   */
  active: boolean;
}

export type ExplodedLayerId = 'screen' | 'tabbar' | 'cards' | 'buttons' | 'toggle' | 'heading';

/** One component instance placed on an exploded layer plane. */
export interface LayerItem {
  id: string;
  /** Position inside the 340×704 plane, in design px. */
  x: number;
  y: number;
  width?: number;
  /** Design overrides for this instance (copy, favorited state, cover art). */
  props?: Record<string, unknown>;
}

/**
 * The 980×980 layer frames overlap, so `.xl-frame` and the slot root stay
 * `pointer-events: none`; only the live content boxes inside opt back in
 * (`pointer-events: auto`). Never relax `.xl-frame` itself, or the topmost
 * frame swallows every hit.
 */
export interface ExplodedLayersSlotProps extends SlotSize {
  layer: ExplodedLayerId;
  items: LayerItem[];
  /** True once the section is near the viewport. */
  active: boolean;
}

export interface PlaygroundPreviewSlotProps {
  /** The selected catalog entry (component or screen). */
  entry: AnyCatalogEntry;
  /**
   * Full props, seeded from a deep copy of `entry.defaultProps` (never from
   * partial overrides) with callbacks already bound by the playground. Keep
   * the object identity stable between edits: the slot re-measures the render
   * time whenever it changes.
   */
  props: Record<string, unknown>;
  /** Width for design-width (272) components, 340 in the playground. */
  width: number;
  /** Measured render time (ms): this commit → engine painted. Stable identity not required. */
  onRendered?: (info: { ms: number }) => void;
  /** The component's laid-out size (design px, shadow excluded). */
  onSize?: (size: { width: number; height: number }) => void;
}
