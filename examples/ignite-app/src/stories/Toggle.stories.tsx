/** CSF3: Ignite's Toggle family (Switch / Checkbox / Radio), value kept live. Args/argTypes come from the catalog entry. */
import { LiveToggle } from "../catalog"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("Toggle")

const meta: Meta = {
  title: "Components/Toggle",
  component: LiveToggle,
  args: { ...entry.defaultProps, onValueChange: () => {} },
  argTypes: argTypesFrom(entry),
  order: ["SwitchOff", "SwitchOn", "Checkbox", "Radio", "Dark"],
}
export default meta

export const SwitchOff: Story = { ...light, args: variantArgs(entry, "off") }
export const SwitchOn: Story = { ...light, args: variantArgs(entry, "on") }
export const Checkbox: Story = { ...light, args: variantArgs(entry, "checkbox") }
export const Radio: Story = { ...light, args: variantArgs(entry, "radio") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "off") }
