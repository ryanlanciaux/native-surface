precision highp float;

/** @resolution */
uniform vec2 u_resolution;

/**
 * @label Background
 * @color
 * @default #0B0D12
 */
uniform vec3 u_bg;

/**
 * @label Dot
 * @color
 * @default #2A3140
 */
uniform vec3 u_dot;

/**
 * @label Glow
 * @color
 * @default #22D3EE
 */
uniform vec3 u_glow;

/**
 * @label Spacing
 * @default 20
 * @range 6, 60
 */
uniform float u_spacing;

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 uv = p / u_resolution;
  vec2 cell = mod(p, u_spacing) - 0.5 * u_spacing;
  float d = length(cell);
  float dot = 1.0 - smoothstep(0.6, 1.4, d);
  float center = exp(-pow(length((uv - vec2(0.5, 0.55)) * vec2(u_resolution.x / u_resolution.y, 1.0)), 2.0) * 3.0);
  vec3 col = u_bg + u_glow * center * 0.07;
  col = mix(col, mix(u_dot, u_glow, center * 0.5), dot * (0.55 + 0.45 * center));
  gl_FragColor = vec4(col, 1.0);
}
