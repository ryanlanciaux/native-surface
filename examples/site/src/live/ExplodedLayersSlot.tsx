import { EPISODES, IgniteEpisodeCard, IgniteFavButton, IgniteHeading, IgniteToggle } from './placeholder/Ignite';
import type { ExplodedLayersSlotProps, LayerItem } from './types';

const BASE = import.meta.env.BASE_URL;

/**
 * Content of one exploded layer plane (340×704, design coordinates). The
 * shell owns the plane, its 3D pose, outline, thickness, callouts and
 * leaders; this only paints the components placed on it.
 */
export function ExplodedLayersSlot({ layer, items, width, height }: ExplodedLayersSlotProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, width, height, pointerEvents: 'none' }}>
      {items.map((item) => (
        <div key={item.id} style={{ position: 'absolute', left: item.x, top: item.y, width: item.width }}>
          {renderItem(layer, item)}
        </div>
      ))}
    </div>
  );
}

function renderItem(layer: ExplodedLayersSlotProps['layer'], item: LayerItem) {
  const p = item.props ?? {};
  switch (layer) {
    case 'heading':
      return <IgniteHeading color={p.color as string} />;
    case 'toggle':
      return <IgniteToggle labelColor={p.labelColor as string} trackColor={p.trackColor as string} />;
    case 'buttons':
      return <IgniteFavButton favorited={!!p.favorited} />;
    case 'cards':
      return <IgniteEpisodeCard episode={EPISODES[(p.index as number) ?? 0]!} showButton={false} style={{ width: item.width }} />;
    case 'tabbar':
      return (
        <img
          src={`${BASE}placeholders/ignite-TabBar.png`}
          alt=""
          width={320}
          height={75}
          draggable={false}
          style={{ display: 'block', borderRadius: '0 0 48px 48px' }}
        />
      );
    case 'screen':
      return null;
  }
}
