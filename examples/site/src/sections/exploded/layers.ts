// Geometry of the "Layer Stack" node (1440×1120): seven 980×980 frames, each
// running perspective3d.glsl over one 340×704 plane, stacked 98 px apart;
// callouts, leader lines and anchors sit flat on top.
import type { ExplodedLayerId, LayerItem } from '../../live/types';
import type { PerspectiveParams } from '../../shaders';

export const STACK = { width: 1440, height: 1120 };
export const FRAME = 980;
export const PLANE = { width: 340, height: 704, x: 320, y: 138 };
export const POSE: PerspectiveParams = { rotX: 52, rotY: 0, rotZ: -34, focal: 3.2, scale: 1.22 };

/** An opaque rect on a plane that gets the shader's thickness. */
export interface Solid {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number | string;
}

export interface LayerSpec {
  id: ExplodedLayerId | 'device';
  /** Frame top in stack coordinates (frames all sit at x = 230). */
  top: number;
  depth: number;
  edge: string;
  gloss: number;
  /** Outline-only planes are the design's #22D3EE08 sheets with a #22D3EE42 rim. */
  sheet: boolean;
  items: LayerItem[];
  solids: Solid[];
}

const EDGE = '#B9B0AB';
const CARD_H = 96;

export const LAYERS: LayerSpec[] = [
  {
    id: 'device',
    top: 338,
    depth: 16,
    edge: '#7C8596',
    gloss: 0.08,
    sheet: false,
    items: [],
    solids: [{ x: 0, y: 0, width: 340, height: 704, radius: 58 }],
  },
  {
    id: 'screen',
    top: 240,
    depth: 8,
    edge: EDGE,
    gloss: 0.08,
    sheet: false,
    items: [],
    solids: [{ x: 10, y: 10, width: 320, height: 684, radius: 48 }],
  },
  {
    id: 'tabbar',
    top: 142,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [{ id: 'tabbar', x: 10, y: 620, width: 320 }],
    solids: [{ x: 10, y: 620, width: 320, height: 74, radius: '0 0 48px 48px' }],
  },
  {
    id: 'cards',
    top: 44,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [0, 1, 2].map((index) => ({ id: `card-${index}`, x: 34, y: 204 + 148 * index, width: 272, props: { index } })),
    solids: [0, 1, 2].map((i) => ({ x: 34, y: 204 + 148 * i, width: 272, height: CARD_H, radius: 16 })),
  },
  {
    id: 'buttons',
    top: -54,
    depth: 7,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [
      { id: 'button-0', x: 48, y: 292, props: { favorited: true } },
      { id: 'button-1', x: 48, y: 440 },
      { id: 'button-2', x: 48, y: 588 },
    ],
    solids: [
      { x: 48, y: 292, width: 88, height: 32, radius: 17 },
      { x: 48, y: 440, width: 74, height: 32, radius: 17 },
      { x: 48, y: 588, width: 74, height: 32, radius: 17 },
    ],
  },
  {
    id: 'toggle',
    top: -152,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [{ id: 'toggle', x: 34, y: 156, props: { labelColor: '#F4F2F1', trackColor: '#4A4F5C' } }],
    solids: [{ x: 254, y: 156, width: 52, height: 30, radius: 15 }],
  },
  {
    id: 'heading',
    top: -250,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [{ id: 'heading', x: 34, y: 70, props: { color: '#F4F2F1' } }],
    solids: [],
  },
];

export interface Callout {
  component: string;
  meta: string;
  side: 'left' | 'right';
  /** Callout box origin (stack coordinates). */
  x: number;
  y: number;
  /** Leader line: x, y (centre line), width. */
  leader: [number, number, number];
  /** Anchor dot top-left. */
  anchor: [number, number];
}

export const CALLOUTS: Callout[] = [
  { component: '<Text preset="heading" />', meta: 'wasm · 3.8 kb · i18n ready', side: 'left', x: 40, y: 12, leader: [356, 35.5, 404], anchor: [763, 31] },
  { component: '<Toggle variant="switch" />', meta: 'wasm · 6.4 kb · controlled', side: 'right', x: 1060, y: 252, leader: [963, 275.5, 81], anchor: [950, 271] },
  { component: '<Button />', meta: 'wasm · 5.1 kb · press = Skia repaint', side: 'left', x: 40, y: 337, leader: [356, 360.5, 269], anchor: [628, 356] },
  { component: '<EpisodeCard />', meta: 'Card + AutoImage · 12.9 kb', side: 'right', x: 1060, y: 611, leader: [817, 634.5, 227], anchor: [804, 630] },
  { component: '<Screen preset="scroll" />', meta: 'safe areas · Yoga layout', side: 'right', x: 1060, y: 740, leader: [926, 763.5, 118], anchor: [913, 759] },
  { component: '<DemoNavigator />', meta: 'bottom tabs · react-navigation', side: 'left', x: 40, y: 828, leader: [356, 851.5, 83], anchor: [442, 847] },
  { component: 'Device frame', meta: 'iPhone 16 Pro · 393 × 852 @3x', side: 'right', x: 1060, y: 1021, leader: [756, 1044.5, 288], anchor: [743, 1040] },
];
