export type Rect = { x: number; y: number; width: number; height: number };

export type HitNode = {
  type: string;
  frame: Rect;
  painted?: Rect;
  testID?: string;
  role?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  children: HitNode[];
};

export type FrameSize = { width?: number; height?: number };

export const DEFAULT_FRAME = { width: 390, height: 720 };
export const FRAME_GAP = 80;
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;

export function nodeRect(node: HitNode): Rect {
  return node.painted ?? node.frame;
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height;
}

/** Deepest node under (x, y), ancestors first. Empty if the point misses the tree. */
export function hitPath(node: HitNode, x: number, y: number): HitNode[] {
  if (!contains(nodeRect(node), x, y)) return [];
  for (let i = node.children.length - 1; i >= 0; i--) {
    const inner = hitPath(node.children[i]!, x, y);
    if (inner.length > 0) return [node, ...inner];
  }
  return [node];
}

export function hitNode(node: HitNode, x: number, y: number): HitNode | null {
  const path = hitPath(node, x, y);
  return path[path.length - 1] ?? null;
}

/** Innermost testID on the path that matches a route id. */
export function jumpId(path: HitNode[], routeIds: Iterable<string>): string | null {
  const ids = routeIds instanceof Set ? routeIds : new Set(routeIds);
  for (let i = path.length - 1; i >= 0; i--) {
    const id = path[i]?.testID;
    if (id && ids.has(id)) return id;
  }
  return null;
}

export function layoutFrames(
  routes: readonly FrameSize[],
  gap = FRAME_GAP
): Array<{ x: number; y: number; width: number; height: number }> {
  let x = 0;
  return routes.map((route) => {
    const width = route.width ?? DEFAULT_FRAME.width;
    const height = route.height ?? DEFAULT_FRAME.height;
    const frame = { x, y: 0, width, height };
    x += width + gap;
    return frame;
  });
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(
  sx: number,
  sy: number,
  panX: number,
  panY: number,
  zoom: number
): { x: number; y: number } {
  return { x: (sx - panX) / zoom, y: (sy - panY) / zoom };
}

export function zoomAt(
  sx: number,
  sy: number,
  panX: number,
  panY: number,
  zoom: number,
  nextZoom: number
): { zoom: number; panX: number; panY: number } {
  const zoomClamped = clampZoom(nextZoom);
  const world = screenToWorld(sx, sy, panX, panY, zoom);
  return {
    zoom: zoomClamped,
    panX: sx - world.x * zoomClamped,
    panY: sy - world.y * zoomClamped,
  };
}

export function fitRect(
  rect: { x: number; y: number; width: number; height: number },
  viewW: number,
  viewH: number,
  pad = 56
): { zoom: number; panX: number; panY: number } {
  const zoom = clampZoom(Math.min((viewW - pad * 2) / rect.width, (viewH - pad * 2) / rect.height));
  return {
    zoom,
    panX: (viewW - rect.width * zoom) / 2 - rect.x * zoom,
    panY: (viewH - rect.height * zoom) / 2 - rect.y * zoom,
  };
}

export function surfacePoint(
  clientX: number,
  clientY: number,
  canvas: { getBoundingClientRect(): DOMRect },
  surfaceWidth: number,
  surfaceHeight: number
): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((clientX - box.left) / box.width) * surfaceWidth,
    y: ((clientY - box.top) / box.height) * surfaceHeight,
  };
}
