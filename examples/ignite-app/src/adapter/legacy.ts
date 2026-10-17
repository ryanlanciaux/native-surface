/**
 * native-surface adapter: accepts the hand-built app's episode shape (the
 * `episodes` prop hosts already pass) and maps it onto Ignite's EpisodeItem.
 */
import type { EpisodeItem } from "@/services/api/types"

export interface LegacyEpisode {
  guid: string
  title: string
  /** yyyy-mm-dd */
  pubDate: string
  /** mm:ss or h:mm:ss */
  duration: string
  cover: string
  description?: string
}

const seconds = (d: string) => d.split(":").reduce((acc, part) => acc * 60 + Number(part || 0), 0)

export function toEpisodeItem(e: EpisodeItem | LegacyEpisode): EpisodeItem {
  if ("enclosure" in e) return e
  return {
    title: e.title,
    pubDate: /^\d{4}-\d{2}-\d{2}$/.test(e.pubDate) ? `${e.pubDate} 09:00:00` : e.pubDate,
    link: "",
    guid: e.guid,
    author: "",
    thumbnail: e.cover,
    description: e.description ?? "",
    content: e.description ?? "",
    enclosure: {
      link: "",
      type: "audio/mpeg",
      length: 0,
      duration: seconds(e.duration),
      rating: { scheme: "urn:itunes", value: "no" },
    },
    categories: [],
  }
}
