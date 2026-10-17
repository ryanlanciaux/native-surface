import { cross, type Vec3 } from './math';

// The device as flat CSS facets around the 340×704 front face (z = 0, the
// screen side) in `.phone`'s own px space. Each facet is a box of w×h placed
// with matrix3d: local x runs along `u`, local y along `v`, and its front
// face points along n = u × v, so backface culling and lighting both follow.

export const DEVICE = { width: 340, height: 704, radius: 58, depth: 34 } as const;

export type Material = 'frame' | 'button';

export interface Facet {
  key: string;
  material: Material;
  w: number;
  h: number;
  /** Outward normal in device space. */
  n: Vec3;
  transform: string;
  /** Static extra background layers (antenna bands), drawn over the lit metal. */
  overlay?: string;
}

function place(o: Vec3, u: Vec3, v: Vec3): { n: Vec3; transform: string } {
  const n = cross(u, v);
  const f = (x: number) => +x.toFixed(4);
  const m = [...u, 0, ...v, 0, ...n, 0, ...o, 1].map(f);
  return { n, transform: `matrix3d(${m.join(',')})` };
}

/**
 * Side wall of a rounded rect extruded `depth` back from z = 0: four
 * straight runs plus `segments` chords per corner. Local y of every strip
 * runs from the front edge (top of the strip) to the back edge.
 */
function walls(segments: number): Facet[] {
  const { width: W, height: H, radius: R, depth: D } = DEVICE;
  const out: Facet[] = [];
  const strip = (key: string, cx: number, cy: number, phi: number, len: number, overlay?: string) => {
    const u: Vec3 = [Math.sin(phi), -Math.cos(phi), 0];
    const o: Vec3 = [cx - (u[0] * len) / 2, cy - (u[1] * len) / 2, 0];
    out.push({ key, material: 'frame', w: len, h: D, overlay, ...place(o, u, [0, 0, -1]) });
  };
  // Antenna bands: thin insulating breaks across the frame, as on a real
  // titanium phone, 42 px in from each straight end of the long sides.
  const sideLen = H - 2 * R;
  const band = (at: number) => `transparent ${at}px, #1a1d2399 ${at}px, #1a1d2399 ${at + 3}px, transparent ${at + 3}px`;
  const antenna = `linear-gradient(90deg, ${band(42)}, ${band(sideLen - 45)})`;
  strip('top', W / 2, 0, -Math.PI / 2, W - 2 * R + 0.8);
  strip('right', W, H / 2, 0, sideLen + 0.8, antenna);
  strip('bottom', W / 2, H, Math.PI / 2, W - 2 * R + 0.8);
  strip('left', 0, H / 2, Math.PI, sideLen + 0.8, antenna);
  const corners: [number, number, number][] = [
    [W - R, R, -Math.PI / 2], // top right: -90° → 0°
    [W - R, H - R, 0], // bottom right
    [R, H - R, Math.PI / 2], // bottom left
    [R, R, Math.PI], // top left
  ];
  const step = Math.PI / 2 / segments;
  const chord = 2 * R * Math.sin(step / 2);
  const mid = R * Math.cos(step / 2);
  corners.forEach(([cx, cy, a0], c) => {
    for (let i = 0; i < segments; i++) {
      const phi = a0 + step * (i + 0.5);
      strip(`c${c}-${i}`, cx + mid * Math.cos(phi), cy + mid * Math.sin(phi), phi, chord + 0.7);
    }
  });
  return out;
}

/** A protruding box (side button); `omit` is the face against the wall. */
function box(key: string, [x0, x1]: [number, number], [y0, y1]: [number, number], [z0, z1]: [number, number], omit: '-x' | '+x'): Facet[] {
  const faces: Facet[] = [];
  const add = (k: string, w: number, h: number, o: Vec3, u: Vec3, v: Vec3) =>
    faces.push({ key: `${key}-${k}`, material: 'button', w, h, ...place(o, u, v) });
  const down: Vec3 = [0, 0, -1];
  if (omit !== '-x') add('-x', y1 - y0, z1 - z0, [x0, y0, z1], [0, 1, 0], down);
  if (omit !== '+x') add('+x', y1 - y0, z1 - z0, [x1, y1, z1], [0, -1, 0], down);
  add('-y', x1 - x0, z1 - z0, [x1, y0, z1], [-1, 0, 0], down);
  add('+y', x1 - x0, z1 - z0, [x0, y1, z1], [1, 0, 0], down);
  add('+z', x1 - x0, y1 - y0, [x0, y0, z1], [1, 0, 0], [0, 1, 0]);
  add('-z', x1 - x0, y1 - y0, [x1, y0, z0], [-1, 0, 0], [0, 1, 0]);
  return faces;
}

/** Action button + volume rocker on the left, side button on the right. */
function buttons(): Facet[] {
  const { width: W, depth: D } = DEVICE;
  const out = 2.4;
  const z: [number, number] = [-D / 2 - 6, -D / 2 + 6];
  return [
    ...box('action', [-out, 0], [128, 160], z, '+x'),
    ...box('vol-up', [-out, 0], [196, 252], z, '+x'),
    ...box('vol-down', [-out, 0], [266, 322], z, '+x'),
    ...box('side', [W, W + out], [212, 302], z, '-x'),
  ];
}

export function buildFacets(cornerSegments = 10): Facet[] {
  return [...walls(cornerSegments), ...buttons()];
}

/** Back plate: faces -z at z = -depth, laid out as seen from behind. */
export const BACK_TRANSFORM = place([DEVICE.width, 0, -DEVICE.depth], [-1, 0, 0], [0, 1, 0]).transform;
