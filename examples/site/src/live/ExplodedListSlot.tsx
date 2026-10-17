import type { ReactElement } from 'react';
import { EPISODES, IgniteEpisodeCard, IgniteFavButton, IgniteHeading, IgniteTabBar, IgniteToggle } from './placeholder/Ignite';

/** Callout (as written in the exploded view) → static art of that component. */
const ART: Record<string, () => ReactElement> = {
  '<Text preset="heading" />': () => <IgniteHeading />,
  '<Switch />': () => <IgniteToggle />,
  '<Button />': () => <IgniteFavButton favorited />,
  '<EpisodeCard />': () => <IgniteEpisodeCard episode={EPISODES[0]!} favorited />,
  '<DemoNavigator />': () => <IgniteTabBar />,
};

/**
 * Mobile callout list: the exploded stack has no room for callouts at 390,
 * so each list entry shows its component as static art (no WebGL).
 */
export function ExplodedListSlot({ component }: { component: string }) {
  const art = ART[component];
  return art ? <div className="xl-list-art">{art()}</div> : null;
}
