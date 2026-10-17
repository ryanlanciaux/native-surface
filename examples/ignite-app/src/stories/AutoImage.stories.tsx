/** CSF3: the generated app's AutoImage. Args/argTypes come from the catalog entry. */
import { AutoImage } from "@/components/AutoImage"

/** AutoImage with the source flattened to one `uri` arg for the knobs. */
function AutoImageStory({ uri, ...props }: { uri: string; maxWidth?: number; maxHeight?: number }) {
  return <AutoImage {...props} source={{ uri }} />
}

import { argTypesFrom, catalog, dark, light, variantArgs } from "./ignite"
import type { Meta, Story } from "./ignite"

const entry = catalog("AutoImage")

const meta: Meta = {
  title: "Components/AutoImage",
  component: AutoImageStory,
  args: { ...entry.defaultProps },
  argTypes: argTypesFrom(entry),
  order: ["MaxWidth", "MaxHeight", "Dark"],
}
export default meta

export const MaxWidth: Story = { ...light, args: variantArgs(entry, "maxWidth") }
export const MaxHeight: Story = { ...light, args: variantArgs(entry, "maxHeight") }
export const Dark: Story = { ...dark, args: variantArgs(entry, "maxWidth") }
