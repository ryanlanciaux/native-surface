import { ArrowRight, BatteryFull, Signal, Wifi } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { LINKS } from '../brand';
import { CopyCommand } from '../components/CopyCommand';
import { Extrusion } from '../components/Extrusion';
import { useOnScreen } from '../components/useOnScreen';
import { HeroPhoneSlot } from '../live/HeroPhoneSlot';
import { FILLS, ShaderCanvas, glossGradient, perspectiveTransform } from '../shaders';
import { Nav } from './Nav';
import './hero.css';

// Node "Phone 3D": perspective3d.glsl on a 560×780 frame holding the phone at (110, 38).
const PHONE_POSE = { rotX: -6, rotY: -24, rotZ: 0, focal: 3, scale: 1 };
const FRAME = { width: 560, height: 780 };
const PHONE = { width: 340, height: 704 };
const SCREEN_SLOT = { width: 320, height: 634 };
// The plane's transform reads CSS custom properties (--phone-rotate-*, --phone-lift,
// --phone-scale) so an intro animation can drive the pose; see hero.css.
const pose = perspectiveTransform(PHONE_POSE, FRAME.height);
const gloss = glossGradient(0.16, PHONE.width, PHONE.height, FRAME.width, FRAME.height);

const STATS = [
  { value: '60fps', label: 'native-speed render' },
  { value: '0', label: 'lines of code changed' },
  { value: 'Expo + bare', label: 'both supported' },
];

export function Hero() {
  const deviceRef = useRef<HTMLDivElement>(null);
  const active = useOnScreen(deviceRef);

  return (
    <section className="hero" id="top">
      <ShaderCanvas className="shader-fill" {...FILLS.hero} />
      <div className="hero__stage">
        <Nav />
        <div className="hero__fade" aria-hidden="true" />

        <div className="hero__device" ref={deviceRef}>
          <div className="hero__aura" aria-hidden="true" />
          <span className="hero__trail" style={{ left: 158, height: 300, '--trail': '#22D3EE66' } as CSSProperties} />
          <span className="hero__trail" style={{ left: 282, height: 220, '--trail': '#22D3EE44' } as CSSProperties} />
          <span className="hero__trail" style={{ left: 396, height: 260, '--trail': '#22D3EE55' } as CSSProperties} />
          <div className="hero__pad" aria-hidden="true" />
          <div className="hero__pad-glow" aria-hidden="true" />

          <div className="phone3d" style={{ perspective: pose.perspective }}>
            <div
              className="phone3d__plane"
              style={
                {
                  '--phone-rotate-x': `${PHONE_POSE.rotX}deg`,
                  '--phone-rotate-y': `${-PHONE_POSE.rotY}deg`,
                  '--phone-rotate-z': `${-PHONE_POSE.rotZ}deg`,
                  '--phone-scale': PHONE_POSE.scale,
                } as CSSProperties
              }
            >
              <div className="phone">
                <Extrusion depth={18} edge="#8C95A6" rim="#22D3EE" radius={58} slices={9} />
                <div className="phone__body" />
                <div className="phone__screen">
                  <div className="phone__status">
                    <span className="phone__time">9:41</span>
                    <span className="phone__island" />
                    <span className="phone__indicators" aria-hidden="true">
                      <Signal size={15} strokeWidth={2} />
                      <Wifi size={15} strokeWidth={2} />
                      <BatteryFull size={15} strokeWidth={2} />
                    </span>
                  </div>
                  <div className="phone__app">
                    <HeroPhoneSlot {...SCREEN_SLOT} active={active} />
                  </div>
                </div>
                <div className="phone__gloss" style={{ background: gloss }} aria-hidden="true" />
              </div>
            </div>
          </div>

          <p className="hero__caption">
            <span className="live-dot" />
            LIVE{'  ·  '}Ignite demo app, running in WebAssembly
          </p>
        </div>

        <div className="hero__copy">
          <p className="chip-eyebrow">
            <span className="chip-eyebrow__dot" />
            {'REACT NATIVE  →  WEBASSEMBLY'}
          </p>
          <h1 className="hero__headline">
            <span>Run your</span>
            <span>React Native app</span>
            <span className="hero__headline-grad">in the browser.</span>
          </h1>
          <p className="hero__sub">
            Your real components, compiled to WebAssembly and running live in any tab. No simulator to boot. No
            web rewrite. Share a link and your app just opens.
          </p>
          <div className="hero__ctas">
            <a className="btn-primary" href={LINKS.launch}>
              Launch your app <ArrowRight size={18} strokeWidth={2} />
            </a>
            <CopyCommand />
          </div>
          <dl className="hero__proof">
            {STATS.map((s) => (
              <div key={s.value}>
                <dt>{s.value}</dt>
                <dd>{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
