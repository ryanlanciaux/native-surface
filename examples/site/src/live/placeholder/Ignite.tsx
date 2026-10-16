// Static DOM stand-ins for the Ignite components (design 04). The live lane
// replaces these with NativeSurfaces; they exist so the page reads correctly
// before that and as a no-WebGL fallback.
import { Bug, Component, Heart, Podcast, Users } from 'lucide-react';
import type { CSSProperties } from 'react';
import './ignite.css';

const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export const COVERS: Record<string, string> = {
  'rnr-314.png': asset('images/cover-2.png'),
  'rnr-313.png': asset('images/cover-3.png'),
  'rnr-312.png': asset('images/cover-4.png'),
};

export function IgniteHeading({ color, style }: { color?: string; style?: CSSProperties }) {
  return (
    <div className="ig-heading" style={{ color, ...style }}>
      React Native Radio episodes
    </div>
  );
}

export function IgniteToggle({
  labelColor,
  trackColor,
  style,
}: {
  labelColor?: string;
  trackColor?: string;
  style?: CSSProperties;
}) {
  return (
    <div className="ig-toggle" style={style}>
      <span style={{ color: labelColor }}>Only Show Favorites</span>
      <span className="ig-toggle__track" style={{ background: trackColor }}>
        <span className="ig-toggle__knob" />
      </span>
    </div>
  );
}

export function IgniteFavButton({ favorited, style }: { favorited?: boolean; style?: CSSProperties }) {
  return (
    <span className={`ig-fav${favorited ? ' is-fav' : ''}`} style={style}>
      <Heart size={14} strokeWidth={2} />
      {favorited ? 'Unlike' : 'Like'}
    </span>
  );
}

export interface IgniteEpisode {
  meta: string;
  title: string;
  cover: string;
}

export const EPISODES: IgniteEpisode[] = [
  { meta: 'Jul 13, 2023 · 47:02', title: 'RNR 314 - Shipping the New Architecture', cover: 'rnr-314.png' },
  { meta: 'Jul 06, 2023 · 52:18', title: 'RNR 313 - Routing with Expo Router', cover: 'rnr-313.png' },
  { meta: 'Jun 29, 2023 · 44:10', title: 'RNR 312 - Yoga, Skia and the canvas', cover: 'rnr-312.png' },
];

export function IgniteEpisodeCard({
  episode,
  favorited,
  showButton = true,
  pressed,
  dark,
  style,
}: {
  episode: IgniteEpisode;
  favorited?: boolean;
  showButton?: boolean;
  pressed?: boolean;
  dark?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div className={`ig-card${pressed ? ' is-pressed' : ''}${dark ? ' is-dark' : ''}`} style={style}>
      <div className="ig-card__content">
        <div className="ig-card__meta">{episode.meta}</div>
        <div className="ig-card__title">{episode.title}</div>
        {showButton && (
          <>
            <div style={{ width: 4, height: 4 }} />
            <IgniteFavButton favorited={favorited} />
          </>
        )}
      </div>
      <img className="ig-card__cover" src={COVERS[episode.cover] ?? episode.cover} alt="" draggable={false} />
    </div>
  );
}

const TABS = [
  { label: 'Components', Icon: Component },
  { label: 'Community', Icon: Users },
  { label: 'Podcasts', Icon: Podcast, active: true },
  { label: 'Debug', Icon: Bug },
];

export function IgniteTabBar({ style }: { style?: CSSProperties }) {
  return (
    <div className="ig-tabs" style={style}>
      {TABS.map(({ label, Icon, active }) => (
        <div key={label} className={`ig-tabs__tab${active ? ' is-active' : ''}`}>
          <Icon size={22} strokeWidth={2} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
