import {
  createContext,
  FC,
  PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react"

import { translate } from "@/i18n/translate"
import { api } from "@/services/api"
import type { EpisodeItem } from "@/services/api/types"
import { formatDate } from "@/utils/formatDate"

export type EpisodeContextType = {
  totalEpisodes: number
  totalFavorites: number
  episodesForList: EpisodeItem[]
  fetchEpisodes: () => Promise<void>
  favoritesOnly: boolean
  toggleFavoritesOnly: () => void
  hasFavorite: (episode: EpisodeItem) => boolean
  toggleFavorite: (episode: EpisodeItem) => void
}

export const EpisodeContext = createContext<EpisodeContextType | null>(null)

// #region native-surface adapter
/**
 * Optional seed for hosts that embed the app (IgniteApp props, catalog and
 * story renders). Read once, on mount. Without a seed provider the boilerplate
 * behaves exactly as generated (episodes come from the Api, no favorites).
 */
export type EpisodeSeed = {
  episodes?: EpisodeItem[]
  initialFavorites?: readonly string[]
  favoritesOnly?: boolean
  onToggleFavorite?: (episode: EpisodeItem, isFavorite: boolean) => void
}

export const EpisodeSeedContext = createContext<EpisodeSeed>({})
// #endregion

export interface EpisodeProviderProps {}

export const EpisodeProvider: FC<PropsWithChildren<EpisodeProviderProps>> = ({ children }) => {
  const seed = useContext(EpisodeSeedContext) // native-surface adapter
  const seedRef = useRef(seed) // native-surface adapter
  seedRef.current = seed
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([])
  const [favorites, setFavorites] = useState<string[]>(() => [...(seed.initialFavorites ?? [])])
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(seed.favoritesOnly ?? false)

  const fetchEpisodes = useCallback(async () => {
    // native-surface adapter: a host-provided list replaces the feed.
    const seeded = seedRef.current.episodes
    if (seeded) {
      setEpisodes(seeded)
      return
    }
    const response = await api.getEpisodes()
    if (response.kind === "ok") {
      setEpisodes(response.episodes)
    } else {
      console.error(`Error fetching episodes: ${JSON.stringify(response)}`)
    }
  }, [])

  const toggleFavoritesOnly = useCallback(() => {
    setFavoritesOnly((prev) => !prev)
  }, [])

  const toggleFavorite = useCallback(
    (episode: EpisodeItem) => {
      if (favorites.some((fav) => fav === episode.guid)) {
        setFavorites((prev) => prev.filter((fav) => fav !== episode.guid))
        seedRef.current.onToggleFavorite?.(episode, false) // native-surface adapter
      } else {
        setFavorites((prev) => [...prev, episode.guid])
        seedRef.current.onToggleFavorite?.(episode, true) // native-surface adapter
      }
    },
    [favorites],
  )

  const hasFavorite = useCallback(
    (episode: EpisodeItem) => favorites.some((fav) => fav === episode.guid),
    [favorites],
  )

  const episodesForList = useMemo(() => {
    return favoritesOnly ? episodes.filter((episode) => favorites.includes(episode.guid)) : episodes
  }, [episodes, favorites, favoritesOnly])

  const value = {
    totalEpisodes: episodes.length,
    totalFavorites: favorites.length,
    episodesForList,
    fetchEpisodes,
    favoritesOnly,
    toggleFavoritesOnly,
    hasFavorite,
    toggleFavorite,
  }

  return <EpisodeContext.Provider value={value}>{children}</EpisodeContext.Provider>
}

export const useEpisodes = () => {
  const context = useContext(EpisodeContext)
  if (!context) throw new Error("useEpisodes must be used within an EpisodeProvider")
  return context
}

const pad2 = (n: number) => String(n).padStart(2, "0") // native-surface adapter

// A helper hook to extract and format episode details
export const useEpisode = (episode: EpisodeItem) => {
  const { hasFavorite } = useEpisodes()

  const isFavorite = hasFavorite(episode)

  let datePublished
  try {
    const formatted = formatDate(episode.pubDate)
    datePublished = {
      textLabel: formatted,
      accessibilityLabel: translate("demoPodcastListScreen:accessibility.publishLabel", {
        date: formatted,
      }),
    }
  } catch {
    datePublished = { textLabel: "", accessibilityLabel: "" }
  }

  const seconds = Number(episode.enclosure?.duration ?? 0)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor((seconds % 3600) % 60)
  const duration = {
    // native-surface adapter: zero-pad (upstream renders 47:02 as "47:2").
    textLabel: `${h > 0 ? `${h}:` : ""}${m > 0 || h > 0 ? `${h > 0 ? pad2(m) : m}:` : ""}${m > 0 || h > 0 ? pad2(s) : s}`,
    accessibilityLabel: translate("demoPodcastListScreen:accessibility.durationLabel", {
      hours: h,
      minutes: m,
      seconds: s,
    }),
  }

  const trimmedTitle = episode.title?.trim()
  const titleMatches = trimmedTitle?.match(/^(RNR.*\d)(?: - )(.*$)/)
  const parsedTitleAndSubtitle =
    titleMatches && titleMatches.length === 3
      ? { title: titleMatches[1], subtitle: titleMatches[2] }
      : { title: trimmedTitle, subtitle: "" }

  return {
    isFavorite,
    datePublished,
    duration,
    parsedTitleAndSubtitle,
  }
}
