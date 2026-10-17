import { catalogSurfaceSize, getCatalogEntry } from 'ignite-demo';
import { LiveSurface } from './LiveSurface';
import { useMobile } from './useMobile';

/** Callout (as written in the exploded view) → catalog entry + variant. */
const LIVE: Record<string, { name: string; variant?: string }> = {
  '<Text preset="heading" />': { name: 'Heading' },
  '<Toggle variant="switch" />': { name: 'Toggle', variant: 'off' },
  '<Button />': { name: 'FavButton', variant: 'unlike' },
  '<EpisodeCard />': { name: 'EpisodeCard', variant: 'favorited' },
  '<DemoNavigator />': { name: 'TabBar', variant: 'podcasts' },
};

/**
 * Mobile only: the exploded stack is a cropped still at 390, so the callout
 * list underneath carries the live, tappable components instead.
 */
export function ExplodedListSlot({ component }: { component: string }) {
  const mobile = useMobile();
  const spec = LIVE[component];
  const entry = spec && getCatalogEntry(spec.name);
  if (!mobile || !entry) return null;
  const variant = entry.variants.find((v) => v.name === spec.variant);
  const size = catalogSurfaceSize(entry);
  return (
    <div className="live-xl-item">
      <LiveSurface width={size.width} height={size.height}>
        {entry.render(variant?.props, { bleed: true })}
      </LiveSurface>
    </div>
  );
}
