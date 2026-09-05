// `native-surface playground shoot` — headless screenshot run over every
// story: starts the same programmatic Vite server the serve command uses,
// drives a headless Chromium over the per-story hash routes in shoot mode
// (?shoot=1: fixed viewport, dpr 1, story index + selection published on
// globalThis), and captures the canvas element only. The engine's browser
// asset path (CanvasKit + fonts over fetch) is why this is browser-driven —
// the node-side test renderer is not part of the published package.
//
// Requirements beyond the package's own deps:
//   - puppeteer-core, resolved from (in order) $NS_SHOOT_PUPPETEER_DIR, the
//     host app root, or the playground package itself.
//   - a Chromium/Chrome binary: --browser, else $CHROME_PATH, else
//     /usr/bin/chromium. Headless GPU is SwiftShader
//     (--enable-unsafe-swiftshader); canvas readback APIs return zeros there,
//     which is why capture goes through page.screenshot, not root.readPixel.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPlaygroundServer } from './server/create-server.mjs';
import { diffPNG } from './shoot/png.mjs';

export const DEFAULT_SHOOT_VIEWPORT = { width: 390, height: 720 };
export const DEFAULT_OUT_DIR = '.native-surface/shots';
export const DEFAULT_TOLERANCE = 0.001;
export const DEFAULT_BROWSER = '/usr/bin/chromium';

const PLAYGROUND_PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STORY_TIMEOUT_MS = 60000;

async function loadPuppeteer(hostRoot) {
  const dirs = [process.env.NS_SHOOT_PUPPETEER_DIR, hostRoot, PLAYGROUND_PKG_ROOT].filter(Boolean);
  for (const dir of dirs) {
    try {
      const req = createRequire(join(dir, 'noop.js'));
      const entry = req.resolve('puppeteer-core');
      const mod = await import(pathToFileURL(entry).href);
      return mod.default ?? mod;
    } catch {
      // Try the next root.
    }
  }
  throw new Error(
    `puppeteer-core not found (looked from: ${dirs.join(', ')}). ` +
      `Install it in the app (npm i -D puppeteer-core) or point NS_SHOOT_PUPPETEER_DIR at a directory whose node_modules contains it.`
  );
}

/** waitForFunction that survives Vite dep-optimizer full reloads (they destroy
 *  the execution context mid-wait) by retrying until the deadline. */
