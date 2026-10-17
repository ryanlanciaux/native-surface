/**
 * native-surface adapter: stands in for `apisauce` inside app/services/api
 * (wired by `igniteDemo()` in src/vite.ts). Ignite's Api class runs unchanged;
 * its rss2json request is answered from the bundled feed instead of the
 * network. Types still come from the real apisauce package.
 */
import type { ApiResponse, ApisauceConfig } from "apisauce"

import { demoFeed } from "./feed"

const FEED_PATH = /(^|\/)api\.json(\?|$)/

function respond<T>(url: string, config: ApisauceConfig): ApiResponse<T> {
  const ok = FEED_PATH.test(url)
  const base = {
    status: ok ? 200 : 404,
    headers: {},
    config: { ...config, url },
    duration: 0,
  }
  return ok
    ? { ...base, ok: true, problem: null, originalError: null, data: demoFeed as T }
    : ({ ...base, ok: false, problem: "CLIENT_ERROR", originalError: null, data: undefined } as unknown as ApiResponse<T>)
}

export function create(config: ApisauceConfig) {
  return {
    async get<T>(url: string) {
      // A tick of latency so the list's loading state renders like a fetch.
      await new Promise((r) => setTimeout(r, 0))
      return respond<T>(url, config)
    },
  }
}
