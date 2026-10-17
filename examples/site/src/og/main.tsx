// 1200×630 social card, captured by og/capture.mjs into public/og-image.png.
// Built from the site's own pieces: the hero shader fill, fonts, logo mark,
// headline gradient, and a real capture of the hero phone (passed in as
// window.__ogPhone, a PNG data URL).
import { createRoot } from 'react-dom/client';
import { BRAND } from '../brand';
import { Mark } from '../components/Brand';
import { FILLS, ShaderCanvas } from '../shaders';
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

const fill = { ...FILLS.hero, uniforms: { ...FILLS.hero.uniforms, u_focusX: 0.78, u_focusY: 0.5, u_horizon: 0.16 } };

function OgCard() {
  return (
    <div className="og">
      <ShaderCanvas className="shader-fill" {...fill} still maxDpr={2} />
      <div className="og__brand">
        <Mark />
        <span>{BRAND.name}</span>
      </div>
      <h1 className="og__headline">
        <span>Run React Native</span>
        <span className="og__grad">in the browser,</span>
        <span>on the same layout</span>
        <span>engine as native.</span>
      </h1>
      <div className="og__pad" aria-hidden="true" />
      {window.__ogPhone && <img className="og__phone" src={window.__ogPhone} alt="" onLoad={markReady} />}
    </div>
  );
}

async function markReady() {
  await document.fonts.ready;
  requestAnimationFrame(() => requestAnimationFrame(() => (window.__ogReady = true)));
}

createRoot(document.getElementById('root')!).render(<OgCard />);
