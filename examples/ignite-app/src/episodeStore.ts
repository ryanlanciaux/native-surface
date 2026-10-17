/**
 * native-surface adapter: one name for the generated app's episode store.
 * Ignite 11 keeps episodes in React context (app/context/EpisodeContext.tsx);
 * the screens read it with `useEpisodes()` and like/unlike through
 * `toggleFavorite(episode)`:
 *
 *   const { episodesForList, toggleFavorite, favoritesOnly, toggleFavoritesOnly } = episodeStore.use()
 *   <EpisodeCard episode={episode} onPressFavorite={() => toggleFavorite(episode)} />
 */
import { EpisodeProvider, EpisodeSeedContext, useEpisode, useEpisodes } from "@/context/EpisodeContext"

export const episodeStore = {
  /** Wraps the screens that share the store (DemoNavigator does this in the app). */
  Provider: EpisodeProvider,
  /** Optional seed: episodes, initial favorites, a toggle callback. */
  Seed: EpisodeSeedContext.Provider,
  /** `{ episodesForList, totalFavorites, toggleFavorite, hasFavorite, favoritesOnly, toggleFavoritesOnly, fetchEpisodes }` */
  use: useEpisodes,
  /** Per-episode view data: isFavorite, formatted date / duration, title + subtitle. */
  useEpisode,
} as const
