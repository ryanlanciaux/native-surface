#extension GL_OES_standard_derivatives : enable
precision highp float;

// One full-viewport pass behind the page. Each section is a horizontal band
// (u_band: top, bottom in CSS px from the viewport top, bottom <= top when off
// screen) and gets its own effect, added on top of the page background.

uniform vec2 u_res;
uniform float u_px;
uniform float u_time;
uniform vec4 u_band[6];
uniform vec3 u_ptr;
uniform float u_oct;
uniform float u_narrow;

const vec3 BG = vec3(0.0235, 0.0275, 0.0392);
const vec3 LIME = vec3(0.776, 0.957, 0.196);

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p, float oct) {
  float v = 0.0;
  float a = 0.5;
  float norm = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= oct) break;
    v += a * noise(p);
    norm += a;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return v / norm;
}

// Hero: a slow domain-warped aurora, brighter toward the phone, with a lime trace on its crests.
vec3 hero(vec2 p, vec2 s, float t) {
  vec2 uv = p / s.y;
  float tt = t * 0.03;
  float qo = max(u_oct - 2.0, 2.0);
  vec2 q = vec2(fbm(uv * 1.3 + vec2(0.0, tt), qo), fbm(uv * 1.3 + vec2(5.2, 1.3) - tt, qo));
  float n = fbm(uv * 1.7 + 2.4 * q + vec2(tt * 0.7, -tt), u_oct);
  float x = p.x / s.x;
  float w = mix(0.35, 1.0, smoothstep(0.15, 0.8, x)) * mix(1.0, 0.55, smoothstep(0.55, 1.0, p.y / s.y));
  float ribbon = smoothstep(0.42, 0.78, n);
  // Phones: the phone sits centred under the copy, so the aurora spreads evenly, lifted, and eases off behind the text.
  w = mix(w, 1.8 * smoothstep(0.12, 0.42, p.y / s.y) + 0.25, u_narrow);
  vec3 c = vec3(0.11) * ribbon * w + vec3(0.034) * n * w;
  c += LIME * 0.05 * smoothstep(0.6, 0.85, n) * smoothstep(0.45, 0.9, x);
  return c;
}

// Take it apart: a floor and ceiling grid converging on the stack, drifting toward the viewer as the page scrolls.
vec3 depthGrid(vec2 p, vec2 s, float prog, float t) {
  vec2 d = (p - vec2(s.x * 0.5, s.y * 0.56)) / min(s.y, 1100.0);
  float ay = abs(d.y) + 1e-4;
  float z = 0.22 / ay;
  vec2 g = vec2(d.x * z * 5.0, z * 3.0 + prog * 6.0 + t * 0.05);
  vec2 fw = fwidth(g);
  vec2 dist = (0.5 - abs(fract(g) - 0.5)) / max(fw, vec2(1e-4));
  vec2 l = 1.0 - smoothstep(vec2(0.0), vec2(1.1), dist);
  float line = max(l.x, l.y);
  float fade = smoothstep(0.03, 0.3, ay) * (1.0 - smoothstep(0.6, 1.1, ay));
  float fog = exp(-ay * 7.0) * 0.04;
  return vec3(0.07) * line * fade + vec3(fog);
}

// Playground: a dot field that drifts on a slow flow and swells, parts and warms to lime around the cursor.
vec3 dots(vec2 p, vec2 s, float t, float top) {
  float sp = 26.0;
  vec2 toP = p - vec2(u_ptr.x, u_ptr.y - top);
  float dist = length(toP);
  float infl = u_ptr.z * exp(-dist * dist / (2.0 * 150.0 * 150.0));
  vec2 pp = p - toP / max(dist, 1.0) * infl * 9.0;
  vec2 cell = floor(pp / sp);
  vec2 f = pp - (cell + 0.5) * sp;
  float flow = noise(cell * 0.09 + vec2(t * 0.09, -t * 0.06));
  float r = 1.2 + infl * 0.9;
  float aa = 0.8 / u_px;
  float dotm = 1.0 - smoothstep(r - aa, r + aa, length(f));
  float lum = 0.05 + 0.09 * smoothstep(0.5, 0.95, flow) + 0.16 * infl;
  return vec3(lum) * dotm + LIME * dotm * infl * 0.14 + vec3(0.018) * infl;
}

