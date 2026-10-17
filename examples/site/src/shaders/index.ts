// Shader fills used by the landing page, with the uniform values the design
// file sets on each node (the shader @defaults cover everything else).
import nebulaGrid from './nebula-grid.glsl?raw';
import dotgrid from './dotgrid.glsl?raw';
import flowDots from './flow-dots.glsl?raw';
import type { UniformOverrides } from './uniforms';

export { ShaderCanvas } from './ShaderCanvas';
export { ShaderRunner } from './runner';
export { parseUniforms } from './uniforms';
export { perspectiveTransform, glossGradient, type PerspectiveParams } from './perspective';

export const SHADERS = { nebulaGrid, dotgrid, flowDots } as const;

const NEBULA_BASE = { u_base: '#06070A', u_glowA: '#22D3EE', u_glowB: '#8B5CF6' };

export const FILLS = {
  /** Hero (node "Hero"): nebula focused behind the phone, grid on the bottom fifth. */
  hero: {
    source: nebulaGrid,
    uniforms: { ...NEBULA_BASE, u_focusX: 0.72, u_focusY: 0.45, u_horizon: 0.2, u_grid: 1, u_nebula: 1 },
  },
  /** "Exploded View" section background: flow-field dot grid, its own look next to the hero's nebula. */
  exploded: {
    source: flowDots,
    uniforms: { u_base: '#06070A', u_dot: '#1B2130', u_glowA: '#22D3EE', u_glowB: '#8B5CF6', u_spacing: 28 },
    maxDpr: 1.25,
    pointer: true,
  },
  /** "Final CTA" horizon grid. */
  cta: {
    source: nebulaGrid,
    uniforms: { ...NEBULA_BASE, u_focusX: 0.5, u_focusY: 0.5, u_horizon: 0.3, u_grid: 1, u_nebula: 0.9 },
  },
  /** Playground canvas ("Canvas" node). */
  playground: {
    source: dotgrid,
    uniforms: { u_bg: '#0B0D12', u_dot: '#232937', u_glow: '#22D3EE', u_spacing: 22 },
  },
} satisfies Record<string, { source: string; uniforms: UniformOverrides; maxDpr?: number; pointer?: boolean }>;
