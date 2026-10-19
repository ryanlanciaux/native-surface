import { useEffect, useRef } from 'react';
import source from './backdrop.glsl?raw';
import './backdrop.css';

/** Section order matches the effect index in backdrop.glsl. */
const SECTIONS = ['.hero', '.exploded', '.pg', '.uth', '.cta', '.footer'];
const MAX_DPR = 1.5;
/** Backing-store scale on top of the DPR cap: the effects are soft, so they run below native resolution. */
const SCALE = { desktop: 0.75, mobile: 0.6 };
/** Frame interval cap: the effects move slowly, so 30 fps is plenty and halves the GPU time. */
const FRAME_MS = 1000 / 30 - 2;
/** Frozen clock for reduced motion. */
const STILL_TIME = 24;
/** Start once the hero phone has settled (or after this long), so the intro never shares a frame with shader setup. */
const START_TIMEOUT = 8000;

const VERTEX = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

/**
 * One fixed, full-viewport WebGL canvas behind every section, drawing a
 * different effect per section band in a single pass (one context for the
 * whole page). Without WebGL it never switches on and the page keeps its
 * flat background.
 */
export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const t0 = performance.now();
    let timer = 0;
    const wait = () => {
      if (cancelled) return;
      if (window.__siteReady || performance.now() - t0 > START_TIMEOUT) {
        const go = () => {
          if (!cancelled) stop = start(canvas);
        };
        if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 600 });
        else setTimeout(go, 0);
        return;
      }
      timer = window.setTimeout(wait, 200);
    };
    wait();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, []);

  return <canvas ref={ref} className="backdrop" aria-hidden="true" />;
}

function start(canvas: HTMLCanvasElement): (() => void) | null {
  // No software-rendered backdrop (see also isSoftware): the page stays flat instead.
  const gl = canvas.getContext('webgl', {
    failIfMajorPerformanceCaveat: true,
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const release = () => gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (isSoftware(gl) || !gl.getExtension('OES_standard_derivatives')) {
    release();
    return null;
  }
  let program: WebGLProgram;
  try {
    program = link(gl, VERTEX, source);
  } catch (err) {
    console.warn('[Backdrop]', err);
    release();
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    res: u('u_res'),
    px: u('u_px'),
    time: u('u_time'),
    band: u('u_band'),
    ptr: u('u_ptr'),
    oct: u('u_oct'),
    narrow: u('u_narrow'),
  };

  const root = document.documentElement;
  const els = SECTIONS.map((sel) => document.querySelector<HTMLElement>(sel));
  const docTop = new Float64Array(SECTIONS.length);
  const height = new Float64Array(SECTIONS.length);
  const onScreen = new Array<boolean>(SECTIONS.length).fill(false);
  const bands = new Float32Array(SECTIONS.length * 4);
  const mobileMq = matchMedia('(max-width: 899px), (pointer: coarse)');
  const motionMq = matchMedia('(prefers-reduced-motion: reduce)');
  let mobile = mobileMq.matches;
  let animate = !motionMq.matches;
  let px = 1;

  const measure = () => {
    const y = window.scrollY;
    els.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      docTop[i] = r.top + y;
      height[i] = r.height;
    });
  };
  const resize = () => {
    mobile = mobileMq.matches;
    px = Math.min(window.devicePixelRatio || 1, MAX_DPR) * (mobile ? SCALE.mobile : SCALE.desktop);
    const w = Math.max(1, Math.round(canvas.clientWidth * px));
    const h = Math.max(1, Math.round(canvas.clientHeight * px));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    // Snap to the rounded store so CSS px map exactly onto it.
    px = canvas.width / Math.max(1, canvas.clientWidth);
    gl.uniform1f(loc.oct, mobile ? 3 : 4);
    gl.uniform1f(loc.narrow, canvas.clientWidth < 900 ? 1 : 0);
  };

  // Cursor, eased; only the playground band reads it.
  const ptr = { x: -1e4, y: -1e4, on: 0, k: 0 };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.on = 1;
  };
  const onLeave = (e: MouseEvent) => {
    if (!e.relatedTarget) ptr.on = 0;
  };

  const t0 = performance.now();
  let frame = 0;
  let last = 0;
  let firstDraw = true;
  const draw = (now: number) => {
    const y = window.scrollY;
    for (let i = 0; i < SECTIONS.length; i++) {
      const top = docTop[i]! - y;
      const visible = onScreen[i] && height[i]! > 0;
      bands[i * 4] = visible ? top : 0;
      bands[i * 4 + 1] = visible ? top + height[i]! : 0;
    }
    ptr.k += (ptr.on - ptr.k) * 0.06;
    gl.uniform2f(loc.res, canvas.width, canvas.height);
    gl.uniform1f(loc.px, px);
    gl.uniform1f(loc.time, animate ? (now - t0) / 1000 + STILL_TIME : STILL_TIME);
    gl.uniform4fv(loc.band, bands);
    gl.uniform3f(loc.ptr, ptr.x, ptr.y, ptr.k);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (firstDraw) {
      firstDraw = false;
      canvas.classList.add('is-on');
    }
  };
  const loop = (now: number) => {
    frame = 0;
    if (!animate || document.hidden || !onScreen.some(Boolean)) return;
    frame = requestAnimationFrame(loop);
    if (now - last < FRAME_MS) return;
    last = now;
    draw(now);
  };
  const kick = () => {
    if (frame) return;
    if (animate) frame = requestAnimationFrame(loop);
    else
      frame = requestAnimationFrame((now) => {
        frame = 0;
        draw(now);
      });
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = els.indexOf(e.target as HTMLElement);
      if (i >= 0) onScreen[i] = e.isIntersecting;
    }
    kick();
  });
  const ro = new ResizeObserver(() => {
    measure();
    resize();
    kick();
  });
  els.forEach((el) => {
    if (!el) return;
    io.observe(el);
    ro.observe(el);
  });
  ro.observe(canvas);
  const onScroll = () => {
    if (!animate) kick();
  };
  const onVisibility = () => {
    if (!document.hidden) kick();
  };
  const onMotion = () => {
    animate = !motionMq.matches;
    kick();
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(frame);
    frame = 0;
    root.classList.remove('has-backdrop');
    canvas.classList.remove('is-on');
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('mouseout', onLeave);
  document.addEventListener('visibilitychange', onVisibility);
  motionMq.addEventListener('change', onMotion);
  canvas.addEventListener('webglcontextlost', onLost);

  measure();
  resize();
  root.classList.add('has-backdrop');
  kick();

  return () => {
    cancelAnimationFrame(frame);
    io.disconnect();
    ro.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('mouseout', onLeave);
    document.removeEventListener('visibilitychange', onVisibility);
    motionMq.removeEventListener('change', onMotion);
    canvas.removeEventListener('webglcontextlost', onLost);
    root.classList.remove('has-backdrop');
    canvas.classList.remove('is-on');
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
  };
}

/** Software rasterisers some browsers fall back to without reporting a performance caveat. */
function isSoftware(gl: WebGLRenderingContext) {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`backdrop shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`backdrop shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
