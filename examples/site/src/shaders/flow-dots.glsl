precision highp float;

/** @resolution */
uniform vec2 u_resolution;

/** @time */
uniform float u_time;

/**
 * @label Base
 * @color
 * @default #06070A
 */
uniform vec3 u_base;

/**
 * @label Dot
 * @color
 * @default #1B2130
 */
uniform vec3 u_dot;

/**
 * @label Glow A
 * @color
 * @default #22D3EE
 */
uniform vec3 u_glowA;

/**
 * @label Glow B
 * @color
 * @default #8B5CF6
 */
uniform vec3 u_glowB;

/**
 * @label Spacing
 * @default 28
 * @range 12, 60
 */
uniform float u_spacing;

/** Pointer in uv (xy) and its strength 0..1 (z), fed by ShaderCanvas. */
uniform vec3 u_pointer;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 res = u_resolution;
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / res;
  float asp = res.x / res.y;
  float t = u_time * 0.05;

  // Dot lattice: every value is sampled at the cell centre, so each dot is one flat colour.
  float S = u_spacing;
  vec2 c = (floor(px / S) + 0.5) * S;
  vec2 cuv = c / res;
  vec2 q = vec2(cuv.x * asp, cuv.y);

  // Domain-warped flow field: slow ribbons drift through the grid and light the dots they cross.
  vec2 w = vec2(fbm(q * 1.6 + vec2(t, 0.0)), fbm(q * 1.6 + vec2(5.2, 1.3) - t));
  float f = fbm(q * 2.2 + 1.8 * w + vec2(0.0, t * 0.6));
  float band = smoothstep(0.52, 0.8, f);

  vec2 pp = vec2(u_pointer.x * asp, u_pointer.y);
  vec2 dp = q - pp;
  float near = u_pointer.z * exp(-dot(dp, dp) * 16.0);
  float lit = clamp(band + near, 0.0, 1.0);

  float r = mix(0.9, 1.8, lit) * S / 28.0;
  float dotMask = 1.0 - smoothstep(r - 0.7, r + 0.7, length(px - c));
  vec3 dotCol = mix(u_dot, mix(u_glowB, u_glowA, w.x), lit * 0.85);

  // Gradient mesh underneath: two soft blobs on slow orbits.
  vec2 P = vec2(uv.x * asp, uv.y);
  vec2 b1 = vec2((0.28 + 0.08 * sin(t * 2.0)) * asp, 0.38 + 0.08 * cos(t * 1.7));
  vec2 b2 = vec2((0.74 + 0.07 * cos(t * 1.3)) * asp, 0.58 + 0.09 * sin(t * 1.9));
  vec3 col = u_base;
  col += u_glowA * 0.05 * exp(-dot(P - b1, P - b1) * 4.0);
  col += u_glowB * 0.065 * exp(-dot(P - b2, P - b2) * 3.5);

  // Quiet zone behind the header copy so the text keeps its contrast.
  float hx = (uv.x - 0.5) * asp * 1.4;
  float hy = (uv.y - 0.82) * 5.0;
  float quiet = 1.0 - 0.75 * exp(-(hx * hx + hy * hy));

  col = mix(col, dotCol, dotMask * (0.35 + 0.65 * lit) * quiet);

  // Fade to the base at the top and bottom so the seams with the neighbours vanish.
  float edge = smoothstep(0.0, 0.14, uv.y) * smoothstep(1.0, 0.86, uv.y);
  col = u_base + (col - u_base) * edge;
  col += (hash(px + fract(u_time)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
