import type { NativeRoot } from '../types';

export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface Viewport extends Rect {
  /** Canvas backing pixels per logical pixel; input never needs this. */
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
}
export interface TextFragment {
  text: string;
  bounds: Rect;
  visibleBounds: Rect | null;
  /** True when part or all of the glyph is clipped or occluded. */
  clipped: boolean;
  approximate: boolean;
}
export interface SnapshotNode {
  id: number;
  parentId: number | null;
  type: string;
  role?: string;
  label?: string;
  testID?: string;
  /** Paragraph text that survived Skia truncation (passwords stay masked). */
  text?: string;
  /** Current input value, independent of painted glyphs. Omitted for secure inputs. */
  value?: string;
  placeholder?: string;
  editable?: boolean;
  secure?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  inputPurpose?: 'username' | 'password' | 'one-time-code' | 'generic-secret' | 'none';
  textFragments?: readonly TextFragment[];
  /** Untransformed surface coordinates, including ancestor scrolling. */
  layoutBounds: Rect;
  /** Axis-aligned envelope of the transformed corners. */
  bounds: Rect;
  /** Actual transformed corners, in surface logical coordinates. */
  polygon: readonly Point[];
  visibleBounds: Rect | null;
  visible: boolean;
  /** Geometry has rounded clips, masks or uncertain paint occlusion. */
  approximate: boolean;
  occlusion: 'none' | 'partial' | 'full' | 'unknown';
  interactive: boolean;
  disabled: boolean;
  focused: boolean;
  opacity: number;
  /** DOM content is described but its glyphs are not fabricated. */
  rendering: 'canvas' | 'dom';
}
export interface ScrollRegion {
  id: number;
  parentScrollId: number | null;
  bounds: Rect;
  visibleBounds: Rect | null;
  axis: 'horizontal' | 'vertical';
  enabled: boolean;
  offset: Point;
  extent: { width: number; height: number };
  viewportExtent: { width: number; height: number };
  canScrollForward: boolean;
  canScrollBackward: boolean;
}
export interface Snapshot {
  viewport: Viewport;
  revision: number;
  /** performance.now() at the completed paint (controller creation for epoch 0). */
  timestamp: number;
  nodes: readonly SnapshotNode[];
  scrollRegions: readonly ScrollRegion[];
  focusedNode: number | null;
}
export interface OverlayInfo { id: number; kind: 'input' | 'portal' }
export interface Observation {
  viewport: Viewport;
  revision: number;
  timestamp: number;
  focusedNode: number | null;
  overlays: readonly OverlayInfo[];
  nodes?: readonly SnapshotNode[];
  scrollRegions?: readonly ScrollRegion[];
  screenshot?: Screenshot;
}
export type ScreenshotFormat = 'bitmap' | 'canvas' | 'blob' | 'pixels' | 'display';
export interface ScreenshotOptions { format?: ScreenshotFormat }
interface CaptureMetadata {
  /** Actual image pixel dimensions, including CSS scaling for display captures. */
  width: number;
  height: number;
  revision: number;
  timestamp: number;
  viewport: Viewport;
  /** Display includes browser composition; surface contains canvas pixels only. */
  scope: 'surface' | 'display';
}
export type Screenshot = CaptureMetadata & (
  | { format: 'bitmap'; data: ImageBitmap }
  /** Borrowed: changes on the next painted revision. Do not mutate. */
  | { format: 'canvas'; data: HTMLCanvasElement | OffscreenCanvas }
  | { format: 'blob' | 'display'; data: Blob }
  /** Owned tightly packed RGBA8, unpremultiplied sRGB. */
  | { format: 'pixels'; data: Uint8ClampedArray; width: number; height: number }
);
export interface ObserveOptions {
  snapshot?: boolean;
  screenshot?: boolean | ScreenshotOptions;
}
export interface WaitOptions { timeout?: number; signal?: AbortSignal }
export interface StableOptions extends WaitOptions { frames?: number }
export interface DragOptions {
  from: Point;
  to: Point;
  /** Real elapsed milliseconds. Zero dispatches the trajectory synchronously. */
  duration?: number;
  steps?: number;
  signal?: AbortSignal;
}
export interface KeyOptions { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }
export interface AutomationOptions {
  /** Browser compositor bridge: capture the canvas's displayed rectangle,
   * including DOM overlays. A change during capture rejects as StaleCaptureError. */
  captureDisplay?: (context: {
    root: NativeRoot; viewport: Viewport; revision: number; overlays: readonly OverlayInfo[];
  }) => Promise<{ data: Blob; width: number; height: number }>;
}
