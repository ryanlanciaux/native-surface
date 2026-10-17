/** CSF3: the generated app's Icon. Args/argTypes come from the catalog entry. */
import { Icon } from "@/components/Icon"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("Icon")

const meta: Meta = {
  title: "Components/Icon",
  component: Icon,
  args: { ...entry.defaultProps },
  argTypes: argTypesFrom(entry),
  order: ["Podcast", "Heart", "Components", "Dark"],
}
export default meta

export const Podcast: Story = { ...light, args: variantArgs(entry, "podcast") }
export const Heart: Story = { ...light, args: variantArgs(entry, "heart") }
export const Components: Story = { ...light, args: variantArgs(entry, "components") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "podcast") }
