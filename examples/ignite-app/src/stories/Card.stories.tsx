/** CSF3: the generated app's Card. Args/argTypes come from the catalog entry. */
import { Card } from "@/components/Card"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("Card")

const meta: Meta = {
  title: "Components/Card",
  component: Card,
  args: { ...entry.defaultProps },
  argTypes: argTypesFrom(entry),
  order: ["Default", "Reversed", "Dark"],
}
export default meta

export const Default: Story = { ...light, args: variantArgs(entry, "default") }
export const Reversed: Story = { ...light, args: variantArgs(entry, "reversed") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "default") }
