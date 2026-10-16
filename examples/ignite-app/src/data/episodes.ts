export interface Episode {
  /** Stable id, e.g. "rnr-314". */
  guid: string;
  /** Full title as shown on the card, e.g. "RNR 314 - Shipping the New Architecture". */
  title: string;
  /** ISO date (yyyy-mm-dd). */
  pubDate: string;
  /** mm:ss or h:mm:ss. */
  duration: string;
  /** Cover art URL (bundled asset). */
  cover: string;
  description: string;
}

const cover = (name: string) => new URL(`../../assets/covers/${name}.jpg`, import.meta.url).href;

export const episodes: Episode[] = [
  {
    guid: 'rnr-314',
    title: 'RNR 314 - Shipping the New Architecture',
    pubDate: '2023-07-13',
    duration: '47:02',
    cover: cover('rnr-314'),
    description: 'Fabric, TurboModules and bridgeless mode: what it actually takes to flip the switch in a production app.',
  },
  {
    guid: 'rnr-313',
    title: 'RNR 313 - Routing with Expo Router',
    pubDate: '2023-07-06',
    duration: '52:18',
    cover: cover('rnr-313'),
    description: 'File-based routing comes to React Native. Layouts, typed routes, deep links and universal links.',
  },
  {
    guid: 'rnr-312',
    title: 'RNR 312 - Yoga, Skia and the canvas',
    pubDate: '2023-06-29',
    duration: '44:10',
    cover: cover('rnr-312'),
    description: 'The layout engine and the 2D graphics library behind modern React Native rendering.',
  },
  {
    guid: 'rnr-311',
    title: 'RNR 311 - Reanimated worklets in depth',
    pubDate: '2023-06-22',
    duration: '49:37',
    cover: cover('rnr-311'),
    description: 'UI-thread animations, shared values and why worklets are not just functions.',
  },
  {
    guid: 'rnr-310',
    title: 'RNR 310 - Hermes and the bytecode diet',
    pubDate: '2023-06-15',
    duration: '41:55',
    cover: cover('rnr-310'),
    description: 'Startup time, memory and precompiled bytecode with the Hermes engine.',
  },
  {
    guid: 'rnr-309',
    title: 'RNR 309 - Testing on real devices',
    pubDate: '2023-06-08',
    duration: '55:20',
    cover: cover('rnr-309'),
    description: 'Device farms, Maestro flows and the tests worth keeping.',
  },
];

/** Favorited on first launch (matches the design: RNR 314 shows "Unlike"). */
export const initialFavorites: readonly string[] = ['rnr-314'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2023-07-06" -> "Jul 06, 2023" (zero-padded day, as in the design). */
export function formatPubDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1] ?? m;
  return `${month} ${(d ?? '').padStart(2, '0')}, ${y}`;
}

/** "Jul 13, 2023 · 47:02" */
export function episodeMeta(episode: Pick<Episode, 'pubDate' | 'duration'>): string {
  return `${formatPubDate(episode.pubDate)} · ${episode.duration}`;
}
