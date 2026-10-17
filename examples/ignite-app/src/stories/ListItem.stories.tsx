/** CSF3: the generated app's ListItem. Args/argTypes come from the catalog entry. */
import { ListItem } from "@/components/ListItem"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("ListItem")

const meta: Meta = {
  title: "Components/ListItem",
  component: ListItem,
  args: { ...entry.defaultProps, onPress: () => {} },
  argTypes: argTypesFrom(entry),
  order: ["Icons", "Plain", "Separators", "Dark"],
}
export default meta

export const Icons: Story = { ...light, args: variantArgs(entry, "icons") }
export const Plain: Story = { ...light, args: variantArgs(entry, "plain") }
export const Separators: Story = { ...light, args: variantArgs(entry, "separators") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "icons") }
