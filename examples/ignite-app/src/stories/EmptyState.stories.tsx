/** CSF3: the generated app's EmptyState. Args/argTypes come from the catalog entry. */
import { EmptyState } from "@/components/EmptyState"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("EmptyState")

const meta: Meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  args: { ...entry.defaultProps, preset: "generic", buttonOnPress: () => {} },
  argTypes: argTypesFrom(entry),
  order: ["Generic", "NoFavorites", "Dark"],
}
export default meta

export const Generic: Story = { ...light, args: variantArgs(entry, "generic") }
export const NoFavorites: Story = { ...light, args: variantArgs(entry, "favorites") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "generic") }
