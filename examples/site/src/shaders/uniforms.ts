// Parses the design tool's uniform annotations out of a GLSL source:
//
//   /**
//    * @label Glow A
//    * @color
//    * @default #22D3EE
//    */
//   uniform vec3 u_glowA;
//
// `@resolution` and `@time` mark the uniforms the runner feeds every frame.

export type UniformValue = number | string | readonly number[];
export type UniformOverrides = Record<string, UniformValue>;

export interface UniformSpec {
  name: string;
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'sampler2D';
  label?: string;
  role?: 'resolution' | 'time';
  isColor: boolean;
  defaultValue?: UniformValue;
  range?: [number, number];
}

const DECL = /(?:\/\*\*([\s\S]*?)\*\/\s*)?uniform\s+(float|vec2|vec3|vec4|sampler2D)\s+(\w+)\s*;/g;

export function parseUniforms(source: string): UniformSpec[] {
  const specs: UniformSpec[] = [];
  for (const match of source.matchAll(DECL)) {
    const doc = match[1] ?? '';
    const spec: UniformSpec = {
      type: match[2] as UniformSpec['type'],
      name: match[3]!,
      isColor: /@color\b/.test(doc),
    };
    if (/@resolution\b/.test(doc)) spec.role = 'resolution';
    if (/@time\b/.test(doc)) spec.role = 'time';
    const label = doc.match(/@label\s+(.+)/);
    if (label) spec.label = label[1]!.trim();
    const def = doc.match(/@default\s+(\S+)/);
    if (def) spec.defaultValue = def[1]!.startsWith('#') ? def[1]! : Number(def[1]);
    const range = doc.match(/@range\s+(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    if (range) spec.range = [Number(range[1]), Number(range[2])];
    specs.push(spec);
  }
  return specs;
}

/** `#RRGGBB` / `#RRGGBBAA` → linear 0..1 components (alpha dropped for vec3). */
export function hexToRgb(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
}

export function toComponents(value: UniformValue, size: number): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return hexToRgb(value).slice(0, size);
  return [...value].slice(0, size);
}
