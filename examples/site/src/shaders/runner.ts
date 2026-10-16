// A minimal WebGL1 fragment-shader runner for the design's GLSL fills.
// One fullscreen triangle, `u_resolution` / `u_time` fed per frame, every
// other annotated uniform set from its @default unless overridden.

import { parseUniforms, toComponents, type UniformOverrides, type UniformSpec } from './uniforms';

const VERTEX = `attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export interface ShaderRunnerOptions {
  /** Device-pixel-ratio ceiling for the backing store. */
  maxDpr?: number;
  /** Extra downscale on top of the DPR cap (smooth fills can run below 1). */
  resolutionScale?: number;
}

export class ShaderRunner {
  readonly specs: UniformSpec[];
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer | null;
  private locations = new Map<string, WebGLUniformLocation>();
  private uResolution: WebGLUniformLocation | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private opts: Required<ShaderRunnerOptions>;

  constructor(
    readonly canvas: HTMLCanvasElement,
    source: string,
    overrides: UniformOverrides = {},
    opts: ShaderRunnerOptions = {},
  ) {
    this.opts = { maxDpr: opts.maxDpr ?? 1.5, resolutionScale: opts.resolutionScale ?? 1 };
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.specs = parseUniforms(source);
    this.program = link(gl, VERTEX, source);
    gl.useProgram(this.program);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    for (const spec of this.specs) {
      const loc = gl.getUniformLocation(this.program, spec.name);
      if (!loc) continue;
      if (spec.role === 'resolution') this.uResolution = loc;
      else if (spec.role === 'time') this.uTime = loc;
      else this.locations.set(spec.name, loc);
    }
    this.setUniforms(overrides);
  }

  setUniforms(overrides: UniformOverrides) {
    const { gl } = this;
    for (const spec of this.specs) {
      const loc = this.locations.get(spec.name);
      if (!loc || spec.type === 'sampler2D') continue;
      const value = overrides[spec.name] ?? spec.defaultValue;
      if (value === undefined) continue;
      const size = spec.type === 'float' ? 1 : Number(spec.type.slice(3));
      const c = toComponents(value, size);
      if (size === 1) gl.uniform1f(loc, c[0]!);
      else if (size === 2) gl.uniform2f(loc, c[0]!, c[1]!);
      else if (size === 3) gl.uniform3f(loc, c[0]!, c[1]!, c[2]!);
      else gl.uniform4f(loc, c[0]!, c[1]!, c[2]!, c[3]!);
    }
  }

  /** Match the backing store to the canvas' CSS box. Returns true when it changed. */
  resize(): boolean {
    const { canvas } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr) * this.opts.resolutionScale;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    this.gl.viewport(0, 0, w, h);
    return true;
  }

  draw(timeSeconds: number) {
    const { gl, canvas } = this;
    if (this.uResolution) gl.uniform2f(this.uResolution, canvas.width, canvas.height);
    if (this.uTime) gl.uniform1f(this.uTime, timeSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /**
   * Frees GPU objects but keeps the context: a canvas re-mounted under
   * StrictMode gets the same context back from getContext().
   */
  dispose() {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log}`);
  }
  return shader;
}

function link(gl: WebGLRenderingContext, vs: string, fs: string) {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
