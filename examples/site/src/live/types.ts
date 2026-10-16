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
   * True while the phone sits in its resting (landed) pose and is on screen.
   * Live content can defer mounting / pause rendering while false.
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

export interface ExplodedLayersSlotProps extends SlotSize {
  layer: ExplodedLayerId;
  items: LayerItem[];
  /** True once the section is near the viewport. */
  active: boolean;
}

export type EpisodeCardState = 'default' | 'favorited' | 'pressed';

export interface EpisodeProps {
  title: string;
  /** ISO date, e.g. 2023-07-13. */
  pubDate: string;
  /** mm:ss */
  duration: string;
  /** File name shown in the props panel; resolved by the slot. */
  cover: string;
}

export interface PlaygroundPreviewSlotProps {
  component: 'EpisodeCard';
  /** Card width in design px (340 in the playground). */
  width: number;
  state: EpisodeCardState;
  episode: EpisodeProps;
  isFavorite: boolean;
  theme: 'light' | 'dark';
  /** Fired when the card's favorite button is pressed; the shell logs it. */
  onPressFavorite: (payload: { guid: string }) => void;
  /** Report a measured render time (ms) for the caption under the card. */
  onRendered?: (info: { ms: number }) => void;
}
