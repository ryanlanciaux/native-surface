/**
 * One copy of the canvas-offset + CSS-stretch rule.
 *
 * A root paints into a canvas sized in *layout* pixels (`cssWidth`/`cssHeight`),
 * but the page is free to lay that canvas out at any on-screen size — a 390x844
 * surface stretched into a 780x1688 box is the normal case, not the exotic one.
 * So placing anything in *page* coordinates over a node needs two corrections:
 * scale the node's layout-space rect by the ratio between the canvas's real
 * box and its logical size, then translate by where the canvas sits on the page.
 *
 * Three seams need exactly that arithmetic — the DOM portal host, the focused
 * TextInput overlay, and the CNode DOM facade's `getBoundingClientRect()` — and
 * a second copy of it is a bug that only shows up on stretched canvases, which
 * is the configuration nobody tests. Hence this module.
 *
 * Node-import-safe: no top-level DOM access, and the entry points return null
 * rather than reaching for a `document` that may not exist.
 */
import type { CNode } from './node';

/** The overlay host a root exposes through `RootHooks.getInputHost`. */
export interface CanvasHost {
  canvas: HTMLCanvasElement | null;
  cssWidth: number;
  cssHeight: number;
}

export interface CanvasGeometry {
  /** Page coordinates, in screen px. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Layout px → screen px scale factors (1 when the canvas is not stretched). */
  sx: number;
  sy: number;
}

/** This node's root canvas host, or null for a headless root (Node, tests). */
export function canvasHostOf(node: CNode): CanvasHost | null {
  const hooks = node.rootHooks as { getInputHost?: () => CanvasHost } | null;
  const host = hooks?.getInputHost?.();
  return host && host.canvas ? host : null;
}

/**
 * Fixed-position geometry of a node over its (possibly CSS-stretched) canvas.
 * Returns null while the canvas has no on-screen box — before first layout, or
 * while it is `display:none` — so callers can hold their previous placement
 * instead of collapsing everything to 0,0.
 */
export function canvasGeometry(node: CNode, host: CanvasHost): CanvasGeometry | null {
  if (!host.canvas) return null;
  const rect = host.canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const sx = rect.width / host.cssWidth;
  const sy = rect.height / host.cssHeight;
  const abs = node.absoluteRect();
  return {
    left: rect.left + abs.x * sx,
    top: rect.top + abs.y * sy,
    width: abs.w * sx,
    height: abs.h * sy,
    sx,
    sy,
  };
}
