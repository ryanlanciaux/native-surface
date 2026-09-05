export type Rect = { x: number; y: number; width: number; height: number };

export type HitNode = {
  type: string;
  frame: Rect;
  painted?: Rect;
  name?: string;
  testID?: string;
  role?: string;
  label?: string;
  text?: string;
  placeholder?: string;
  padding?: { top: number; right: number; bottom: number; left: number };
  margin?: { top: number; right: number; bottom: number; left: number };
  gap?: number;
  font?: { size?: number; family?: string; weight?: string; lineHeight?: number; color?: string };
  children: HitNode[];
};

export type FrameSize = { width?: number; height?: number };

export const DEFAULT_FRAME = { width: 390, height: 720 };
export const DEFAULT_COMPONENT = { width: 320, height: 400 };
export const FRAME_GAP = 80;
export const FRAME_CHROME = 28;
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 3;
export const WRAP_WIDTH = 1640;
export const MIN_LIVE_PX = 80;
export const MAX_LIVE = 8;

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
  return layoutWrap(routes, { gap, wrapWidth: Number.POSITIVE_INFINITY });
}

export const GROUP_HEADER = 40;
export const GROUP_GAP = 96;

export type GroupSpec = { title: string; items: readonly FrameSize[] };
export type GroupBox = { title: string; x: number; y: number; width: number; height: number };

/** Stack groups vertically; variants of one screen sit in a single row. */
export function layoutGroups(
  groups: readonly GroupSpec[],
  opts: { gap?: number; groupGap?: number; header?: number; fallback?: { width: number; height: number } } = {}
): { frames: Array<{ x: number; y: number; width: number; height: number }>; boxes: GroupBox[] } {
  const gap = opts.gap ?? FRAME_GAP;
  const groupGap = opts.groupGap ?? GROUP_GAP;
  const header = opts.header ?? GROUP_HEADER;
  const fallback = opts.fallback ?? DEFAULT_FRAME;
  const frames: Array<{ x: number; y: number; width: number; height: number }> = [];
  const boxes: GroupBox[] = [];
  let y = 0;
  for (const group of groups) {
    let x = 0;
    let rowH = 0;
    for (const item of group.items) {
      const width = item.width ?? fallback.width;
      const height = item.height ?? fallback.height;
      frames.push({ x, y: y + header, width, height });
      x += width + gap;
      rowH = Math.max(rowH, height);
    }
    const width = Math.max(x - gap, group.items[0] ? (group.items[0].width ?? fallback.width) : fallback.width);
    boxes.push({ title: group.title, x: 0, y, width, height: header + rowH });
    y += header + rowH + groupGap;
  }
  return { frames, boxes };
}

/** Left-to-right, wrap onto the next row when a frame would exceed wrapWidth. */
export function layoutWrap(
  items: readonly FrameSize[],
  opts: { gap?: number; wrapWidth?: number; originY?: number; fallback?: { width: number; height: number } } = {}
): Array<{ x: number; y: number; width: number; height: number }> {
  const gap = opts.gap ?? FRAME_GAP;
  const wrapWidth = opts.wrapWidth ?? WRAP_WIDTH;
  const fallback = opts.fallback ?? DEFAULT_FRAME;
  let x = 0;
  let y = opts.originY ?? 0;
  let rowH = 0;
  return items.map((item) => {
    const width = item.width ?? fallback.width;
    const height = item.height ?? fallback.height;
    if (x > 0 && x + width > wrapWidth) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    const frame = { x, y, width, height };
    x += width + gap;
    rowH = Math.max(rowH, height);
    return frame;
  });
}

export function boundsOf(frames: readonly Rect[]): Rect {
  if (frames.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  let x2 = 0;
  let y2 = 0;
  for (const frame of frames) {
    x2 = Math.max(x2, frame.x + frame.width);
    y2 = Math.max(y2, frame.y + frame.height);
  }
  return { x: 0, y: 0, width: x2, height: y2 };
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

export function worldView(
  panX: number,
  panY: number,
  zoom: number,
  viewW: number,
  viewH: number,
  overscan = 0.35
): Rect {
  const width = viewW / zoom;
  const height = viewH / zoom;
  const ox = width * overscan;
  const oy = height * overscan;
  return {
    x: -panX / zoom - ox,
    y: -panY / zoom - oy,
    width: width + ox * 2,
    height: height + oy * 2,
  };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** True when a frame (plus chrome) overlaps the world view. Pan-cull only. */
export function frameLive(frame: Rect, view: Rect, chrome = FRAME_CHROME): boolean {
  return overlaps({ ...frame, height: frame.height + chrome }, view);
}

/** False when either on-screen edge is under minPx — freeze, don't keep a live surface. */
export function frameBigEnough(frame: Pick<Rect, 'width' | 'height'>, zoom: number, minPx = MIN_LIVE_PX): boolean {
  return frame.width * zoom >= minPx && frame.height * zoom >= minPx;
}

/** Overlapping + large enough, capped to `max` nearest the view center. */
export function pickLive(
  frames: readonly { id: string; frame: Rect }[],
  view: Rect,
  zoom: number,
  opts: { max?: number; minPx?: number; chrome?: number } = {}
): Set<string> {
  const max = opts.max ?? MAX_LIVE;
  const minPx = opts.minPx ?? MIN_LIVE_PX;
  const chrome = opts.chrome ?? FRAME_CHROME;
  const cx = view.x + view.width / 2;
  const cy = view.y + view.height / 2;
  return new Set(
    frames
      .filter((item) => frameLive(item.frame, view, chrome) && frameBigEnough(item.frame, zoom, minPx))
      .sort((a, b) => {
        const da = (a.frame.x + a.frame.width / 2 - cx) ** 2 + (a.frame.y + a.frame.height / 2 - cy) ** 2;
        const db = (b.frame.x + b.frame.width / 2 - cx) ** 2 + (b.frame.y + b.frame.height / 2 - cy) ** 2;
        return da - db;
      })
      .slice(0, max)
      .map((item) => item.id)
  );
}

/** `/plane#/<route-id>` → id. Empty or other hashes → null. */
export function routeIdFromHash(hash: string): string | null {
  if (!hash.startsWith('#/')) return null;
  try {
    const id = decodeURIComponent(hash.slice(2));
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
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

export function formatEdges(box: { top: number; right: number; bottom: number; left: number }): string {
  if (box.top === box.right && box.right === box.bottom && box.bottom === box.left) return `${box.top}`;
  return `${box.top} ${box.right} ${box.bottom} ${box.left}`;
}
