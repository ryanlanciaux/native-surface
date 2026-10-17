/** CSF3: the generated app's Text. Args/argTypes come from the catalog entry. */
import { Text } from "@/components/Text"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("Text")

const meta: Meta = {
  title: "Components/Text",
  component: Text,
  args: { ...entry.defaultProps },
  argTypes: argTypesFrom(entry),
  order: ["Heading", "Subheading", "Default", "Bold", "Dark"],
}
export default meta

export const Heading: Story = { ...light, args: variantArgs(entry, "heading") }
export const Subheading: Story = { ...light, args: variantArgs(entry, "subheading") }
export const Default: Story = { ...light, args: variantArgs(entry, "default") }
export const Bold: Story = { ...light, args: variantArgs(entry, "bold") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "heading") }
