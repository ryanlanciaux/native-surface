// Single source for product naming. The design file calls the product
// "Portal"; the site ships as native-surface.
export const BRAND = {
  name: 'native-surface',
  /** Footer legal line (matches the repo LICENSE). */
  owner: 'Ryan Lanciaux',
  year: 2026,
  /** Ryan's X account, linked from the nav and footer. */
  x: { handle: '@ryanlanciaux', url: 'https://x.com/ryanlanciaux' },
  cli: 'npx native-surface playground',
  github: 'https://github.com/ryanlanciaux/native-surface',
  /** Shown in the playground window's address bar: where `npx native-surface playground` serves by default. */
  playgroundHost: 'localhost:5170',
} as const;

const repo = BRAND.github;
const base = import.meta.env.BASE_URL;

/** Real destinations only: the repo README is the docs, the rest are on-site. */
export const LINKS = {
  docs: `${repo}#readme`,
  playground: '#playground',
  surfaces: `${base}surfaces.html`,
  github: repo,
  launch: '#playground',
} as const;

/** Off-site links open in a new tab. */
export const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;
