/** Structural protocol: no dependency on a particular renderer or e2e runner. */
export const BRIDGE_KEY = '__surfaceE2E';
export const BRIDGE_VERSION = 1;
export interface Point { x: number; y: number }
export interface Rect extends Point { width: number; height: number }
export interface SurfaceNode {
  id: number;
  parentId: number | null;
  type: string;
  role?: string;
  label?: string;
  testID?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  editable?: boolean;
  secure?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  inputPurpose?: 'username' | 'password' | 'one-time-code' | 'generic-secret' | 'none';
  bounds: Rect;
  visibleBounds: Rect | null;
  visible: boolean;
  disabled: boolean;
  focused: boolean;
  rendering: 'canvas' | 'dom';
}
export interface SurfaceObservation {
  revision: number;
  viewport: { width: number; height: number };
  focusedNode: number | null;
  overlays: readonly { id: number; kind: 'input' | 'portal' }[];
  nodes?: readonly SurfaceNode[];
  scrollRegions?: readonly {
    id: number; parentScrollId: number | null; axis: 'vertical' | 'horizontal' | 'both';
    bounds: Rect; visibleBounds: Rect | null; enabled: boolean;
  }[];
}
export interface SurfaceController {
  observe(options: { snapshot: boolean }): Promise<SurfaceObservation>;
  inputElement?(): HTMLInputElement | HTMLTextAreaElement | null;
  hitTest?(point: Point): readonly number[];
  scroll(options: Point & { deltaX?: number; deltaY: number }): void;
  toClientPoint(point: Point): Point;
  fromClientPoint(point: Point): Point;
}
export interface BridgeObservation extends SurfaceObservation {
  /** Changes on every bridge attachment, even if renderer node IDs repeat. */
  epoch: string;
  host: Rect;
  nodes: readonly SurfaceNode[];
}
export interface FocusInfo {
  id: number;
  epoch: string;
  multiline: boolean;
}
export interface BrowserBridge {
  version: typeof BRIDGE_VERSION;
  observe(): Promise<BridgeObservation>;
  focus(): Promise<FocusInfo | null>;
  receives(point: Point, nodeId?: number, kind?: 'pointer' | 'wheel'): Promise<boolean>;
  scroll(point: Point, delta: Point): void;
}
export type BridgeRegistry = Record<string, BrowserBridge>;
