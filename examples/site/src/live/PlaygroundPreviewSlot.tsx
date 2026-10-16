import { IgniteEpisodeCard } from './placeholder/Ignite';
import type { PlaygroundPreviewSlotProps } from './types';

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
};

/**
 * The component under test in the playground canvas. The shell owns the
 * window chrome, state pills, timing caption, code drawer and props panel,
 * and passes the current props down.
 */
export function PlaygroundPreviewSlot({
  width,
  state,
  episode,
  isFavorite,
  theme,
  onPressFavorite,
}: PlaygroundPreviewSlotProps) {
  const favorited = state === 'favorited' || isFavorite;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${episode.title}: ${favorited ? 'unlike' : 'like'}`}
      onClick={() => onPressFavorite({ guid: guidOf(episode.cover) })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPressFavorite({ guid: guidOf(episode.cover) });
        }
      }}
      style={{ cursor: 'pointer', borderRadius: 16, boxShadow: '0 24px 60px #000000b0' }}
    >
      <IgniteEpisodeCard
        episode={{ meta: `${fmtDate(episode.pubDate)} · ${episode.duration}`, title: episode.title, cover: episode.cover }}
        favorited={favorited}
        pressed={state === 'pressed'}
        dark={theme === 'dark'}
        style={{ width }}
      />
    </div>
  );
}

const guidOf = (cover: string) => cover.replace(/\.\w+$/, '');
