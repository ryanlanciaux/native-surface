/** CSF3: the generated app's Button. Args/argTypes come from the catalog entry. */
import { Button } from "@/components/Button"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("Button")

const meta: Meta = {
  title: "Components/Button",
  component: Button,
  args: { ...entry.defaultProps, onPress: () => {} },
  argTypes: argTypesFrom(entry),
  order: ["Reversed", "Default", "Filled", "Disabled", "Dark"],
}
export default meta

export const Reversed: Story = { ...light, args: variantArgs(entry, "reversed") }
export const Default: Story = { ...light, args: variantArgs(entry, "default") }
export const Filled: Story = { ...light, args: variantArgs(entry, "filled") }
export const Disabled: Story = { ...light, args: variantArgs(entry, "disabled") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "reversed") }
