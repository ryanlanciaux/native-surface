/**
 * native-surface adapter: the React Native Radio feed the Ignite demo fetches
 * from rss2json (`api.json?rss_url=…simplecast…`), bundled so the app runs
 * offline. Same `ApiFeedResponse` shape the boilerplate's Api class parses;
 * titles, dates, durations and covers follow the site design (03.png).
 */
import type { ApiFeedResponse, EpisodeItem } from "@/services/api/types"

const cover = (n: number) => new URL(`../../assets/covers/rnr-${n}.jpg`, import.meta.url).href

const episode = (
  n: number,
  subtitle: string,
  pubDate: string,
  duration: number,
  description: string,
): EpisodeItem => ({
  title: `RNR ${n} - ${subtitle}`,
  pubDate: `${pubDate} 09:00:00`,
  link: `https://reactnativeradio.com/episodes/rnr-${n}`,
  guid: `rnr-${n}`,
  author: "Infinite Red",
  thumbnail: cover(n),
  description,
  content: description,
  enclosure: {
    link: `https://reactnativeradio.com/episodes/rnr-${n}`,
    type: "audio/mpeg",
    length: duration * 16000,
    duration,
    rating: { scheme: "urn:itunes", value: "no" },
  },
  categories: [],
})

const mmss = (m: number, s: number) => m * 60 + s

export const rnrEpisodes: EpisodeItem[] = [
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

/** Favorited on first launch (the design shows RNR 314 with "Unlike"). */
export const rnrInitialFavorites: readonly string[] = ["rnr-314"]

export const rnrFeed: ApiFeedResponse = {
  status: "ok",
  feed: {
    url: "https://feeds.simplecast.com/hEI_f9Dx",
    title: "React Native Radio",
    link: "https://reactnativeradio.com",
    author: "Infinite Red",
    description: "Exploring React Native together.",
    image: cover(314),
  },
  items: rnrEpisodes,
}