async function waitInPage(page, label, fn, arg, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const handle = await page.waitForFunction(fn, { timeout: 5000, polling: 100 }, arg);
      return await handle.jsonValue();
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for ${label}: ${String(error).slice(0, 300)}`);
      }
    }
  }
}

async function captureStory(page, story, outDir, settleMs = 0) {
  // Hash-only navigation: same document, the app's hashchange handler swaps
  // the story (and remounts the surface via its key).
  await page.evaluate((hash) => {
    if (window.location.hash !== hash) window.location.hash = hash;
  }, `#/story/${encodeURIComponent(story.id)}`);

  // Terminal-ish state: our story is selected AND (error panel || canvas up).
  const state = await waitInPage(
    page,
    `story ${story.id}`,
    (wantedId) => {
      const selection = globalThis.__playgroundShootSelection;
      if (!selection || selection.id !== wantedId) return false;
      const panel = document.querySelector('.story-error');
      if (panel) {
        return {
          kind: 'error',
          notBridged: panel.classList.contains('not-bridged'),
          message: (panel.querySelector('pre')?.textContent ?? panel.textContent ?? '').trim(),
        };
      }
      const canvas = document.querySelector('canvas.surface');
      if (!canvas) return false;
      const roots = globalThis.__nativeSurfaceRoots;
      if (!roots || roots.size === 0) return false;
      return { kind: 'canvas' };
    },
    story.id,
    STORY_TIMEOUT_MS
  );

  if (state.kind === 'canvas') {
    // Settle: fonts, the engine's own flush, then two frames. A story that
    // throws does so inside flush — the error panel appears after.
    const settled = await page.evaluate(async (extraSettleMs) => {
      try {
        await document.fonts.ready;
        const roots = [...(globalThis.__nativeSurfaceRoots ?? [])];
        await Promise.race([
          Promise.all(roots.map((root) => root.flush())),
          new Promise((_, reject) => setTimeout(() => reject(new Error('engine flush timed out')), 15000)),
        ]);
        // No public engine waiter for in-flight Image fetches. Drain resource
        // timing until quiet, then optional extra --settle, then the usual rAF.
        await new Promise((resolve) => {
          let quiet;
          const done = () => {
            clearTimeout(quiet);
            clearTimeout(hard);
            try {
              observer.disconnect();
            } catch {
              /* already disconnected */
            }
            resolve();
          };
          const bump = () => {
            clearTimeout(quiet);
            quiet = setTimeout(done, 50);
          };
          const observer = new PerformanceObserver(bump);
          try {
            observer.observe({ type: 'resource', buffered: false });
          } catch {
            done();
            return;
          }
          const hard = setTimeout(done, 15000);
          bump();
        });
        if (extraSettleMs > 0) await new Promise((r) => setTimeout(r, extraSettleMs));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        return { ok: true };
      } catch (error) {
        return { ok: false, message: String(error) };
      }
    }, settleMs);
    // Give a cross-tree error (canvas boundary -> DOM chrome) a beat to swap
    // the canvas for the panel before deciding this story painted.
    await new Promise((r) => setTimeout(r, 150));
    const post = await page.evaluate(() => {
      const panel = document.querySelector('.story-error');
      if (panel) {
        return {
          kind: 'error',
          notBridged: panel.classList.contains('not-bridged'),
          message: (panel.querySelector('pre')?.textContent ?? panel.textContent ?? '').trim(),
        };
      }
      const canvas = document.querySelector('canvas.surface');
      if (!canvas) return { kind: 'missing-canvas' };
      const rect = canvas.getBoundingClientRect();
      return { kind: 'canvas', rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    });

    if (post.kind === 'canvas') {
      if (!settled.ok) {
        return { ...storyBase(story), status: 'error', reason: `did not settle: ${settled.message}` };
      }
      const file = `${story.id}.png`;
      const png = await page.screenshot({
        clip: {
          x: Math.round(post.rect.x),
          y: Math.round(post.rect.y),
          width: Math.round(post.rect.width),
          height: Math.round(post.rect.height),
        },
        captureBeyondViewport: true,
      });
      writeFileSync(join(outDir, file), png);
      return { ...storyBase(story), status: 'shot', file };
    }
    if (post.kind === 'missing-canvas') {
      return { ...storyBase(story), status: 'error', reason: 'canvas disappeared without an error panel' };
    }
    return errorResult(story, post);
  }
  return errorResult(story, state);
}

function storyBase(story) {
  return { id: story.id, title: story.title, name: story.name };
}

function errorResult(story, panel) {
  if (panel.notBridged) {
    return { ...storyBase(story), status: 'skipped', reason: `not bridged: ${panel.message}` };
  }
  return { ...storyBase(story), status: 'error', reason: panel.message };
}

/**
 * Programmatic entry behind the CLI's `shoot` subcommand.
 *
 * @param {object} [options]
 * @param {string} [options.root] host app directory (default: cwd)
 * @param {string} [options.out] output dir, relative to root (default: .native-surface/shots)
 * @param {string} [options.diff] baseline dir to compare against
 * @param {boolean} [options.update] copy current shots over the baseline (requires diff)
 * @param {string[]} [options.stories] story globs, passed to the server
 * @param {string} [options.filter] case-insensitive substring over story id/title/name
 * @param {{width: number, height: number}} [options.viewport] surface size (default 390x720)
 * @param {number} [options.tolerance] max differing-pixel fraction still a match (default 0.001)
 * @param {string} [options.browser] Chromium binary ($CHROME_PATH, else /usr/bin/chromium)
 * @param {'ios'|'android'} [options.platform]
 * @param {'ios'|'android'} [options.theme] surface theme (default ios)
 * @param {boolean} [options.quiet] suppress per-story progress logs
 * @param {number} [options.settle] extra ms to wait after pending image loads (default 0)
 * @returns {Promise<{ ok: boolean, results: object[], report: object, reportPath: string, outDir: string }>}
 */
export async function shoot(options = {}) {
  const hostRoot = resolve(options.root ?? process.cwd());
  const settleMs = Number(options.settle);
  const settle = Number.isFinite(settleMs) && settleMs > 0 ? settleMs : 0;
  const viewport = options.viewport ?? DEFAULT_SHOOT_VIEWPORT;
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const outDir = resolve(hostRoot, options.out ?? DEFAULT_OUT_DIR);
  const baselineDir = options.diff ? resolve(hostRoot, options.diff) : null;
  const update = options.update ?? false;
  if (update && !baselineDir) throw new Error('update requires a diff baseline dir');
  const browserPath = options.browser ?? process.env.CHROME_PATH ?? DEFAULT_BROWSER;
  if (!existsSync(browserPath)) {
    throw new Error(`browser binary not found at ${browserPath}; pass --browser or set CHROME_PATH`);
  }
  const log = options.quiet ? () => {} : (message) => console.log(message);

  const puppeteer = await loadPuppeteer(hostRoot);
  // OS-assigned free port (Vite treats port 0 as unset and would take its own
  // default): a shoot must not collide with a running serve session.
  const port = await new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const assigned = probe.address().port;
      probe.close(() => resolvePort(assigned));
    });
  });
  const { server, audit } = await createPlaygroundServer({
    root: hostRoot,
    stories: options.stories,
    platform: options.platform,
    port,
  });
  let browser = null;
  try {
    await server.listen();
    // Read back what Vite actually bound (it auto-increments if the probed
    // port got taken in the meantime).
    const address = server.httpServer?.address();
    const listenedPort = address && typeof address === 'object' ? address.port : null;
    if (!listenedPort) throw new Error('vite did not report a listening port');
    const base = `http://127.0.0.1:${listenedPort}`;

    browser = await puppeteer.launch({
      executablePath: browserPath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--enable-unsafe-swiftshader',
        '--force-device-scale-factor=1',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--disable-lcd-text',
        '--hide-scrollbars',
      ],
      defaultViewport: {
        width: Math.max(1280, viewport.width + 780),
        height: Math.max(900, viewport.height + 320),
        deviceScaleFactor: 1,
      },
    });
    const page = await browser.newPage();
    const query = `?shoot=1&w=${viewport.width}&h=${viewport.height}${options.theme ? `&theme=${options.theme}` : ''}`;
    await page.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const index = await waitInPage(
      page,
      'story index',
      () => globalThis.__playgroundShootIndex ?? false,
      undefined,
      90000
    );
    if (index.error) throw new Error(`stories failed to load: ${index.error}`);
    let stories = index.stories;
    if (options.filter) {
      const needle = options.filter.toLowerCase();
      stories = stories.filter(
        (story) => story.id.includes(needle) || `${story.title} ${story.name}`.toLowerCase().includes(needle)
      );
    }
    mkdirSync(outDir, { recursive: true });

    const results = [];
    for (const story of stories) {
      let result;
      // One retry: a dep-optimizer reload can land mid-story on cold caches.
      try {
        result = await captureStory(page, story, outDir, settle);
      } catch (error) {
        log(`  retrying ${story.id}: ${String(error).slice(0, 120)}`);
        result = await captureStory(page, story, outDir, settle);
      }
      results.push(result);
      log(`  ${result.status.padEnd(7)} ${result.id}${result.reason ? ` — ${result.reason.split('\n')[0]}` : ''}`);
    }

    if (baselineDir) {
      if (update) mkdirSync(baselineDir, { recursive: true });
      for (const result of results) {
        if (result.status !== 'shot') continue;
        const baselineFile = join(baselineDir, `${result.id}.png`);
        const currentFile = join(outDir, result.file);
        if (update) {
          copyFileSync(currentFile, baselineFile);
          result.diff = { status: 'updated' };
          continue;
        }
        if (!existsSync(baselineFile)) {
          result.diff = { status: 'missing-baseline' };
          continue;
        }
        const outcome = diffPNG(readFileSync(baselineFile), readFileSync(currentFile));
        if (outcome.status === 'dimensions-differ') {
          result.diff = outcome;
        } else {
          const fraction = outcome.totalPixels === 0 ? 0 : outcome.differingPixels / outcome.totalPixels;
          result.diff = {
            status: fraction <= tolerance ? 'match' : 'differ',
            differingPixels: outcome.differingPixels,
            totalPixels: outcome.totalPixels,
            fraction,
          };
        }
      }
    }

    const hardErrors = results.filter((result) => result.status === 'error');
    const diffFailures = results.filter((result) =>
      ['differ', 'missing-baseline', 'dimensions-differ'].includes(result.diff?.status)
    );
    const ok = hardErrors.length === 0 && diffFailures.length === 0;

    const report = {
      generatedAt: new Date().toISOString(),
      root: hostRoot,
      viewport,
      tolerance,
      baseline: baselineDir,
      ok,
      stories: results,
      audit: [...audit.values()],
    };
    const reportPath = join(outDir, 'report.json');
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    return { ok, results, report, reportPath, outDir };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

