import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { BACK_TRANSFORM, DEVICE, PHONE_BOX, buildFacets, type Facet } from './geometry';
import {
  HALF_VECTOR,
  apply,
  dot,
  hexToVec,
  light,
  poseRotation,
  rgb,
  shadeGlass,
  shadeMetal,
  type Pose,
  type Vec3,
} from './math';
import './hero3d.css';

const FRAME_METAL = hexToVec('#7d8596');
const BUTTON_METAL = hexToVec('#8a93a4');
const BACK_GLASS = hexToVec('#2b303b');
const ISLAND_GLASS = hexToVec('#343a46');

const PROBE: CSSProperties = { position: 'absolute', width: 1, height: 1, visibility: 'hidden', pointerEvents: 'none' };

/** Drives a mounted device: writes the pose vars and relights every facet. */
export interface PhoneRig {
  setPose(pose: Pose): void;
  readonly rest: Pose;
}

const rigs = new WeakMap<Element, PhoneRig>();
/** The rig of the `<Phone3D>` whose plane is (or contains) `el`. */
export function rigFor(el: Element | null | undefined): PhoneRig | undefined {
  const plane = el?.closest('.phone3d__plane');
  return plane ? rigs.get(plane) : undefined;
}

export interface Phone3DProps {
  /** Resting pose (CSS degrees). */
  rest: Pose;
  /** CSS `perspective` of the frame. */
  perspective: string;
  /** Screen content: fills the 402×874 pt glass, one bezel inside the front face. */
  children: ReactNode;
}

/**
 * The hero device as a real CSS 3D model: titanium side walls (straight runs
 * plus faceted rounded corners) with antenna bands, side buttons, a frosted
 * back plate with a raised camera island, and the live screen on the front.
 * Every facet is lit from its rotated normal on each pose change (key light
 * upper left, cyan ring bounce from below, grazing rim), and the front and
 * back gloss bands slide with the reflection, so the shading follows the
 * spin instead of being painted on.
 */
