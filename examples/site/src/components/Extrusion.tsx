import type { CSSProperties } from 'react';

/**
 * perspective3d.glsl's "Thickness": the plane's opaque content extruded
 * `depth` px away from the viewer, lit from the upper left, with the rim
 * colour bleeding in near the front face. Rendered as stacked slices inside
 * a preserve-3d parent; each slice copies the silhouette rect it sits under.
 */
export function Extrusion({
  depth,
  edge,
  rim,
  radius,
  slices = Math.max(3, Math.round(depth / 2)),
  style,
}: {
  depth: number;
  edge: string;
  rim: string;
  radius: CSSProperties['borderRadius'];
  slices?: number;
  style?: CSSProperties;
}) {
  const [er, eg, eb] = rgb(edge);
  const [rr, rg, rb] = rgb(rim);
  return (
    <>
      {Array.from({ length: slices }, (_, i) => {
        const h = (i + 1) / slices;
        const ridge = 0.7 + 0.4 * Math.sin(h * Math.PI);
        const rimMix = Math.pow(1 - h, 5) * 0.45;
        const shade = (lit: number) =>
          `rgb(${c(er * lit * ridge + rr * rimMix)} ${c(eg * lit * ridge + rg * rimMix)} ${c(eb * lit * ridge + rb * rimMix)})`;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: radius,
              background: `linear-gradient(145deg, ${shade(1)} 0%, ${shade(0.55)} 50%, ${shade(0.18)} 100%)`,
              transform: `translateZ(${-depth * h}px)`,
              ...style,
            }}
          />
        );
      })}
    </>
  );
}

const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}
