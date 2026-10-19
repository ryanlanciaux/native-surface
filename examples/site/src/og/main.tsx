// 1200×630 social card, captured by og/capture.mjs into public/og-v2.png.
// Built from the site's own pieces: the hero band of the page backdrop shader
// (src/backdrop/backdrop.glsl, frozen at the reduced-motion clock), fonts,
// logo mark, the hero headline with its lime full stop, the phone subhead,
// and a real capture of the hero phone (passed in as window.__ogPhone, a PNG
// data URL).
import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import source from '../backdrop/backdrop.glsl?raw';
import { BRAND } from '../brand';
import { Mark } from '../components/Brand';
import '../styles/fonts';
import '../styles/tokens.css';
import '../styles/global.css';
import './og.css';

declare global {
  interface Window {
    __ogPhone?: string;
    __ogReady?: boolean;
  }
}

const W = 1200;
const H = 630;
const DPR = 2;
/** Backdrop.tsx STILL_TIME: the frame reduced-motion visitors see. */
const STILL_TIME = 24;
const VERTEX = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

/** One frame of the backdrop's hero effect (band 0) filling the card. */
function HeroBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })!;
    gl.getExtension('OES_standard_derivatives');
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(String(gl.getShaderInfoLog(s)));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, source));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const bands = new Float32Array(24);
    bands[1] = H; // hero band covers the card; the others stay off
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u('u_res'), canvas.width, canvas.height);
    gl.uniform1f(u('u_px'), DPR);
    gl.uniform1f(u('u_time'), STILL_TIME);
    gl.uniform4fv(u('u_band'), bands);
    gl.uniform3f(u('u_ptr'), -1e4, -1e4, 0);
    gl.uniform1f(u('u_oct'), 4);
    gl.uniform1f(u('u_narrow'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.dataset.ready = 'true';
  }, []);
  return <canvas ref={ref} className="og__bg" aria-hidden="true" />;
}

function OgCard() {
  return (
    <div className="og">
      <HeroBackdrop />
      <div className="og__brand">
        <Mark />
        <span>{BRAND.name}</span>
      </div>
      <div className="og__copy">
        {/* Hero.tsx .hero__headline, and the subhead phones show (.hero__sub--mob). */}
        <h1 className="og__headline">
          <span>Run React Native</span>
          <span>
            in the browser<span className="og__stop">.</span>
          </span>
        </h1>
        <p className="og__sub">Same Yoga layout engine as React Native on iOS and Android, in WebAssembly.</p>
      </div>
      <p className="og__url">ryanlanciaux.com/native-surface</p>
      <div className="og__shadow" aria-hidden="true" />
      {window.__ogPhone && <img className="og__phone" src={window.__ogPhone} alt="" onLoad={markReady} />}
    </div>
  );
}

async function markReady() {
  await document.fonts.ready;
  requestAnimationFrame(() => requestAnimationFrame(() => (window.__ogReady = true)));
}

createRoot(document.getElementById('root')!).render(<OgCard />);
