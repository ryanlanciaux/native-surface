#!/usr/bin/env node
/**
 * Record ~6s after load at 1440x900 (Playwright webm) and transcode to
 * h264 yuv420p mp4 via ffmpeg.
 *
 *   node scripts/site/record-hero.mjs [url]
 *   node scripts/site/record-hero.mjs --url http://localhost:4881/ --out work/video/hero.mp4 --mobile
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DEFAULT_DESKTOP,
  DEFAULT_MOBILE,
  DEFAULT_URL,
  flagBool,
  flagNum,
  launchBrowser,
  parseArgs,
  parseWxH,
  sleep,
  usageExit,
  waitForReady,
  workDir,
} from './lib.mjs';

const HELP = `
Usage: node scripts/site/record-hero.mjs [url] [options]

  url                 default ${DEFAULT_URL}

Options:
  --url <url>
  --out <mp4>         default <work>/video/hero.mp4
  --seconds <n>       seconds after load to keep recording (default 6)
  --delay <ms>        extra waitForReady settle before the timer (default 0)
  --timeout <ms>      navigation timeout (default 30000)
  --desktop <WxH>     default 1440x900
  --mobile            also write <out-dir>/hero-mobile.mp4 at 390x844
  --mobile-only       skip desktop; write --out at the mobile viewport
  --dpr <n>           deviceScaleFactor (default 1)
  --help
`.trim();

const { flags, positional } = parseArgs(process.argv.slice(2));
if (flagBool(flags, 'help') || flags.h) usageExit(HELP);

const url = flags.url || positional[0] || process.env.SITE_URL || DEFAULT_URL;
const outPath = flags.out || positional[1] || join(workDir(), 'video/hero.mp4');
const seconds = flagNum(flags, 'seconds', 6);
const delay = flagNum(flags, 'delay', 0);
const timeout = flagNum(flags, 'timeout', 30_000);
const dpr = flagNum(flags, 'dpr', 1);
const desktop = parseWxH(flags.desktop, DEFAULT_DESKTOP);
const mobileVp = parseWxH(flags.mobile === true ? undefined : flags.mobile, DEFAULT_MOBILE);
const wantMobile = flagBool(flags, 'mobile') || flagBool(flags, 'mobile-only');
const wantDesktop = !flagBool(flags, 'mobile-only');

function ffmpegToMp4(webm, mp4) {
  mkdirSync(dirname(mp4), { recursive: true });
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      webm,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      mp4,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status} converting ${webm}`);
}

function mobileOut(desktopOut) {
  if (desktopOut.endsWith('hero.mp4')) return desktopOut.replace(/hero\.mp4$/, 'hero-mobile.mp4');
  if (desktopOut.endsWith('.mp4')) return desktopOut.replace(/\.mp4$/, '-mobile.mp4');
  return `${desktopOut}-mobile.mp4`;
}

function playwrightFfmpegHint(err) {
  const msg = err?.message || String(err);
  if (!/ffmpeg/i.test(msg)) return err;
  return new Error(
    'Playwright recordVideo needs its bundled ffmpeg (separate from system ffmpeg).\n' +
      'Run once: pnpm exec playwright install ffmpeg\n' +
      msg,
  );
}

async function recordOne(browser, viewport, mp4) {
  const tmp = mkdtempSync(join(tmpdir(), 'site-hero-'));
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: dpr,
      recordVideo: { dir: tmp, size: viewport },
    });
    const page = await context.newPage();
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    if (response && response.status() >= 400) {
      await context.close();
      throw new Error(`GET ${url} → HTTP ${response.status()}`);
    }
    await waitForReady(page, { delay, timeout });
    const elapsed = Date.now() - started;
    const remaining = Math.max(seconds * 1000 - elapsed, 500);
    await sleep(remaining);

    const video = page.video();
    await page.close();
    await context.close();
    const webm = video ? await video.path() : null;
    if (!webm) throw new Error('Playwright did not produce a video file');
    ffmpegToMp4(webm, mp4);
  } catch (err) {
    throw playwrightFfmpegHint(err);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`record-hero: ${mp4} (${viewport.width}x${viewport.height}, ~${seconds}s)`);
  return mp4;
}

console.log(`record-hero: ${url}`);
const browser = await launchBrowser();
const written = [];
try {
  if (wantDesktop) written.push(await recordOne(browser, desktop, outPath));
  if (wantMobile) {
    const dest = wantDesktop ? mobileOut(outPath) : outPath;
    written.push(await recordOne(browser, mobileVp, dest));
  }
} finally {
  await browser.close();
}
for (const p of written) console.log(`  ${p}`);
