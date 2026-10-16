precision highp float;

/** @resolution */
uniform vec2 u_resolution;

/** @label Content */
uniform sampler2D u_content;

/**
 * @label Tilt X
 * @default 0
 * @range -85, 85
 */
uniform float u_rotX;

/**
 * @label Tilt Y
 * @default 0
 * @range -85, 85
 */
uniform float u_rotY;

/**
 * @label Spin
 * @default 0
 * @range -180, 180
 */
uniform float u_rotZ;

/**
 * @label Focal Length
 * @default 2.5
 * @range 0.6, 8
 */
uniform float u_focal;

/**
 * @label Scale
 * @default 1
 * @range 0.2, 2
 */
uniform float u_scale;

/**
 * @label Thickness
 * @default 0
 * @range 0, 80
 */
uniform float u_depth;

/**
 * @label Edge Color
 * @color
 * @default #9AA3B2
 */
uniform vec3 u_edge;

/**
 * @label Rim Glow
 * @color
 * @default #22D3EE
 */
uniform vec3 u_rim;

/**
 * @label Gloss
 * @default 0.15
 * @range 0, 1
 */
uniform float u_gloss;

const float PI = 3.14159265;

mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

vec4 sampleAt(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(u_content, uv);
}

void main() {
  vec2 res = u_resolution;
  vec2 p = gl_FragCoord.xy - 0.5 * res;
  float f = u_focal * res.y;
  vec3 C = vec3(0.0, 0.0, -f);
  vec3 D = vec3(p, f);
  mat3 R = ry(radians(u_rotY)) * rx(radians(u_rotX)) * rz(radians(u_rotZ));
  vec3 U = R * vec3(1.0, 0.0, 0.0);
  vec3 V = R * vec3(0.0, 1.0, 0.0);
  vec3 N = R * vec3(0.0, 0.0, 1.0);
  float dn = dot(N, D);
  if (abs(dn) < 1e-5) { gl_FragColor = vec4(0.0); return; }

  float tf = -dot(N, C) / dn;
  vec3 X = C + tf * D;
  vec2 uvF = vec2(dot(X, U), dot(X, V)) / (u_scale * res) + 0.5;
  vec4 front = tf > 0.0 ? sampleAt(uvF) : vec4(0.0);
  vec2 g = uvF - 0.5;
  float glare = exp(-pow((g.x * 0.9 + g.y * 0.55 + 0.12) * 7.0, 2.0)) * u_gloss;
  front.rgb = min(front.rgb + glare * front.a, vec3(front.a));

  vec4 side = vec4(0.0);
  if (u_depth > 0.5 && front.a < 0.999) {
    for (int i = 1; i <= 40; i++) {
      float k = u_depth * float(i) / 40.0;
      float t = (k - dot(N, C)) / dn;
      vec3 Y = C + t * D - N * k;
      vec2 uv = vec2(dot(Y, U), dot(Y, V)) / (u_scale * res) + 0.5;
      if (sampleAt(uv).a > 0.5) {
        float h = k / u_depth;
        vec2 q = normalize(uv - 0.5 + 1e-5);
        float lit = 0.55 + 0.45 * dot(q, normalize(vec2(-0.7, 0.5)));
        float ridge = 0.7 + 0.4 * sin(h * PI);
        vec3 c = u_edge * lit * ridge + u_rim * pow(1.0 - h, 5.0) * 0.45;
        side = vec4(c, 1.0);
        break;
      }
    }
  }
  gl_FragColor = front + side * (1.0 - front.a);
}
