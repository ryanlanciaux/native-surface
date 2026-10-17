/**
 * native-surface adapter: a bundled, fictional podcast feed standing in for the
 * one the Ignite demo fetches from rss2json, so the app runs offline. Same
 * `ApiFeedResponse` shape the boilerplate's Api class parses. "Lanternfish
 * Radio", its hosts and episodes are made up for the demo (not a real show);
 * dates, durations and covers follow the site design (03.png). Links point at
 * example.com, which never resolves to a real episode.
 */
import type { ApiFeedResponse, EpisodeItem } from "@/services/api/types"

const cover = (n: number) => new URL(`../../assets/covers/ep-${n}.jpg`, import.meta.url).href

/**
 * Ignite's EpisodeItem, plus the previous hand-built app's `cover` and
 * `duration` ("47:02") fields so existing hosts keep reading them.
 */
export type DemoEpisode = EpisodeItem & { cover: string; duration: string }

const label = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

const episode = (
  n: number,
  subtitle: string,
  pubDate: string,
  duration: number,
  description: string,
): DemoEpisode => ({
  title: `LFR ${n} - ${subtitle}`,
  pubDate: `${pubDate} 09:00:00`,
  link: `https://example.com/lanternfish-radio/lfr-${n}`,
  guid: `lfr-${n}`,
  author: "Mara Quill and Theo Brandt",
  thumbnail: cover(n),
  description,
  content: description,
  enclosure: {
    link: `https://example.com/lanternfish-radio/lfr-${n}`,
    type: "audio/mpeg",
    length: duration * 16000,
    duration,
    rating: { scheme: "urn:itunes", value: "no" },
  },
  categories: [],
  cover: cover(n),
  duration: label(duration),
})

const mmss = (m: number, s: number) => m * 60 + s

export const demoEpisodes: DemoEpisode[] = [
  episode(314, "Shipping the New Architecture", "2023-07-13", mmss(47, 2),
    "Fabric, TurboModules and bridgeless mode: what it takes to flip the switch in a production app."),
  episode(313, "Routing with Expo Router", "2023-07-06", mmss(52, 18),
    "File-based routing comes to React Native: layouts, typed routes, deep links and universal links."),
  episode(312, "Yoga, Skia and the canvas", "2023-06-29", mmss(44, 10),
    "The layout engine and the 2D graphics library behind modern React Native rendering."),
  episode(311, "Reanimated worklets in depth", "2023-06-22", mmss(49, 37),
    "UI-thread animations, shared values and why worklets are not just functions."),
  episode(310, "Hermes and the bytecode diet", "2023-06-15", mmss(41, 55),
    "Startup time, memory and precompiled bytecode with the Hermes engine."),
  episode(309, "Testing on real devices", "2023-06-08", mmss(55, 20),
    "Device farms, Maestro flows and the tests worth keeping."),
]

/** Favorited on first launch (the design shows episode 314 with "Unlike"). */
export const demoInitialFavorites: readonly string[] = ["lfr-314"]

export const demoFeed: ApiFeedResponse = {
  status: "ok",
  feed: {
    url: "https://example.com/lanternfish-radio/feed.xml",
    title: "Lanternfish Radio",
    link: "https://example.com/lanternfish-radio",
    author: "Mara Quill and Theo Brandt",
    description: "A made-up show about building apps, for the demo.",
    image: cover(314),
  },
  items: demoEpisodes,
}
