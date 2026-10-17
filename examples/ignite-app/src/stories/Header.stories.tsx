/** CSF3: the generated app's Header. Args/argTypes come from the catalog entry. */
import { Header } from "@/components/Header"

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("Header")

const meta: Meta = {
  title: "Components/Header",
  component: Header,
  args: { ...entry.defaultProps, safeAreaEdges: [], onLeftPress: () => {}, onRightPress: () => {} },
  argTypes: argTypesFrom(entry),
  order: ["Icons", "RightText", "Flex", "Dark"],
}
export default meta

export const Icons: Story = { ...light, args: variantArgs(entry, "icons") }
export const RightText: Story = { ...light, args: variantArgs(entry, "text") }
export const Flex: Story = { ...light, args: variantArgs(entry, "flex") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "icons") }
