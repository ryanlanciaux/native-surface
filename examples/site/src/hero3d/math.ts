// Small 3D helpers for the hero device: CSS-space vectors (x right, y down,
// z toward the viewer), the plane's rotation, a CSS cubic-bezier solver and
// the device's lighting model.

export type Vec3 = readonly [number, number, number];

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Device pose in CSS terms (degrees, `lift` in px along screen y). */
export interface Pose {
  lift: number;
  rx: number;
  ry: number;
  rz: number;
  scale: number;
}

export type Mat3 = readonly number[];
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Row-major rotation of `rotateY(ry) rotateX(rx) rotateZ(rz)`: CSS applies
 * the right-most function first, so a local vector v ends up at Ry·Rx·Rz·v.
 */
export function poseRotation({ rx, ry, rz }: Pose): Mat3 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rad(rx)), Math.sin(rad(rx)), Math.cos(rad(ry)), Math.sin(rad(ry)), Math.cos(rad(rz)), Math.sin(rad(rz))];
  // Rx·Rz
  const a = [cz, -sz, 0, cx * sz, cx * cz, -sx, sx * sz, sx * cz, cx];
  // Ry·(Rx·Rz), Ry = [cy 0 sy; 0 1 0; -sy 0 cy]
  return [
    cy * a[0]! + sy * a[6]!,
    cy * a[1]! + sy * a[7]!,
    cy * a[2]! + sy * a[8]!,
    a[3]!,
    a[4]!,
    a[5]!,
    -sy * a[0]! + cy * a[6]!,
    -sy * a[1]! + cy * a[7]!,
    -sy * a[2]! + cy * a[8]!,
  ];
}

export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
  m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
  m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
];

/** CSS `cubic-bezier(x1, y1, x2, y2)` as an easing function of t ∈ [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const bez = (t: number, p1: number, p2: number) => 3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t;
  const dBez = (t: number, p1: number, p2: number) => 3 * (1 - t) * (1 - t) * p1 + 6 * (1 - t) * t * (p2 - p1) + 3 * t * t * (1 - p2);
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = dBez(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= (bez(t, x1, x2) - x) / d;
    }
    // Newton can overshoot on flat curves; bisect if it left [0, 1].
    if (t < 0 || t > 1) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 24; i++) {
        t = (lo + hi) / 2;
        if (bez(t, x1, x2) < x) lo = t;
        else hi = t;
      }
    }
    return bez(t, y1, y2);
  };
}

// ---------- lighting ----------
// Key light from the upper left, in front; the viewer looks down -z; the
// cyan landing ring lights the device from below.
const KEY = normalize([-0.5, -0.72, 0.55]);
const VIEW: Vec3 = [0, 0, 1];
const HALF = normalize([KEY[0] + VIEW[0], KEY[1] + VIEW[1], KEY[2] + VIEW[2]]);
const RING = normalize([0, 1, 0.3]);
const CYAN: Vec3 = [0x22 / 255, 0xd3 / 255, 0xee / 255];

export interface Light {
  /** Lambert term of the key light. */
  diffuse: number;
  /** Blinn-Phong highlight, exponent per material. */
  spec: number;
  /** Grazing-angle term (rim). */
  fresnel: number;
  /** Ring bounce from below. */
  under: number;
  /** n · view: > 0 when the facet faces the viewer. */
  facing: number;
}

export function light(n: Vec3, shininess: number): Light {
  const facing = dot(n, VIEW);
  return {
    diffuse: Math.max(0, dot(n, KEY)),
    spec: Math.pow(Math.max(0, dot(n, HALF)), shininess),
    fresnel: Math.pow(1 - Math.min(1, Math.abs(facing)), 2.5),
    under: Math.max(0, dot(n, RING)),
    facing,
  };
}

/** The key light's half vector, in screen space (for sliding gloss bands). */
export const HALF_VECTOR = HALF;

/** Brushed titanium frame: base colour lit by key, ring bounce and rim. */
export function shadeMetal(base: Vec3, l: Light, gain = 1): Vec3 {
  const k = (0.3 + 0.8 * l.diffuse) * gain;
  const s = l.spec * 0.7;
  const cy = 0.22 * l.under * l.under + 0.14 * l.fresnel;
  return [base[0] * k + s + CYAN[0] * cy, base[1] * k + s + CYAN[1] * cy, base[2] * k + s + CYAN[2] * cy];
}

/** Frosted back glass: darker, broader and dimmer highlight. */
export function shadeGlass(base: Vec3, l: Light): Vec3 {
  const k = 0.5 + 0.85 * l.diffuse;
  const s = l.spec * 0.22;
  const cy = 0.12 * l.under + 0.08 * l.fresnel;
  return [base[0] * k + s + CYAN[0] * cy, base[1] * k + s + CYAN[1] * cy, base[2] * k + s + CYAN[2] * cy];
}

export function rgb(c: Vec3, mul = 1, add = 0) {
  const ch = (v: number) => Math.round(Math.min(1, Math.max(0, v * mul + add)) * 255);
  return `rgb(${ch(c[0])} ${ch(c[1])} ${ch(c[2])})`;
}

export function hexToVec(hex: string): Vec3 {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as Vec3;
}
