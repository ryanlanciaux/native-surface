#!/usr/bin/env node
/**
 * Full-page screenshots at desktop (1440x900) and mobile (390x844), plus
 * per-section shots for [data-section].
 *
 *   node scripts/site/shoot.mjs [url] [outdir]
 *   node scripts/site/shoot.mjs --url http://localhost:4881/ --out work/shots/latest --dpr 2
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_DESKTOP,
  DEFAULT_MOBILE,
  DEFAULT_URL,
  flagBool,
  flagNum,
  gotoAndWait,
  launchBrowser,
  parseArgs,
  parseWxH,
  slug,
  sleep,
  usageExit,
  workDir,
} from './lib.mjs';

const HELP = `
Usage: node scripts/site/shoot.mjs [url] [outdir] [options]

  url                 default ${DEFAULT_URL}
  outdir              default <work>/shots/latest

Options:
  --url <url>         page to capture
  --out <dir>         output directory
  --dpr <n>           deviceScaleFactor (1, pass 2 for retina)
  --delay <ms>        settle after fonts/ready (default 1500)
  --timeout <ms>      navigation / ready timeout (default 30000)
  --desktop <WxH>     default 1440x900
  --mobile <WxH>      default 390x844
  --no-mobile         skip the mobile viewport
  --no-sections       skip [data-section] captures
  --help
`.trim();

const { flags, positional } = parseArgs(process.argv.slice(2));
if (flagBool(flags, 'help') || flags.h) usageExit(HELP);

const url = flags.url || positional[0] || process.env.SITE_URL || DEFAULT_URL;
const outDir = flags.out || positional[1] || join(workDir(), 'shots/latest');
const dpr = flagNum(flags, 'dpr', 1);
const delay = flagNum(flags, 'delay', 1500);
const timeout = flagNum(flags, 'timeout', 30_000);
const desktop = parseWxH(flags.desktop, DEFAULT_DESKTOP);
const mobile = parseWxH(flags.mobile, DEFAULT_MOBILE);
const skipMobile = flagBool(flags, 'no-mobile');
const skipSections = flagBool(flags, 'no-sections');

function fileName(prefix, viewport) {
  const at = dpr === 1 ? '' : `@${dpr}x`;
  return `${prefix}-${viewport.width}x${viewport.height}${at}.png`;
}

async function captureViewport(browser, viewport, prefix) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  await gotoAndWait(page, url, { delay, timeout });

  const fullName = fileName(prefix, viewport);
  const fullPath = join(outDir, fullName);
  await page.screenshot({ path: fullPath, fullPage: true });
  const shots = [{ kind: 'full', viewport, path: fullPath }];

  if (!skipSections) {
    const locators = page.locator('[data-section]');
    const count = await locators.count();
    for (let i = 0; i < count; i++) {
      const el = locators.nth(i);
      const name = slug(await el.getAttribute('data-section'), `idx${i}`);
      const sectionName = `${prefix}-section-${name}${dpr === 1 ? '' : `@${dpr}x`}.png`;
      const sectionPath = join(outDir, sectionName);
      await el.screenshot({ path: sectionPath });
      shots.push({ kind: 'section', name, viewport, path: sectionPath });
    }
    if (count === 0) {
      console.log(`shoot: no [data-section] elements at ${prefix}`);
    }
  }

  await context.close();
  return shots;
}

mkdirSync(outDir, { recursive: true });
console.log(`shoot: ${url}`);
console.log(`shoot: out ${outDir}  dpr=${dpr} delay=${delay}ms`);

const browser = await launchBrowser();
const written = [];
try {
  written.push(...(await captureViewport(browser, desktop, 'desktop')));
  if (!skipMobile) {
    await sleep(250);
    written.push(...(await captureViewport(browser, mobile, 'mobile')));
  }
} finally {
  await browser.close();
}

const manifest = {
  url,
  dpr,
  delay,
  outDir,
  files: written,
};
writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
for (const s of written) console.log(`  ${s.path}`);
console.log(`shoot: ${written.length} file(s)`);
