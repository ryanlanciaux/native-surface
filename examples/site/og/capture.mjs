// Regenerates public/og-v2.png (1200×630), the social preview card.
//
//   1. Captures the real hero phone (live Ignite app, face-on, reduced motion
//      so it is at rest) from a production build served at PHONE_URL.
//   2. Starts the Vite dev server on the og/ template (src/og), hands it the
//      phone capture, and screenshots the card at 1200×630.
//
// Usage (from examples/site, with the built site served, e.g. `vite preview
// --base /native-surface/ --port 4870`):
//   node og/capture.mjs [PHONE_URL]
// One browser, one page at a time. CHROMIUM overrides the browser binary;
// OG_PORT the card's dev-server port (default 4871).
// If ImageMagick is installed the PNG is recompressed losslessly.
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHONE_URL = process.argv[2] ?? 'http://localhost:4870/native-surface/';
const OUT = resolve(site, 'public/og-v2.png');
const CARD_PORT = Number(process.env.OG_PORT ?? 4871);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

// 1. The phone, on a transparent background.
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await page.goto(PHONE_URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__siteReady && document.querySelector('[data-live-surface="painted"]'), null, { timeout: 60000 });
await page.waitForTimeout(3000); // remote artwork in the Ignite list
await page.addStyleTag({
  content: `html, body, main, .hero { background: transparent !important; }
    .backdrop, .nav, .hero__copy, .hero__shadow, .hero__caption, .hero__hint,
    main > :not(.hero), footer { visibility: hidden !important; }`,
});
const box = await page.evaluate(() => {
  const r = document.querySelector('.hero__device .phone').getBoundingClientRect();
  const pad = 24; // keeps the frame's edge highlight and shadow
  return { x: r.left - pad, y: r.top - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
});
const phone = await page.screenshot({ clip: box, omitBackground: true });
await page.close();

// 2. The card.
const server = await createServer({
  root: site,
  logLevel: 'warn',
  server: { port: CARD_PORT, strictPort: true, host: '127.0.0.1' },
  optimizeDeps: { entries: ['og/index.html'] },
});
await server.listen();
try {
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.addInitScript((src) => (window.__ogPhone = src), `data:image/png;base64,${phone.toString('base64')}`);
  await card.goto(`http://127.0.0.1:${CARD_PORT}/og/`, { waitUntil: 'load' });
  await card.waitForFunction(() => window.__ogReady && document.querySelector('.og canvas[data-ready]'), null, { timeout: 60000 });
  await writeFile(OUT, await card.screenshot({ type: 'png' }));
  try {
    execFileSync('magick', [OUT, '-strip', '-define', 'png:compression-level=9', '-define', 'png:compression-strategy=1', '-define', 'png:compression-filter=5', OUT]);
  } catch {
    console.warn('magick not found: PNG left as captured');
  }
  console.log(`wrote ${OUT}`);
} finally {
  await server.close();
  await browser.close();
}