export function Phone3D({ rest, perspective, children }: Phone3DProps) {
  const planeRef = useRef<HTMLDivElement>(null);
  const facets = useMemo(() => buildFacets(), []);
  const facetEls = useRef<(HTMLSpanElement | null)[]>([]);
  const backRef = useRef<HTMLDivElement>(null);
  const backGlossRef = useRef<HTMLSpanElement>(null);
  const islandRef = useRef<HTMLSpanElement>(null);
  const islandWallRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const frontGlossRef = useRef<HTMLDivElement>(null);
  const restRef = useRef(rest);
  restRef.current = rest;

  useLayoutEffect(() => {
    const plane = planeRef.current;
    if (!plane) return;
    const setPose = (pose: Pose) => {
      plane.style.setProperty('--phone-lift', `${pose.lift}px`);
      plane.style.setProperty('--phone-rotate-x', `${pose.rx}deg`);
      plane.style.setProperty('--phone-rotate-y', `${pose.ry}deg`);
      plane.style.setProperty('--phone-rotate-z', `${pose.rz}deg`);
      plane.style.setProperty('--phone-scale', `${pose.scale}`);
      relight(pose);
    };
    const relight = (pose: Pose) => {
      const M = poseRotation(pose);
      facets.forEach((f, i) => {
        const el = facetEls.current[i];
        if (!el) return;
        const n = apply(M, f.n);
        // Facing away: culled by backface-visibility, skip the restyle.
        if (n[2] < -0.02) return;
        el.style.background = metalBackground(f, n);
      });
      const front = apply(M, [0, 0, 1]);
      slideGloss(frontGlossRef.current, front, 0.06, 0.5);
      const back: Vec3 = [-front[0], -front[1], -front[2]];
      if (back[2] > -0.02) {
        const l = light(back, 10);
        if (backRef.current) backRef.current.style.backgroundColor = rgb(shadeGlass(BACK_GLASS, l));
        if (islandRef.current) islandRef.current.style.backgroundColor = rgb(shadeGlass(ISLAND_GLASS, l), 1.04);
        slideGloss(backGlossRef.current, back, 0.03, 0.22);
        // Island rim: its walls catch the light like the frame, a touch darker.
        const rim = rgb(shadeMetal(FRAME_METAL, light(back, 24), 0.62));
        for (const el of islandWallRefs.current) if (el) el.style.backgroundColor = rim;
      }
    };
    const rig: PhoneRig = {
      setPose,
      get rest() {
        return restRef.current;
      },
    };
    rigs.set(plane, rig);
    setPose(restRef.current);
    return () => {
      rigs.delete(plane);
    };
  }, [facets]);

  const { width: W, height: H, radius: R, bezel: B, depth: D } = DEVICE;
  return (
    <div className="phone3d" style={{ perspective }} aria-hidden={false}>
      <div
        ref={planeRef}
        className="phone3d__plane"
        style={
          {
            '--phone-rotate-x': `${rest.rx}deg`,
            '--phone-rotate-y': `${rest.ry}deg`,
            '--phone-rotate-z': `${rest.rz}deg`,
            '--phone-scale': rest.scale,
            '--phone-depth': `${D}px`,
          } as CSSProperties
        }
      >
        <div
          className="phone"
          style={
            {
              ...PHONE_BOX,
              width: W,
              height: H,
              borderRadius: R,
              '--frame-radius': `${R}px`,
              '--screen-radius': `${R - B}px`,
              '--bezel': `${B}px`,
            } as CSSProperties
          }
        >
          {/* Front-face corners, for mapping pointers onto the device (dragRotate.ts). */}
          {[
            [0, 0],
            [W - 1, 0],
            [W - 1, H - 1],
            [0, H - 1],
          ].map(([left, top]) => (
            <span key={`${left},${top}`} data-phone-probe style={{ ...PROBE, left, top }} />
          ))}
          {facets.map((f, i) => (
            <span
              key={f.key}
              ref={(el) => {
                facetEls.current[i] = el;
              }}
              className="phone3d__facet"
              data-facet={f.material}
              style={{ width: f.w, height: f.h, transform: f.transform }}
            />
          ))}

          <div ref={backRef} className="phone__back" style={{ transform: BACK_TRANSFORM }} aria-hidden="true">
            <span ref={backGlossRef} className="phone__back-gloss" />
            {[0.9, 1.8, 2.7].map((z, i) => (
              <span
                key={z}
                ref={(el) => {
                  islandWallRefs.current[i] = el;
                }}
                className="phone__island-wall"
                style={{ transform: `translateZ(${z}px)` }}
              />
            ))}
            <span ref={islandRef} className="phone__camera">
              <span className="phone__lens" style={{ left: 12, top: 12 }} />
              <span className="phone__lens" style={{ left: 12, top: 76 }} />
              <span className="phone__lens" style={{ left: 74, top: 44 }} />
              <span className="phone__flash" style={{ left: 92, top: 14 }} />
              <span className="phone__lidar" style={{ left: 92, top: 108 }} />
              <span className="phone__mic" style={{ left: 79, top: 116 }} />
            </span>
            <span className="phone__back-mark" />
          </div>

          <div className="phone__body" aria-hidden="true" />
          <div className="phone__screen">{children}</div>
          <div ref={frontGlossRef} className="phone__gloss" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

/**
 * The frame strip's metal: lit colour with chamfer highlights on the front
 * and back edges (the strip's top and bottom), plus static antenna bands.
 */
function metalBackground(f: Facet, n: Vec3) {
  const base = f.material === 'button' ? BUTTON_METAL : FRAME_METAL;
  const c = shadeMetal(base, light(n, 26));
  if (f.material === 'button') return rgb(c, 1.08);
  const grad = `linear-gradient(180deg, ${rgb(c, 1.5, 0.08)} 0%, ${rgb(c, 1.12)} 11%, ${rgb(c, 0.9)} 50%, ${rgb(c, 1.04)} 87%, ${rgb(c, 1.3, 0.05)} 100%)`;
  return f.overlay ? `${f.overlay}, ${grad}` : grad;
}

/**
 * Specular band on a glass face, slid across by how far the face's normal is
 * from the light's half vector, and brightened as they line up.
 */
function slideGloss(el: HTMLElement | null, n: Vec3, floor: number, peak: number) {
  if (!el) return;
  const d = Math.max(0, dot(n, HALF_VECTOR));
  const x = 50 + (n[0] - HALF_VECTOR[0]) * 140;
  const y = 50 + (n[1] - HALF_VECTOR[1]) * 140;
  el.style.backgroundPosition = `${x.toFixed(2)}% ${y.toFixed(2)}%`;
  el.style.opacity = (floor + peak * d ** 4).toFixed(3);
}
