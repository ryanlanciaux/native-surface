#!/usr/bin/env node
// Shared helpers for scripts/site/*.mjs
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const DEFAULT_URL = 'http://localhost:4870/native-surface/';
export const DEFAULT_DESKTOP = { width: 1440, height: 900 };
export const DEFAULT_MOBILE = { width: 390, height: 844 };

const ORCHESTRATOR_WORK = '/home/ryan/projects/wasm-playground-site/work';
const SYSTEM_CHROMIUM = '/usr/bin/chromium';

export function repoRoot() {
  return dirname(dirname(fileURLToPath(new URL('.', import.meta.url))));
}

/** Orchestrator work/ dir (shots, video, lock). Override with WORK_DIR. */
export function workDir() {
  if (process.env.WORK_DIR) return process.env.WORK_DIR;
  if (existsSync(ORCHESTRATOR_WORK)) return ORCHESTRATOR_WORK;
  return join(repoRoot(), 'work');
}

export function heavyLockPath() {
  return process.env.HEAVY_LOCK || join(workDir(), '.heavy.lock');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Flags that never take a value, so a following positional is not swallowed. */
export const BOOLEAN_FLAGS = new Set([
  'help',
  'no-mobile',
  'no-sections',
  'mobile-only',
]);

/**
 * Parse `--flag`, `--flag=value`, `--flag value`. Bare `--flag` → true.
 * Known boolean flags (BOOLEAN_FLAGS plus `extraBooleanFlags`) never consume
 * the next token: `shoot.mjs --no-mobile http://x/` keeps the URL positional.
 */
export function parseArgs(argv, extraBooleanFlags = []) {
  const booleanFlags = new Set([...BOOLEAN_FLAGS, ...extraBooleanFlags]);
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      if (booleanFlags.has(body)) {
        flags[body] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }
    if (a.startsWith('-') && a !== '-') {
      flags[a.slice(1)] = true;
      continue;
    }
    positional.push(a);
  }
  return { flags, positional };
}

export function flagNum(flags, name, fallback) {
  if (!(name in flags)) return fallback;
  const n = Number(flags[name]);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got ${flags[name]}`);
  return n;
}

export function flagBool(flags, name) {
  const v = flags[name];
  if (v === undefined) return false;
  if (v === true || v === '1' || v === 'true') return true;
  if (v === false || v === '0' || v === 'false') return false;
  return Boolean(v);
}

export function parseWxH(value, fallback) {
  if (!value || value === true) return fallback;
  const m = /^(\d+)x(\d+)$/i.exec(String(value).trim());
  if (!m) throw new Error(`viewport must look like 1440x900, got ${value}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function slug(value, fallback = 'unnamed') {
  const s = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || fallback;
}

const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--enable-webgl',
  '--enable-webgl2',
  '--ignore-gpu-blocklist',
  '--disable-dev-shm-usage',
];

function findCachedPlaywrightChromium() {
  const base = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(base)) return undefined;
  const names = readdirSync(base)
    .filter((d) => d.startsWith('chromium-') && !d.includes('headless'))
    .sort();
  for (let i = names.length - 1; i >= 0; i--) {
    const dir = join(base, names[i]);
    for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const candidate = join(dir, rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

export function resolveChromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync(SYSTEM_CHROMIUM)) return SYSTEM_CHROMIUM;
  return findCachedPlaywrightChromium();
}

export async function launchBrowser() {
  const executablePath = resolveChromiumPath();
  const noSandbox = process.env.CHROMIUM_NO_SANDBOX !== '0';
  try {
    return await chromium.launch({
      headless: true,
      executablePath,
      args: [...SWIFTSHADER_ARGS, ...(noSandbox ? ['--no-sandbox'] : [])],
    });
  } catch (err) {
    const hint = executablePath
      ? `Failed to launch ${executablePath}`
      : 'Failed to launch Playwright Chromium (no executablePath)';
    throw new Error(`${hint}: ${err.message}`);
  }
}

/**
 * Fonts always. Then wait for window.__siteReady === true.
 * Contract: the site sets window.__siteReady = true when live surfaces have
 * painted. If the flag never becomes true before readyTimeout (default 8s,
 * capped by `timeout`), fall back to networkidle. Always ends with a settle delay.
 */
export async function waitForReady(page, { delay = 1500, timeout = 30_000, readyTimeout } = {}) {
  await page.waitForLoadState('domcontentloaded', { timeout });
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {});

  const flagTimeout = readyTimeout ?? Math.min(timeout, 8_000);
  const siteReady = await page
    .waitForFunction(() => window.__siteReady === true, undefined, { timeout: flagTimeout })
    .then(() => true)
    .catch(() => false);
  if (!siteReady) {
    await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  }

  if (delay > 0) await sleep(delay);
}

export async function gotoAndWait(page, url, opts) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts?.timeout ?? 30_000 });
  if (response && response.status() >= 400) {
    throw new Error(`GET ${url} → HTTP ${response.status()}`);
  }
  await waitForReady(page, opts);
}

export function usageExit(text, code = 0) {
  process.stdout.write(`${text.trimEnd()}\n`);
  process.exit(code);
}
