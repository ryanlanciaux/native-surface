/**
 * Design tokens shared by the React Native components in this folder.
 * Deliberately dependency-free — plain values, no imports.
 */

export const colors = {
  brand: '#4F46E5',
  brandPressed: '#4338CA',
  danger: '#DC2626',
  dangerPressed: '#B91C1C',

  card: '#FFFFFF',
  subtle: '#F4F5F8',
  subtlePressed: '#E7E9F0',
  line: '#E4E6ED',

  ink: '#141824',
  body: '#4A5163',
  muted: '#858C9E',
  onBrand: '#FFFFFF',

  disabledBg: '#EDEFF4',
  disabledText: '#AEB4C2',

  avatarPlaceholder: '#DDE1EA',
} as const;

export const radii = {
  sm: 10,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export type ButtonVariant = 'primary' | 'secondary' | 'destructive';
