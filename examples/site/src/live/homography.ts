// Planar projective maps. A CSS 3D transform (perspective included) maps the
// flat box of an element onto a quad on screen, and that map is exactly a
// homography — so four known corners are enough to invert it.

export type Pt = readonly [number, number];
/** Row-major 3×3, h33 = 1. */
export type Homography = readonly number[];

/** Solves the homography taking each `from[i]` to `to[i]`, or null if degenerate. */
export function solveHomography(from: readonly Pt[], to: readonly Pt[]): Homography | null {
  // 8 unknowns (h11..h32), two equations per correspondence.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gauss-Jordan with partial pivoting on the 8×9 augmented matrix.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    if (Math.abs(A[p]![c]!) < 1e-12) return null;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const row = A[c]!;
    const d = row[c]!;
    for (let k = c; k < 9; k++) row[k]! /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f) for (let k = c; k < 9; k++) A[r]![k]! -= f * row[k]!;
    }
  }
  return [...A.map((r) => r[8]!), 1];
}

export function applyHomography(h: Homography, [x, y]: Pt): [number, number] {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  return [(h[0]! * x + h[1]! * y + h[2]!) / w, (h[3]! * x + h[4]! * y + h[5]!) / w];
}
