#!/usr/bin/env node
/**
 * Compare a screenshot to a design PNG: resize the actual image to the
 * expected width, pad/crop to the same height, write a diff PNG and print
 * mismatch %.
 *
 *   node scripts/site/diff.mjs <actual.png> <expected.png> [diff.png]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { flagNum, parseArgs, usageExit, workDir } from './lib.mjs';

const HELP = `
Usage: node scripts/site/diff.mjs <actual.png> <expected.png> [diff.png]

  actual      screenshot (resized to the expected image's width)
  expected    design PNG
  diff.png    default <work>/shots/latest/diff.png

Options:
  --out <png>          output diff PNG (same as the [diff.png] positional)
  --threshold <n>      pixelmatch threshold 0..1 (default 0.1)
  --max-mismatch <n>   exit 1 if mismatch % is above this (default: never fail)
  --help
`.trim();

const { flags, positional } = parseArgs(process.argv.slice(2));
if (flags.help || flags.h) usageExit(HELP);
if (positional.length < 2) usageExit(HELP, 1);

const actualPath = positional[0];
const expectedPath = positional[1];
const diffPath = positional[2] || flags.out || join(workDir(), 'shots/latest/diff.png');
const threshold = flagNum(flags, 'threshold', 0.1);
const maxMismatch = flags['max-mismatch'] === true ? 0 : flagNum(flags, 'max-mismatch', Infinity);

function loadPng(path) {
  try {
    return PNG.sync.read(readFileSync(path));
  } catch (err) {
    throw new Error(`cannot read PNG ${path}: ${err.message}`);
  }
}

/** Nearest-neighbour resize to target width, preserving aspect. */
function resizeToWidth(png, targetWidth) {
  if (png.width === targetWidth) return png;
  const targetHeight = Math.max(1, Math.round((png.height * targetWidth) / png.width));
  const out = new PNG({ width: targetWidth, height: targetHeight });
  const xRatio = png.width / targetWidth;
  const yRatio = png.height / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(png.height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(png.width - 1, Math.floor(x * xRatio));
      const si = (srcY * png.width + srcX) << 2;
      const di = (y * targetWidth + x) << 2;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

function sameSize(a, b) {
  const width = a.width;
  const height = Math.max(a.height, b.height);
  const pad = (png) => {
    if (png.width !== width) throw new Error('internal: widths must already match');
    if (png.height === height) return png;
    const out = new PNG({ width, height });
    out.data.fill(0);
    png.data.copy(out.data, 0, 0, png.width * png.height * 4);
    return out;
  };
  return { a: pad(a), b: pad(b), width, height };
}

const expected = loadPng(expectedPath);
const actualRaw = loadPng(actualPath);
const actual = resizeToWidth(actualRaw, expected.width);
const aligned = sameSize(actual, expected);

const diff = new PNG({ width: aligned.width, height: aligned.height });
const mismatched = pixelmatch(aligned.a.data, aligned.b.data, diff.data, aligned.width, aligned.height, {
  threshold,
  includeAA: true,
});
const total = aligned.width * aligned.height;
const percent = total === 0 ? 0 : (mismatched / total) * 100;

mkdirSync(dirname(diffPath), { recursive: true });
writeFileSync(diffPath, PNG.sync.write(diff));

const summary = {
  actual: actualPath,
  expected: expectedPath,
  diff: diffPath,
  actualSize: { width: actualRaw.width, height: actualRaw.height },
  expectedSize: { width: expected.width, height: expected.height },
  compared: { width: aligned.width, height: aligned.height },
  threshold,
  mismatched,
  total,
  mismatchPercent: Number(percent.toFixed(4)),
};
console.log(`diff: ${percent.toFixed(4)}% mismatch (${mismatched} / ${total} pixels)`);
console.log(`diff: wrote ${diffPath}`);
console.log(JSON.stringify(summary));

if (percent > maxMismatch) {
  console.error(`diff: mismatch ${percent.toFixed(4)}% exceeds --max-mismatch ${maxMismatch}`);
  process.exit(1);
}
