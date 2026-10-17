import { device } from 'ignite-demo';
import type { ReactNode } from 'react';
import { EPISODES, IgniteEpisodeCard, IgniteFavButton, IgniteHeading, IgniteTabBar, IgniteToggle } from './placeholder/Ignite';
import type { ExplodedLayersSlotProps, LayerItem } from './types';

/** App ink on the screen; the exploded planes float over the dark stage. */
const APP_INK = '#191015';
const APP_TRACK = '#D7CEC9';

/**
 * Content of one exploded layer plane (iPhone 16 Pro points, 426×898): static
 * DOM art of the Ignite components on the shell's item rects. Static on
 * purpose: the section animates the planes in 3D, and art costs no WebGL
 * contexts (the live components are in the hero and the playground).
 *
 * Copy that the design recolours for the dark stage (heading, toggle) is
 * drawn twice: `.xl-ink--flat` as it looks on the app screen and
 * `.xl-ink--lifted` as designed; the section cross-fades them as the plane
 * lifts off the phone.
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

function Inked({ flat, lifted }: { flat: ReactNode; lifted: ReactNode }) {
  return (
    <>
      <div className="xl-ink xl-ink--flat">{flat}</div>
      <div className="xl-ink xl-ink--lifted">{lifted}</div>
    </>
  );
}

function renderItem(layer: ExplodedLayersSlotProps['layer'], item: LayerItem) {
  const p = item.props ?? {};
  switch (layer) {
    case 'heading':
      return (
        <Inked
          flat={<IgniteHeading color={APP_INK} style={{ width: item.width }} />}
          lifted={<IgniteHeading color={p.color as string} style={{ width: item.width }} />}
        />
      );
    case 'toggle':
      return (
        <Inked
          flat={<IgniteToggle labelColor={APP_INK} trackColor={APP_TRACK} style={{ width: item.width }} />}
          lifted={<IgniteToggle labelColor={p.labelColor as string} trackColor={p.trackColor as string} style={{ width: item.width }} />}
        />
      );
    case 'buttons':
      return <IgniteFavButton favorited={!!p.favorited} />;
    case 'cards':
      return <IgniteEpisodeCard episode={EPISODES[(p.index as number) ?? 0]!} showButton={false} style={{ width: item.width }} />;
    case 'tabbar':
      return <IgniteTabBar style={{ width: item.width, paddingBottom: device.safeAreaInsets.bottom, borderRadius: `0 0 ${device.screenRadius}px ${device.screenRadius}px` }} />;
    case 'screen':
      return null;
  }
}