// Under the hood: thin data streams running along the pipeline's direction (down on narrow screens).
vec3 streams(vec2 p, vec2 s, float t) {
  vec2 q = u_narrow > 0.5 ? vec2(p.y, p.x) : p;
  float lane = 14.0;
  float li = floor(q.y / lane);
  float ly = abs(fract(q.y / lane) - 0.5) * lane;
  float active = step(0.5, hash(vec2(li, 3.1)));
  float speed = 30.0 + 90.0 * hash(vec2(li, 9.7));
  float x = q.x - t * speed;
  float seg = 160.0 + 260.0 * hash(vec2(li, 7.0));
  float si = floor(x / seg);
  float sx = fract(x / seg);
  float on = step(0.45, hash(vec2(li, si)));
  float len = 0.18 + 0.3 * hash(vec2(si, li));
  float trail = pow(smoothstep(0.0, len, sx), 2.0) * (1.0 - smoothstep(len, len + 0.01, sx));
  float aa = 0.7 / u_px;
  float line = 1.0 - smoothstep(0.5 - aa, 0.5 + aa, ly);
  float k = active * on * trail * line;
  float packet = step(0.93, hash(vec2(si * 1.7, li * 3.3)));
  vec3 c = mix(vec3(0.17), LIME * 0.3, packet) * k;
  float scan = 0.006 * step(0.5, fract(p.y / 3.0));
  return c + vec3(scan);
}

// Final call to action: slow caustics, two drifting ridged layers breathing out from the centre.
vec3 caustics(vec2 p, vec2 s, float t) {
  vec2 uv = (p - s * 0.5) / s.y;
  vec2 q = uv * 5.0;
  vec2 w = vec2(noise(q * 0.7 + t * 0.05), noise(q * 0.7 - t * 0.04 + 7.3));
  float r1 = 1.0 - abs(2.0 * noise(q + w * 1.6 + vec2(t * 0.08, 0.0)) - 1.0);
  float r2 = 1.0 - abs(2.0 * noise(q * 1.35 - w * 1.2 + vec2(3.1, t * 0.07)) - 1.0);
  float v = pow(r1, 9.0) + 0.7 * pow(r2, 9.0);
  float mask = exp(-dot(uv * vec2(0.75, 1.1), uv * vec2(0.75, 1.1)) * 2.2) * (0.8 + 0.2 * sin(t * 0.45));
  return vec3(v * 0.1 * mask + 0.022 * mask);
}

// Footer: faint drifting grain.
vec3 grain(vec2 p, float t) {
  return vec3(0.012 * noise(p * 0.02 + vec2(t * 0.05, 0.0)));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_px;
  vec2 view = u_res / u_px;
  vec3 c = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    vec4 b = u_band[i];
    if (p.y < b.x || p.y >= b.y) continue;
    vec2 s = vec2(view.x, b.y - b.x);
    vec2 lp = vec2(p.x, p.y - b.x);
    float edge = (i == 0 ? 1.0 : smoothstep(0.0, 160.0, lp.y)) * (i == 5 ? 1.0 : smoothstep(0.0, 160.0, s.y - lp.y));
    float prog = clamp((view.y - b.x) / (view.y + s.y), 0.0, 1.0);
    vec3 e;
    if (i == 0) e = hero(lp, s, u_time);
    else if (i == 1) e = depthGrid(lp, s, prog, u_time);
    else if (i == 2) e = dots(lp, s, u_time, b.x);
    else if (i == 3) e = streams(lp, s, u_time);
    else if (i == 4) e = caustics(lp, s, u_time);
    else e = grain(lp, u_time);
    c = e * edge;
  }
  float dither = (hash(gl_FragCoord.xy + fract(u_time)) - 0.5) / 255.0;
  gl_FragColor = vec4(BG + c + dither, 1.0);
}
