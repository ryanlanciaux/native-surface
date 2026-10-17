// The landing sparkle: a short, restrained firework off the ring. A few
// dozen low-saturation particles (white, pale cyan, pale violet) drawn
// additively on a 2D canvas overlay. No WebGL context, no layout.

const COLORS = [
  [255, 255, 255],
  [200, 244, 251], // #22D3EE toward white
  [214, 204, 252], // #8B5CF6 toward white
  [236, 250, 253],
] as const;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  delay: number;
  size: number;
  color: readonly [number, number, number];
  trail: boolean;
  twinkle: number;
}

export interface SparkleOptions {
  /** Ring centre and radii, in the canvas's CSS px. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Bottom edge of the phone (where it meets the ring), canvas CSS px. */
  baseY: number;
  /** Half-width of the phone's footprint. */
  halfWidth: number;
}

const DURATION = 1300;
const GRAVITY = 300; // px/s²
const DRAG = 2.1; // 1/s

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function particles(o: SparkleOptions): Particle[] {
  const out: Particle[] = [];
  const pick = () => COLORS[Math.random() < 0.4 ? 0 : 1 + Math.floor(Math.random() * 3)]!;
  // Ring sparks: off the rim, outward along the ellipse normal and up.
  for (let i = 0; i < 26; i++) {
    const a = rand(0, Math.PI * 2);
    const nx = Math.cos(a);
    const ny = Math.sin(a) * (o.ry / o.rx);
    const sp = rand(70, 170);
    out.push({
      x: o.cx + o.rx * Math.cos(a),
      y: o.cy + o.ry * Math.sin(a),
      vx: nx * sp,
      vy: ny * sp * 0.6 - rand(90, 230),
      life: rand(0.55, 1.05),
      delay: rand(0, 0.12),
      size: rand(0.7, 1.6),
      color: pick(),
      trail: Math.random() < 0.5,
      twinkle: rand(0, Math.PI * 2),
    });
  }
  // Pop: a fan up and out from the phone's foot, with short trails.
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const a = -Math.PI / 2 + side * rand(0.35, 1.25);
    const sp = rand(170, 330);
    out.push({
      x: o.cx + side * rand(0.55, 1) * o.halfWidth,
      y: o.baseY,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rand(0.6, 1.15),
      delay: rand(0, 0.06),
      size: rand(0.9, 1.8),
      color: pick(),
      trail: true,
      twinkle: rand(0, Math.PI * 2),
    });
  }
  // Glints: a few cross-shaped stars that bloom near the ring and go.
  for (let i = 0; i < 5; i++) {
    const a = rand(Math.PI * 0.05, Math.PI * 0.95) + (i % 2 ? Math.PI : 0);
    out.push({
      x: o.cx + o.rx * Math.cos(a) * rand(0.8, 1.05),
      y: o.cy + o.ry * Math.sin(a) - rand(10, 60),
      vx: 0,
      vy: -rand(8, 20),
      life: rand(0.45, 0.7),
      delay: rand(0.08, 0.45),
      size: rand(5, 9),
      color: COLORS[i % 2 ? 0 : 1],
      trail: false,
      twinkle: -1,
    });
  }
  return out;
}

/** Plays one burst on `canvas` (sized here to its box), then clears it. */
export function sparkle(canvas: HTMLCanvasElement, o: SparkleOptions): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const box = canvas.getBoundingClientRect();
  const cssW = canvas.offsetWidth || 1;
  const cssH = canvas.offsetHeight || 1;
  // The overlay sits inside the scaled stage: back it at its on-screen size.
  const k = (box.width / cssW) * (window.devicePixelRatio || 1);
  canvas.width = Math.round(cssW * k);
  canvas.height = Math.round(cssH * k);
  const ps = particles(o);
  let raf = 0;
  let t0 = -1;
  let last = 0;

  const frame = (now: number) => {
    if (t0 < 0) t0 = last = now;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      const age = t - p.delay;
      if (age < 0) continue;
      const u = age / p.life;
      if (u >= 1) continue;
      if (p.twinkle < 0) {
        drawGlint(ctx, p, u);
        p.y += p.vy * dt;
        continue;
      }
      const damp = Math.exp(-DRAG * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const flicker = 0.75 + 0.25 * Math.sin(p.twinkle + age * 38);
      const alpha = Math.pow(1 - u, 1.6) * flicker * 0.85;
      const [r, g, b] = p.color;
      if (p.trail) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha * 0.45})`;
        ctx.lineWidth = p.size * 0.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
      glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      glow.addColorStop(0.25, `rgba(${r},${g},${b},${alpha * 0.5})`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (t * 1000 < DURATION) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, cssW, cssH);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
}

function drawGlint(ctx: CanvasRenderingContext2D, p: Particle, u: number) {
  // Bloom in fast, fade slower.
  const env = u < 0.3 ? u / 0.3 : Math.pow(1 - (u - 0.3) / 0.7, 1.4);
  const s = p.size * (0.6 + 0.4 * env);
  const [r, g, b] = p.color;
  const a = env * 0.8;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.PI / 4 * 0.18);
  for (const [w, h] of [
    [s * 2.2, 0.9],
    [0.9, s * 2.2],
  ] as const) {
    const grad = ctx.createLinearGradient(-w, -h, w, h);
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${a})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(-w, -h, w * 2, h * 2);
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.7);
  core.addColorStop(0, `rgba(255,255,255,${a})`);
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
