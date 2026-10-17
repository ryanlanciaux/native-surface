/** CSF3: the generated app's DemoDebugScreen, i.e. the real app (navigators and providers) started at "DemoDebug". */
import { IgniteApp } from "../IgniteApp"
import type { Meta, Story } from "./ignite"

const meta: Meta = {
  title: "Screens/DemoDebugScreen",
  component: IgniteApp,
  args: { initialRoute: "DemoDebug", theme: "light", showStatusBar: true, onPressFavorite: () => {}, onTabChange: () => {} },
  argTypes: {
    theme: { options: ["light", "dark"] },
    initialRoute: { control: "none" },
  },
  order: ["Default", "Dark"],
  parameters: { layout: "fullscreen" },
}
export default meta

export const Default: Story = {}
export const Dark: Story = { args: { theme: "dark" } }
