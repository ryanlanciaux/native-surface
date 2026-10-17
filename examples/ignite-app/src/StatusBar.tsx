/**
 * native-surface adapter: an iOS-style 50pt status bar ("9:41", dynamic
 * island, signal/wifi/battery) for hosts that don't draw a device bezel.
 * Not part of the Ignite boilerplate (a device draws this itself).
 */
import { View, ViewStyle } from "react-native"
import Svg, { Path, Rect } from "react-native-svg"

import { Text } from "@/components/Text"
import { darkTheme, lightTheme } from "@/theme/theme"

export function StatusBar({ scheme = "light", showIsland = true }: { scheme?: "light" | "dark"; showIsland?: boolean }) {
  const { colors } = scheme === "dark" ? darkTheme : lightTheme
  const ink = colors.text
  return (
    <View style={$bar} pointerEvents="none">
      <Text weight="semiBold" style={{ fontSize: 14, lineHeight: 18, color: ink }} text="9:41" />
      <View style={[$island, { backgroundColor: showIsland ? "#000" : "transparent" }]} />
      <View style={$indicators}>
        <Svg width={16} height={11} viewBox="0 0 16 11">
          {[0, 1, 2, 3].map((i) => (
            <Rect key={i} x={i * 4.2} y={8 - i * 2.6} width={3} height={3 + i * 2.6} rx={0.8} fill={ink} />
          ))}
        </Svg>
        <Svg width={15} height={11} viewBox="0 0 24 18">
          <Path d="M12 17.5l3.4-3.9a5 5 0 0 0-6.8 0z" fill={ink} />
          <Path d="M5.6 11.1a9.4 9.4 0 0 1 12.8 0" stroke={ink} strokeWidth={2.6} strokeLinecap="round" fill="none" />
          <Path d="M2 7.2a14.6 14.6 0 0 1 20 0" stroke={ink} strokeWidth={2.6} strokeLinecap="round" fill="none" />
        </Svg>
        <Svg width={24} height={12} viewBox="0 0 24 12">
          <Rect x={0.6} y={0.6} width={20.8} height={10.8} rx={3} stroke={ink} strokeOpacity={0.45} strokeWidth={1.2} fill="none" />
          <Rect x={2.2} y={2.2} width={17.6} height={7.6} rx={1.8} fill={ink} />
          <Path d="M22.8 4v4a2 2 0 0 0 0-4z" fill={ink} fillOpacity={0.45} />
        </Svg>
      </View>
    </View>
  )
}

const $bar: ViewStyle = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 50,
  paddingHorizontal: 28,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
}
const $island: ViewStyle = { width: 96, height: 28, borderRadius: 14 }
const $indicators: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 5 }
