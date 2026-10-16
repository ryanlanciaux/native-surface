/**
 * native-surface adapter (types only). expo-font is not installed: at bundle
 * time the native-surface Vite preset aliases it to @native-surface/compat's
 * expo shim, which accepts the same sources. This declares the slice of the
 * real expo-font API the Ignite boilerplate uses, typed as upstream does
 * (a font module is a Metro asset id, i.e. a number, under RN's typings).
 */
declare module "expo-font" {
  export type FontSource = string | number | { uri: string } | { default?: string }
  export function useFonts(map: Record<string, FontSource>): [boolean, Error | null]
  export function loadAsync(
    fontFamilyOrFontMap: string | Record<string, FontSource>,
    source?: FontSource,
  ): Promise<void>
  export function isLoaded(fontFamily: string): boolean
}
