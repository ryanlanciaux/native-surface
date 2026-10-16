/**
 * Ignite-style theme. Palette names follow Ignite's boilerplate
 * (neutral / primary / angry); values come from the design file
 * (untitled.pen: Device/Phone + Ignite/* components).
 */
export const palette = {
  neutral100: '#FFFFFF',
  neutral200: '#F4F2F1',
  neutral300: '#D7CEC9',
  neutral400: '#B6ACA6',
  neutral500: '#978F8A',
  neutral600: '#564E4A',
  neutral700: '#3C3836',
  neutral800: '#191015',
  neutral900: '#000000',

  primary100: '#F4E0D9',
  primary200: '#E8C1B4',
  primary300: '#DDA28E',
  primary400: '#D28468',
  primary500: '#C76542',
  primary600: '#A54F31',

  secondary100: '#DCDDE9',
  secondary300: '#9196B9',
  secondary500: '#41476E',

  angry100: '#F2D6CD',
  angry500: '#C03403',
} as const;

export const colors = {
  palette,
  transparent: 'rgba(0, 0, 0, 0)',
  /** Default text. */
  text: palette.neutral800,
  /** Secondary text (episode meta, helpers). */
  textDim: palette.neutral600,
  /** App/screen background. */
  background: palette.neutral200,
  /** Card / tab bar surface. */
  surface: palette.neutral100,
  /** Hairlines, card + button strokes, switch track (off). */
  border: palette.neutral300,
  /** Active tab, favorited heart, switch track (on). */
  tint: palette.primary500,
  /** Subtle tint fill (favorited FavButton). */
  tintSubtle: palette.primary100,
  /** Tint stroke (favorited FavButton). */
  tintBorder: palette.primary300,
  /** Text on a tint-subtle fill. */
  tintText: palette.primary600,
  separator: palette.neutral300,
  error: palette.angry500,
  errorBackground: palette.angry100,
  /** Card drop shadow (#1910150F in the design). */
  shadow: palette.neutral800,
} as const;

/** Space Grotesk, registered as one family; weight selects the face. */
export const typography = {
  family: 'Space Grotesk',
  weights: {
    normal: '400',
    medium: '500',
    semiBold: '600',
    bold: '700',
  },
} as const;

export const spacing = {
  xxxs: 2,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  card: 16,
  pill: 17,
  track: 15,
  field: 8,
} as const;

/** Phone screen inside the Device/Phone frame (340x704 minus 10px bezel). */
export const device = {
  frameWidth: 340,
  frameHeight: 704,
  bezel: 10,
  screenWidth: 320,
  screenHeight: 684,
  screenRadius: 48,
  frameRadius: 58,
  statusBarHeight: 50,
} as const;

export const theme = { colors, palette, typography, spacing, radii, device } as const;
export type Theme = typeof theme;
