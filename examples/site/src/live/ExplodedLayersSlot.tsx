import type { CSSProperties, ReactElement } from 'react';
import {
  Layer,
  LayerCardBody,
  LayerFavButton,
  LayerHeading,
  LayerScreen,
  LayerTabBar,
  LayerToggle,
} from './ExplodedContent';
import { LiveSurface } from './LiveSurface';
import { PlaceholderLayer } from './placeholder/PlaceholderLayer';
import { useMobile } from './useMobile';
import type { ExplodedLayersSlotProps, LayerItem } from './types';

/** Card shadow room (radius 8 at y+8), as the catalog's EpisodeCard bleed. */
const CARD_BLEED = 24;

/**
 * Content of one exploded layer plane (340×704, design coordinates): one live
 * surface per component instance, positioned on the shell's item rects. The
 * shell owns the plane, its 3D pose, outline, thickness, callouts and leaders.
 *
 * The planes overlap (980² frames), so the slot root stays
 * `pointer-events: none` and only each surface box opts back in.
 */
export function ExplodedLayersSlot({ layer, items, width, height }: ExplodedLayersSlotProps) {
  // Mobile crops the stack to a small still; the live components move to the
  // callout list there (ExplodedListSlot), which keeps the WebGL count down.
  const mobile = useMobile();
  if (mobile) return <PlaceholderLayer layer={layer} items={items} width={width} height={height} />;
  const list: LayerItem[] = layer === 'screen' ? [{ id: 'screen', x: 10, y: 10, width: 320 }] : items;
  return (
    <div style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none' }}>
      {list.map((item) => {
        const spec = surfaceFor(layer, item);
        return (
          <LiveSurface
            key={item.id}
            width={spec.width}
            height={spec.height}
            interactive={layer !== 'screen'}
            style={{ position: 'absolute', left: item.x - spec.bleed, top: item.y - spec.bleed }}
            canvasStyle={spec.canvasStyle}
          >
            {spec.content}
          </LiveSurface>
        );
      })}
    </div>
  );
}

interface SurfaceSpec {
  width: number;
  height: number;
  bleed: number;
  content: ReactElement;
  canvasStyle?: CSSProperties;
}

function surfaceFor(layer: ExplodedLayersSlotProps['layer'], item: LayerItem): SurfaceSpec {
  const p = item.props ?? {};
  switch (layer) {
    case 'heading':
      return { width: 272, height: 68, bleed: 0, content: <Layer><LayerHeading color={p.color as string} /></Layer> };
    case 'toggle':
      return { width: 272, height: 33, bleed: 0, content: <Layer><LayerToggle labelColor={p.labelColor as string} /></Layer> };
    case 'buttons':
      // Wide enough for "Unlike" (88) so a tap can grow the pill in place.
      return { width: 96, height: 32, bleed: 0, content: <Layer><LayerFavButton favorited={!!p.favorited} /></Layer> };
    case 'cards':
      return {
        width: 272 + 2 * CARD_BLEED,
        height: 96 + 2 * CARD_BLEED,
        bleed: CARD_BLEED,
        content: <Layer pad={CARD_BLEED}><LayerCardBody index={(p.index as number) ?? 0} /></Layer>,
      };
    case 'tabbar':
      return {
        width: 320,
        height: 75,
        bleed: 0,
        content: <Layer><LayerTabBar /></Layer>,
        canvasStyle: { borderRadius: '0 0 48px 48px' },
      };
    case 'screen':
      return {
        width: 320,
        height: 684,
        bleed: 0,
        content: <Layer><LayerScreen /></Layer>,
        canvasStyle: { borderRadius: 48 },
      };
  }
}
