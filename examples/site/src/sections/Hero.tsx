import { BatteryFull, Github, Signal, Wifi } from 'lucide-react';
import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { LINKS } from '../brand';
import { CopyCommand } from '../components/CopyCommand';
import { useOnScreen } from '../components/useOnScreen';
import { HeroDevice } from '../hero3d/HeroDevice';
import type { Pose } from '../hero3d/math';
import { HeroPhoneSlot } from '../live/HeroPhoneSlot';
import { FILLS, ShaderCanvas, perspectiveTransform } from '../shaders';
import { Nav } from './Nav';
import './hero.css';

// Node "Phone 3D": perspective3d.glsl on a 560×780 frame holding the phone at (110, 38).
const PHONE_POSE = { rotX: -6, rotY: -24, rotZ: 0, focal: 3, scale: 1 };
const FRAME = { width: 560, height: 780 };
const SCREEN_SLOT = { width: 320, height: 634 };
const pose = perspectiveTransform(PHONE_POSE, FRAME.height);
/** The design pose in CSS terms (GL y/z rotations flip sign, see shaders/perspective.ts). */
const REST: Pose = { lift: 0, rx: PHONE_POSE.rotX, ry: -PHONE_POSE.rotY, rz: -PHONE_POSE.rotZ, scale: PHONE_POSE.scale };

// Only claims that hold: layout is yoga-layout (React Native's engine) built
// to wasm, paint is Skia through CanvasKit, and the app code is unchanged.
const STATS = [
  { value: 'Yoga', label: 'layout engine, in wasm' },
  { value: '0', label: 'lines of app code changed' },
  { value: 'Skia', label: 'paint, via CanvasKit' },
];

export function Hero() {
  const deviceRef = useRef<HTMLDivElement>(null);
  const active = useOnScreen(deviceRef);
  const [painted, setPainted] = useState(false);
  const onPainted = useCallback(() => setPainted(true), []);

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

          <HeroDevice rest={REST} perspective={pose.perspective} ready={painted}>
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
              <HeroPhoneSlot {...SCREEN_SLOT} active={active} onPainted={onPainted} />
            </div>
          </HeroDevice>

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
            <span>Run React Native</span>{' '}
            <span className="hero__headline-grad">in the browser,</span>{' '}
            <span>on the same layout</span>{' '}
            <span>engine as native.</span>
          </h1>
          <p className="hero__sub">
            Your real components lay out with Yoga — React Native&rsquo;s own layout engine — compiled to
            WebAssembly, and paint through Skia into a single canvas. No simulator to boot. No web rewrite.
          </p>
          <div className="hero__ctas">
            <a className="btn-primary" href={LINKS.github} target="_blank" rel="noopener noreferrer">
              <Github size={18} strokeWidth={2} aria-hidden="true" /> View on GitHub
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
