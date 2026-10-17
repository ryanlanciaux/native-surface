/** CSF3: the podcast list's EpisodeCard (from DemoPodcastListScreen) inside its EpisodeProvider. Args/argTypes come from the catalog entry. */
import { LiveEpisodeCard } from "../catalog"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("EpisodeCard")

const meta: Meta = {
  title: "Components/EpisodeCard",
  component: LiveEpisodeCard,
  args: { ...entry.defaultProps, onPressFavorite: () => {} },
  argTypes: { ...argTypesFrom(entry), episode: { control: "json", description: "An EpisodeItem from the feed (title, pubDate, enclosure.duration, thumbnail)." } },
  order: ["Default", "Favorited", "Pressed", "Dark"],
}
export default meta

export const Default: Story = { ...light, args: variantArgs(entry, "default") }
export const Favorited: Story = { ...light, args: variantArgs(entry, "favorited") }
export const Pressed: Story = { ...light, args: variantArgs(entry, "pressed") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "default") }
