// Geometry of the "Layer Stack" node (1440×1120): seven 980×980 frames, each
// running perspective3d.glsl over one phone plane, stacked 98 px apart;
// callouts, leader lines and anchors sit flat on top.
//
// A plane is an iPhone 16 Pro in points (426×898 body, 12 pt bezel, 402×874
// screen with 62/34 safe areas), scaled to the design's 340×704 footprint
// centred in the frame. Items keep the design's spots on that footprint (so
// the callout anchors still land on them) but are laid out at true size.
import { device } from 'ignite-demo';
import type { ExplodedLayerId, LayerItem } from '../../live/types';
import type { PerspectiveParams } from '../../shaders';

export const STACK = { width: 1440, height: 1120 };
export const FRAME = 980;
const FOOTPRINT = { width: 340, height: 704 };
const SCALE = FOOTPRINT.height / device.frameHeight;
export const PLANE = {
  width: device.frameWidth,
  height: device.frameHeight,
  radius: device.frameRadius,
  x: (FRAME - device.frameWidth) / 2,
  y: (FRAME - device.frameHeight) / 2,
  /** Plane px → frame px (x/y only: the extrusion depths stay in frame px). */
  scale: SCALE,
};
/** The glass on a plane. */
export const GLASS = { x: device.bezel, y: device.bezel, width: device.screenWidth, height: device.screenHeight, radius: device.screenRadius };
const GUTTER = 24;
/** Content column: the screen minus the app's 24 pt gutters (354 pt). */
const COL = { x: GLASS.x + GUTTER, width: GLASS.width - 2 * GUTTER };
/** Ignite's bottom tabs: 49 pt of tabs over the 34 pt home-indicator inset. */
const TABBAR_H = 49 + device.safeAreaInsets.bottom;
/** Design y on the 704-tall footprint → plane y. */
const y = (designY: number) => Math.round(designY / SCALE);
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
  /** Outline-only planes: a faint neutral sheet with a hairline rim (exploded.css .xl-sheet). */
  sheet: boolean;
  items: LayerItem[];
  solids: Solid[];
}

const EDGE = '#B9B0AB';
const CARD_H = 96;
/** Like buttons at the design's spots; each card sits around its button. */
const BUTTON_Y = [292, 440, 588].map(y);
const CARD_Y = BUTTON_Y.map((b) => b - 88);
const TOGGLE = { width: 52, height: 30 };

export const LAYERS: LayerSpec[] = [
  {
    id: 'device',
    top: 338,
    depth: 16,
    edge: '#7C8596',
    gloss: 0.08,
    sheet: false,
    items: [],
    solids: [{ x: 0, y: 0, width: PLANE.width, height: PLANE.height, radius: PLANE.radius }],
  },
  {
    id: 'screen',
    top: 240,
    depth: 8,
    edge: EDGE,
    gloss: 0.08,
    sheet: false,
    items: [],
    solids: [GLASS],
  },
  {
    id: 'tabbar',
    top: 142,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [{ id: 'tabbar', x: GLASS.x, y: GLASS.y + GLASS.height - TABBAR_H, width: GLASS.width }],
    solids: [
      {
        x: GLASS.x,
        y: GLASS.y + GLASS.height - TABBAR_H,
        width: GLASS.width,
        height: TABBAR_H,
        radius: `0 0 ${GLASS.radius}px ${GLASS.radius}px`,
      },
    ],
  },
  {
    id: 'cards',
    top: 44,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: CARD_Y.map((cy, index) => ({ id: `card-${index}`, x: COL.x, y: cy, width: COL.width, props: { index } })),
    solids: CARD_Y.map((cy) => ({ x: COL.x, y: cy, width: COL.width, height: CARD_H, radius: 16 })),
  },
  {
    id: 'buttons',
    top: -54,
    depth: 7,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: BUTTON_Y.map((by, i) => ({ id: `button-${i}`, x: COL.x + 14, y: by, ...(i === 0 && { props: { favorited: true } }) })),
    solids: BUTTON_Y.map((by, i) => ({ x: COL.x + 14, y: by, width: i === 0 ? 88 : 74, height: 32, radius: 17 })),
  },
  {
    id: 'toggle',
    top: -152,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [{ id: 'toggle', x: COL.x, y: y(156), width: COL.width, props: { labelColor: '#F4F2F1', trackColor: '#4A4F5C' } }],
    solids: [{ x: COL.x + COL.width - TOGGLE.width, y: y(156), ...TOGGLE, radius: TOGGLE.height / 2 }],
  },
  {
    id: 'heading',
    top: -250,
    depth: 6,
    edge: EDGE,
    gloss: 0,
    sheet: true,
    items: [{ id: 'heading', x: COL.x, y: y(70), width: COL.width, props: { color: '#F4F2F1' } }],
    solids: [],
  },
];

export interface Callout {
  component: string;
  /** The layer it labels; it draws in as that layer settles. */
  layer: LayerSpec['id'];
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
  { component: '<Text preset="heading" />', layer: 'heading', meta: 'theme presets · i18n via tx', side: 'left', x: 40, y: 12, leader: [356, 35.5, 404], anchor: [763, 31] },
  { component: '<Switch />', layer: 'toggle', meta: 'Ignite Toggle · controlled', side: 'right', x: 1060, y: 252, leader: [963, 275.5, 81], anchor: [950, 271] },
  { component: '<Button />', layer: 'buttons', meta: 'press = Skia repaint', side: 'left', x: 40, y: 337, leader: [356, 360.5, 269], anchor: [628, 356] },
  { component: '<EpisodeCard />', layer: 'cards', meta: 'Card + Image · bundled cover art', side: 'right', x: 1060, y: 611, leader: [817, 634.5, 227], anchor: [804, 630] },
  { component: '<Screen preset="fixed" />', layer: 'screen', meta: 'safe areas · Yoga layout', side: 'right', x: 1060, y: 740, leader: [926, 763.5, 118], anchor: [913, 759] },
  { component: '<DemoNavigator />', layer: 'tabbar', meta: 'bottom tabs · react-navigation', side: 'left', x: 40, y: 828, leader: [356, 851.5, 83], anchor: [442, 847] },
  { component: 'Device frame', layer: 'device', meta: 'iPhone 16 Pro · 402 × 874 @3x', side: 'right', x: 1060, y: 1021, leader: [756, 1044.5, 288], anchor: [743, 1040] },
];
