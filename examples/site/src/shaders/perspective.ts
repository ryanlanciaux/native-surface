// CSS port of perspective3d.glsl's projection, so 3D planes stay real DOM
// (and live surfaces stay interactive) instead of being sampled into a texture.
//
// The shader puts a camera at distance f = u_focal * frameHeight from a plane
// through the frame centre, rotated by R = ry(rotY) · rx(rotX) · rz(rotZ), and
// shows the content scaled by u_scale. GL space is y-up / z-away; CSS is
// y-down / z-toward, a 180° turn about x, which flips the sign of the y and z
// rotations and leaves x alone. CSS applies the right-most function first,
// matching the shader's rz → rx → ry order.

export interface PerspectiveParams {
  rotX: number;
  rotY: number;
  rotZ: number;
  focal: number;
  scale: number;
}

/** `perspective` (px) for the frame and `transform` for the plane inside it. */
export function perspectiveTransform(p: PerspectiveParams, frameHeight: number) {
  return {
    perspective: `${p.focal * frameHeight}px`,
    transform: `rotateY(${-p.rotY}deg) rotateX(${p.rotX}deg) rotateZ(${-p.rotZ}deg) scale(${p.scale})`,
  };
}

/**
 * The shader's specular band, `exp(-((0.9·gx + 0.55·gy + 0.12)·7)²) · gloss`,
 * where g is the position relative to the frame centre in frame-UV units, as
 * a CSS linear-gradient over an element of w×h centred in a frame of fw×fh.
 * Blend it additively (mix-blend-mode: plus-lighter) over opaque content.
 */
export function glossGradient(gloss: number, w: number, h: number, fw: number, fh: number) {
  // f(x, y) = a·x + b·y in element pixels (CSS y-down, so gy = -y / fh).
  const a = 0.9 / fw;
  const b = -0.55 / fh;
  const k = Math.hypot(a, b);
  // CSS angle: 0deg points up, direction vector (sin θ, -cos θ).
  const theta = Math.atan2(a, -b);
  const half = (Math.abs(w * Math.sin(theta)) + Math.abs(h * Math.cos(theta))) / 2;
  const stops: string[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = -half + (2 * half * i) / N;
    const f = k * t;
    const alpha = gloss * Math.exp(-(((f + 0.12) * 7) ** 2));
    stops.push(`rgba(255,255,255,${alpha.toFixed(4)}) ${((i / N) * 100).toFixed(2)}%`);
  }
  return `linear-gradient(${((theta * 180) / Math.PI).toFixed(2)}deg, ${stops.join(', ')})`;
}
