/**
 * native-surface adapter: app/app.tsx's startup work (custom fonts, i18n,
 * date-fns locale), shared by every embedded instance and done once per page.
 */
import { useEffect, useState } from "react"
import { loadAsync } from "expo-font"

import { initI18n } from "@/i18n"
import { customFontsToLoad } from "@/theme/typography"
import { loadDateFnsLocale } from "@/utils/formatDate"

let fonts: Promise<void> | null = null
let i18n: Promise<void> | null = null
let ready = false

/** Registers Ignite's Space Grotesk faces with the engine (expo-font's loadAsync). */
export function loadIgniteFonts(): Promise<void> {
  fonts ??= loadAsync(customFontsToLoad)
  return fonts
}

/** Fonts + i18n + date-fns locale: everything app.tsx waits for before rendering. */
export function loadIgnite(): Promise<void> {
  i18n ??= initI18n().then(() => loadDateFnsLocale())
  return Promise.all([loadIgniteFonts(), i18n]).then(() => {
    ready = true
  })
}

export function isIgniteReady(): boolean {
  return ready
}

/** `[loaded, error]`, like expo-font's useFonts. */
export function useIgniteFonts(): [boolean, Error | null] {
  const [state, setState] = useState<[boolean, Error | null]>([false, null])
  useEffect(() => {
    let alive = true
    loadIgniteFonts().then(
      () => alive && setState([true, null]),
      (e: Error) => alive && setState([false, e]),
    )
    return () => {
      alive = false
    }
  }, [])
  return state
}

/** True once loadIgnite() has settled (synchronously true after the first time). */
export function useIgniteReady(): boolean {
  const [ok, setOk] = useState(ready)
  useEffect(() => {
    if (ok) return
    let alive = true
    loadIgnite().then(
      () => alive && setOk(true),
      (e) => {
        console.error("ignite-demo: startup failed", e)
        if (alive) setOk(true)
      },
    )
    return () => {
      alive = false
    }
  }, [ok])
  return ok
}
