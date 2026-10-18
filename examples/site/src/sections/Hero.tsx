import { device } from 'ignite-demo';
import { BatteryFull, Github, Signal, Wifi } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { EXTERNAL, LINKS } from '../brand';
import { CopyCommand } from '../components/CopyCommand';
import { useOnScreen } from '../components/useOnScreen';
import { HeroDevice } from '../hero3d/HeroDevice';
import type { Pose } from '../hero3d/math';
import { HeroPhoneSlot } from '../live/HeroPhoneSlot';
import { perspectiveTransform } from '../shaders';
import { Nav } from './Nav';
import './hero.css';

// Node "Phone 3D": perspective3d.glsl on a 560×780 frame holding the phone at (110, 38).
const PHONE_POSE = { rotX: -6, rotY: -24, rotZ: 0, focal: 3, scale: 1 };
const FRAME = { width: 560, height: 780 };
/** The app's slot: the whole iPhone 16 Pro screen, at its true logical size. */
const SCREEN_SLOT = { width: device.screenWidth, height: device.screenHeight };
const pose = perspectiveTransform(PHONE_POSE, FRAME.height);
/**
 * Resting pose: face-on (Ryan; supersedes the design's three-quarter tilt,
 * which the intro still lands in, see hero3d/intro.ts LAND_TILT).
 */
const REST: Pose = { lift: 0, rx: 0, ry: 0, rz: 0, scale: PHONE_POSE.scale };

// Only claims that hold: layout is yoga-layout (React Native's engine) built
// to wasm, paint is Skia through CanvasKit. The stock Ignite app needed edits
// in 8 files under app/ (see examples/ignite-app/NATIVE-SURFACE.md), so no
// "0 lines changed" stat.
const STATS = [
  { value: 'Yoga', label: 'layout, in wasm' },
  { value: 'Skia', label: 'paint, via CanvasKit' },
  { value: 'Ignite', label: 'demo app, running live' },
];

function IgniteLink() {
  return (
    <a className="inline-link" href={LINKS.ignite} {...EXTERNAL}>
      Ignite
    </a>
  );
}

const HINT_KEY = 'ns-hero-rotate-hint';
function hintSeen() {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function Hero() {
  const deviceRef = useRef<HTMLDivElement>(null);
  const active = useOnScreen(deviceRef);
  const [painted, setPainted] = useState(false);
  const onPainted = useCallback(() => setPainted(true), []);
  // The rotate hint fades out on the first drag / lock and stays gone.
  const [hint, setHint] = useState(() => !hintSeen());
  const onInteract = useCallback(() => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Storage blocked: dismissed for this page load only.
    }
  }, []);

  return (
    <section className="hero" id="top">
      <div className="hero__stage">
        <Nav />

        <div className="hero__device" ref={deviceRef}>
          <div className="hero__shadow" aria-hidden="true" />

          <HeroDevice rest={REST} perspective={pose.perspective} ready={painted} onInteract={onInteract}>
            <div className="phone__app">
              <HeroPhoneSlot {...SCREEN_SLOT} active={active} onPainted={onPainted} />
            </div>
            <div className="phone__status" style={{ height: device.safeAreaInsets.top }}>
              <span className="phone__time">9:41</span>
              <span
                className="phone__island"
                style={{ width: device.island.width, height: device.island.height, top: device.island.top }}
              />
              <span className="phone__indicators" aria-hidden="true">
                <Signal size={17} strokeWidth={2} />
                <Wifi size={17} strokeWidth={2} />
                <BatteryFull size={17} strokeWidth={2} />
              </span>
            </div>
            <span className="phone__home" aria-hidden="true" />
          </HeroDevice>

          <p className="hero__caption">
            <span className="live-dot" />
            {/* One inline run, so the link isn't split off as its own flex item. */}
            <span>
              LIVE{'  ·  '}
              <IgniteLink /> demo app, laid out and painted in WebAssembly
            </span>
          </p>
          <p className={`hero__hint${hint ? '' : ' is-dismissed'}`} aria-hidden="true">
            {'drag the frame to rotate  ·  double-tap the frame to lock'}
          </p>
        </div>

        <div className="hero__copy">
          <h1 className="hero__headline">
            <span>Run React Native</span>{' '}
            <span>
              in the browser<span className="hero__stop">.</span>
            </span>
          </h1>
          {/* The rest of the old headline, as a dek; phones get the shorter subhead instead. */}
          <p className="hero__dek">Same layout engine as native.</p>
          <p className="hero__sub hero__sub--mob">
            Same Yoga layout engine as React Native on iOS and Android, in WebAssembly.
          </p>
          <p className="hero__sub hero__sub--desk">
            Your React Native components, laid out by Yoga and painted by Skia, both compiled to WebAssembly.
            Yoga is the layout engine React Native uses on iOS and Android. No simulator to boot. No web rewrite.
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
                <dt>{s.value === 'Ignite' ? <IgniteLink /> : s.value}</dt>{' '}
                <dd>{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
