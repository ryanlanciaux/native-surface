import type { TransformStyle } from '../types';

/** Row-major 3x3 affine: [a, c, tx, b, d, ty, 0, 0, 1] (Skia layout). */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function multiply(m: Mat3, n: Mat3): Mat3 {
  const out: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 1];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] = m[row * 3]! * n[col]! + m[row * 3 + 1]! * n[3 + col]! + m[row * 3 + 2]! * n[6 + col]!;
    }
  }
  return out;
}

export function translation(tx: number, ty: number): Mat3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}

export function scaling(sx: number, sy: number): Mat3 {
  return [sx, 0, 0, 0, sy, 0, 0, 0, 1];
}

export function rotation(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function parseRotate(value: string): number {
  const v = value.trim();
  if (v.endsWith('deg')) return (parseFloat(v) * Math.PI) / 180;
  if (v.endsWith('rad')) return parseFloat(v);
  return parseFloat(v) * (Math.PI / 180);
}

/** RN transform list → matrix about the node's center (cx, cy). */
export function transformMatrix(transforms: TransformStyle[], cx: number, cy: number): Mat3 {
  let m: Mat3 = IDENTITY;
  for (const t of transforms) {
    if ('translateX' in t) m = multiply(m, translation(t.translateX, 0));
    else if ('translateY' in t) m = multiply(m, translation(0, t.translateY));
    else if ('scale' in t) m = multiply(m, scaling(t.scale, t.scale));
    else if ('scaleX' in t) m = multiply(m, scaling(t.scaleX, 1));
    else if ('scaleY' in t) m = multiply(m, scaling(1, t.scaleY));
    else if ('rotate' in t) m = multiply(m, rotation(parseRotate(t.rotate)));
  }
  return multiply(multiply(translation(cx, cy), m), translation(-cx, -cy));
}

export function invert(m: Mat3): Mat3 | null {
  const [a, c, tx, b, d, ty] = [m[0], m[1], m[2], m[3], m[4], m[5]];
  const det = a! * d! - c! * b!;
  if (!det) return null;
  const ia = d! / det;
  const ic = -c! / det;
  const ib = -b! / det;
  const id = a! / det;
  return [ia, ic, -(ia * tx! + ic * ty!), ib, id, -(ib * tx! + id * ty!), 0, 0, 1];
}

export function applyToPoint(m: Mat3, x: number, y: number): { x: number; y: number } {
  return { x: m[0]! * x + m[1]! * y + m[2]!, y: m[3]! * x + m[4]! * y + m[5]! };
}