/** Compact fixed-width summary of a shoot run, for terminals and reports. */
export function formatSummary(results) {
  const rows = results.map((result) => {
    let detail = result.reason?.split('\n')[0] ?? '';
    const diff = result.diff;
    if (diff) {
      if (diff.status === 'match') detail = `match (${diff.differingPixels}/${diff.totalPixels} px differ)`;
      else if (diff.status === 'differ')
        detail = `DIFFER: ${diff.differingPixels}/${diff.totalPixels} px (${(diff.fraction * 100).toFixed(3)}%)`;
      else if (diff.status === 'missing-baseline') detail = 'MISSING BASELINE (run with --update to create)';
      else if (diff.status === 'dimensions-differ')
        detail = `DIMENSIONS DIFFER: baseline ${diff.expected.width}x${diff.expected.height}, got ${diff.actual.width}x${diff.actual.height}`;
      else if (diff.status === 'updated') detail = 'baseline updated';
    }
    return [result.id, result.status, detail];
  });
  const idWidth = Math.max(5, ...rows.map(([id]) => id.length));
  const statusWidth = Math.max(6, ...rows.map(([, status]) => status.length));
  const header = `${'story'.padEnd(idWidth)}  ${'status'.padEnd(statusWidth)}  detail`;
  const lines = rows.map(([id, status, detail]) => `${id.padEnd(idWidth)}  ${status.padEnd(statusWidth)}  ${detail}`);
  return [header, '-'.repeat(header.length), ...lines].join('\n');
}
