/** CSF3: Ignite's TextField, text kept live. Args/argTypes come from the catalog entry. */
import { LiveTextField } from "../catalog"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("TextField")

const meta: Meta = {
  title: "Components/TextField",
  component: LiveTextField,
  args: { ...entry.defaultProps, onChangeText: () => {} },
  argTypes: argTypesFrom(entry),
  order: ["Default", "Filled", "Error", "Disabled", "Dark"],
}
export default meta

export const Default: Story = { ...light, args: variantArgs(entry, "default") }
export const Filled: Story = { ...light, args: variantArgs(entry, "filled") }
export const Error: Story = { ...light, args: variantArgs(entry, "error") }
export const Disabled: Story = { ...light, args: variantArgs(entry, "disabled") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "default") }
