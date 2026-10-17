// Single source for product naming. The design file calls the product
// "Portal"; the site ships as native-surface.
export const BRAND = {
  name: 'native-surface',
  /** Footer legal line. */
  owner: 'native-surface contributors',
  year: 2026,
  tagline: 'React Native components, rendered for the open web.',
  cli: 'npx native-surface playground',
  github: 'https://github.com/ryanlanciaux/native-surface',
  /** Shown in the playground window's address bar: where `npx native-surface playground` serves by default. */
  playgroundHost: 'localhost:5170',
} as const;

const repo = BRAND.github;
const base = import.meta.env.BASE_URL;

/** Where the design's nav/footer labels point. Pricing etc. have no destination yet. The repo has tags but no GitHub Releases. */
export const LINKS = {
  docs: `${repo}#readme`,
  playground: '#playground',
  showcase: `${base}surfaces.html`,
  releases: `${repo}/tags`,
  github: repo,
  cli: `${repo}/tree/main/packages/playground#readme`,
  compat: `${repo}/tree/main/packages/compat#readme`,
  issues: `${repo}/issues`,
  launch: '#playground',
} as const;
