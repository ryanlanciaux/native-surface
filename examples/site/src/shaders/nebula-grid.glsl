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
 * @label Focus X
 * @default 0.7
 * @range 0, 1
 */
uniform float u_focusX;

/**
 * @label Focus Y
 * @default 0.4
 * @range 0, 1
 */
uniform float u_focusY;

/**
 * @label Horizon
 * @default 0.3
 * @range 0, 1
 */
uniform float u_horizon;

/**
 * @label Grid
 * @default 1
 * @range 0, 2
 */
uniform float u_grid;

/**
 * @label Nebula
 * @default 1
 * @range 0, 2
 */
uniform float u_nebula;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 res = u_resolution;
  vec2 uv = gl_FragCoord.xy / res;
  float asp = res.x / res.y;
  vec2 P = vec2(uv.x * asp, uv.y);
  float t = u_time * 0.03;
  vec3 col = u_base;

  float n = fbm(P * 2.2 + vec2(t, -t * 0.5));
  float n2 = fbm(P * 3.4 - vec2(t * 0.7, t));
  vec2 fA = vec2(u_focusX * asp, u_focusY);
  float dA = length(P - fA);
  float dB = length(P - vec2(0.1 * asp, 0.95));
  col += u_glowA * pow(n, 2.5) * 1.3 * exp(-dA * 2.0) * u_nebula;
  col += u_glowA * 0.09 * exp(-dA * dA * 5.0) * u_nebula;
  col += u_glowB * pow(n2, 2.0) * 1.0 * exp(-dB * 1.8) * u_nebula;
  col += u_glowB * 0.06 * exp(-length(P - vec2(0.3 * asp, 0.35)) * 2.2) * u_nebula;

  vec2 sc = floor(gl_FragCoord.xy / 3.0);
  float s = hash(sc);
  col += vec3(0.8, 0.9, 1.0) * step(0.9965, s) * hash(sc + 3.1) * 0.6 * smoothstep(u_horizon, u_horizon + 0.2, uv.y);

  if (uv.y < u_horizon && u_grid > 0.0) {
    float d = u_horizon - uv.y;
    float z = 0.12 / d;
    float S = 1.6;
    float gx = (uv.x - u_focusX) * asp * z * S;
    float gz = z * S - u_time * 0.15;
    float ddx = z * S / res.y;
    float ddz = 0.12 / (d * d) * S / res.y;
    float lx = 1.0 - smoothstep(0.0, 1.2 * ddx + 0.004, 0.5 - abs(fract(gx) - 0.5));
    float lz = 1.0 - smoothstep(0.0, 1.2 * ddz + 0.004, 0.5 - abs(fract(gz) - 0.5));
    float fade = smoothstep(0.0, 0.06, d) * exp(-z * 0.25);
    float spot = exp(-pow(length(vec2((uv.x - u_focusX) * asp, d * 3.0)), 2.0) * 3.0);
    vec3 gc = mix(u_glowB, u_glowA, 0.4 + 0.6 * spot);
    col += gc * max(lx, lz) * fade * 0.55 * u_grid * (0.35 + spot);
    col += u_glowA * spot * 0.10 * u_grid;
  }

  col += u_glowA * exp(-abs(uv.y - u_horizon) * res.y * 0.04) * 0.25 * u_grid * exp(-abs(uv.x - u_focusX) * asp * 1.2);
  col *= 1.0 - 0.35 * pow(length((uv - 0.5) * vec2(1.0, 1.2)), 2.0);
  col += (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
