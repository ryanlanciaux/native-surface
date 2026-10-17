/**
 * Real iPhone screens in logical points. The app always renders at a phone's
 * true logical size with its safe-area insets; hosts that need it smaller
 * scale the whole device with a CSS transform, never the viewport.
 */
export interface IPhone {
  id: string
  label: string
  screenWidth: number
  screenHeight: number
  /** Safe area: status bar / Dynamic Island on top, home indicator below. */
  safeAreaInsets: { top: number; bottom: number }
  /** Display corner radius (0 on home-button devices). */
  screenRadius: number
  /** Dynamic Island pill (absent on older devices). */
  island?: { width: number; height: number; top: number }
}

export const iphones = {
  "iphone-16-pro": {
    id: "iphone-16-pro",
    label: "iPhone 16 Pro",
    screenWidth: 402,
    screenHeight: 874,
    safeAreaInsets: { top: 62, bottom: 34 },
    screenRadius: 62,
    island: { width: 126, height: 37, top: 11 },
  },
  "iphone-16-pro-max": {
    id: "iphone-16-pro-max",
    label: "iPhone 16 Pro Max",
    screenWidth: 440,
    screenHeight: 956,
    safeAreaInsets: { top: 62, bottom: 34 },
    screenRadius: 62,
    island: { width: 126, height: 37, top: 11 },
  },
  "iphone-16": {
    id: "iphone-16",
    label: "iPhone 16 / 15",
    screenWidth: 393,
    screenHeight: 852,
    safeAreaInsets: { top: 59, bottom: 34 },
    screenRadius: 55,
    island: { width: 126, height: 37, top: 11 },
  },
  "iphone-se": {
    id: "iphone-se",
    label: "iPhone SE",
    screenWidth: 375,
    screenHeight: 667,
    safeAreaInsets: { top: 20, bottom: 0 },
    screenRadius: 0,
  },
} as const satisfies Record<string, IPhone>

/** Bezel around the glass, in points (body = screen + 2 × bezel). */
const BEZEL = 12

const phone = iphones["iphone-16-pro"]

/**
 * The default device, iPhone 16 Pro: 402×874 pt screen (safe area 62 top for
 * the Dynamic Island, 34 bottom for the home indicator, 62 pt display
 * radius) in a 426×898 body with a 12 pt bezel.
 */
export const device = {
  id: phone.id,
  label: phone.label,
  screenWidth: phone.screenWidth,
  screenHeight: phone.screenHeight,
  safeAreaInsets: phone.safeAreaInsets,
  screenRadius: phone.screenRadius,
  island: phone.island,
  bezel: BEZEL,
  frameWidth: phone.screenWidth + 2 * BEZEL,
  frameHeight: phone.screenHeight + 2 * BEZEL,
  frameRadius: phone.screenRadius + BEZEL,
  /** Height of the host-drawn status bar (= the top safe-area inset). */
  statusBarHeight: phone.safeAreaInsets.top,
} as const
