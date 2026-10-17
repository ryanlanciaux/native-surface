/**
 * native-surface adapter: shared bits for the CSF3 stories (Storybook format,
 * read by packages/playground's CSF loader). The types are structural copies
 * of the playground's Meta/Story so this package does not depend on it.
 */
import type { ComponentType, ReactElement } from "react"
import { View } from "react-native"

import { getCatalogEntry, IgniteFrame } from "../catalog"
import type { AnyCatalogEntry } from "../catalog"

export type Args = Record<string, unknown>
export interface ArgType {
  options?: ReadonlyArray<string | number>
  labels?: Record<string, string>
  control?: "text" | "number" | "boolean" | "select" | "json" | "action" | "none"
  name?: string
  description?: string
}
export type Decorator = (Story: () => ReactElement, context: { args: Args }) => ReactElement
export interface Meta {
  title?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component?: ComponentType<any>
  args?: Args
  argTypes?: Record<string, ArgType>
  decorators?: Decorator[]
  parameters?: Record<string, unknown>
  order?: string[]
}
export interface Story {
  name?: string
  args?: Args
  argTypes?: Record<string, ArgType>
  render?: (args: Args) => ReactElement
  decorators?: Decorator[]
  parameters?: Record<string, unknown>
}

/** The component in the app's providers, inside the app's 24pt gutters. */
export const withIgnite =
  (scheme: "light" | "dark" = "light"): Decorator =>
  (Story) => (
    <IgniteFrame scheme={scheme} bleed={0}>
      <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>{Story()}</View>
    </IgniteFrame>
  )

export const light: Pick<Story, "decorators" | "parameters"> = { decorators: [withIgnite("light")], parameters: { igniteTheme: "light" } }
export const dark: Pick<Story, "decorators" | "parameters"> = { decorators: [withIgnite("dark")], parameters: { igniteTheme: "dark" } }

export function catalog(name: string): AnyCatalogEntry {
  const entry = getCatalogEntry(name)
  if (!entry) throw new Error(`ignite-demo: no catalog entry ${name}`)
  return entry
}

/** The catalog's playground knobs as CSF argTypes (top-level keys; enums become selects). */
export function argTypesFrom(entry: AnyCatalogEntry): Record<string, ArgType> {
  const out: Record<string, ArgType> = {}
  for (const [key, control] of Object.entries(entry.controls)) {
    if (key.includes(".")) continue
    if (control.type === "enum" && control.options) {
      const options = control.options.filter((o) => typeof o.value === "string" || typeof o.value === "number")
      out[key] = {
        name: control.label,
        options: options.map((o) => o.value as string | number),
        labels: Object.fromEntries(options.map((o) => [String(o.value), o.label])),
      }
    } else {
      out[key] = { name: control.label }
    }
  }
  return out
}

/** A named catalog variant's props, as story args. */
export function variantArgs(entry: AnyCatalogEntry, variant: string): Args {
  const v = entry.variants.find((x) => x.name === variant)
  if (!v) throw new Error(`ignite-demo: ${entry.name} has no variant ${variant}`)
  return v.props as Args
}
