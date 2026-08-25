import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
// Server modules are plain .mjs (they run on Node without a build step).
// @ts-expect-error untyped internal module
import { decodePNG, diffPNG } from '../src/shoot/png.mjs';

// Test-local minimal PNG writer: enough to hand the decoder every shape it
// claims to support, including a chosen filter byte per row.
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(head.length + 8);
  out.writeUInt32BE(data.length, 0);
  head.copy(out, 4);
  out.writeUInt32BE(crc32(head), head.length + 4);
  return out;
}

interface EncodeOptions {
  colorType?: number;
  /** Raw filter byte per row (defaults to all 0 / None). Filtered bytes must
   *  then be provided pre-filtered via `rows`. */
  filters?: number[];
}

/** Encodes rows of RAW (unfiltered) scanline bytes with filter None, or, when
 *  `filters` is given, treats `rows` as the already-filtered byte stream. */
function encodePNG(width: number, height: number, rows: number[][], opts: EncodeOptions = {}): Buffer {
  const colorType = opts.colorType ?? 6;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const raw: number[] = [];
  rows.forEach((row, y) => {
    raw.push(opts.filters?.[y] ?? 0, ...row);
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const rgba = (...px: Array<[number, number, number, number]>): number[] => px.flat();

describe('decodePNG', () => {
  it('decodes 8-bit RGBA with filter None', () => {
    const png = encodePNG(2, 2, [
      rgba([255, 0, 0, 255], [0, 255, 0, 255]),
      rgba([0, 0, 255, 255], [1, 2, 3, 4]),
    ]);
    const image = decodePNG(png);
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
    expect([...image.pixels]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 4]);
  });

  it('expands RGB to opaque RGBA', () => {
    const png = encodePNG(2, 1, [[10, 20, 30, 40, 50, 60]], { colorType: 2 });
    expect([...decodePNG(png).pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('expands greyscale and grey+alpha', () => {
    const grey = encodePNG(2, 1, [[7, 200]], { colorType: 0 });
    expect([...decodePNG(grey).pixels]).toEqual([7, 7, 7, 255, 200, 200, 200, 255]);
    const greyAlpha = encodePNG(1, 1, [[9, 128]], { colorType: 4 });
    expect([...decodePNG(greyAlpha).pixels]).toEqual([9, 9, 9, 128]);
  });

  it('applies Sub, Up, Average, and Paeth filters', () => {
    // Grey, 3x4, one row per filter type after a None row. Values chosen so
    // every reconstruction path (left / up / average / paeth) is exercised.
    const width = 3;
    const rows = [
      [10, 20, 30], // None  → 10, 20, 30
      [5, 251, 10], // Sub   → 5, (5+251)%256=0, 10
      [10, 20, 246], // Up   → 10+5=15, 20+0=20, (246+10)%256=0
      [4, 241, 10], // Average → 4+((0+15)>>1)=11, (241+((11+20)>>1))%256=0, 10+((0+0)>>1)=10
    ];
    const png = encodePNG(width, 4, rows, { colorType: 0, filters: [0, 1, 2, 3] });
    const image = decodePNG(png);
    const grey = [...image.pixels].filter((_, i) => i % 4 === 0);
    expect(grey).toEqual([10, 20, 30, 5, 0, 10, 15, 20, 0, 11, 0, 10]);

    // Paeth on row 1 (row 0 = None): left/up/upLeft all participate.
    // px(1,0): paeth(0,100,0) picks up=100 → 3+100=103;
    // px(1,1): paeth(103,50,100): p=53 → pa 50, pb 3, pc 47 → up=50 → (250+50)%256=44.
    const paethPng = encodePNG(2, 2, [[100, 50], [3, 250]], { colorType: 0, filters: [0, 4] });
    const grey2 = [...decodePNG(paethPng).pixels].filter((_, i) => i % 4 === 0);
    expect(grey2).toEqual([100, 50, 103, 44]);
  });

  it('rejects what it does not support, loudly', () => {
    expect(() => decodePNG(Buffer.from('not a png at all'))).toThrow(/not a PNG/);
    const sixteenBit = encodePNG(1, 1, [[0, 0, 0, 0, 0, 0, 0, 0]]);
    sixteenBit[8 + 8 + 8] = 16; // IHDR bit depth byte
    expect(() => decodePNG(sixteenBit)).toThrow(/bit depth/);
  });
});

describe('diffPNG', () => {
  const a = encodePNG(2, 2, [
    rgba([255, 0, 0, 255], [0, 255, 0, 255]),
    rgba([0, 0, 255, 255], [9, 9, 9, 255]),
  ]);

  it('reports zero differing pixels for identical images', () => {
    expect(diffPNG(a, Buffer.from(a))).toEqual({ status: 'compared', differingPixels: 0, totalPixels: 4 });
  });

  it('counts pixels where any channel differs', () => {
    const b = encodePNG(2, 2, [
      rgba([255, 0, 0, 255], [0, 254, 0, 255]), // one channel off by one
      rgba([0, 0, 255, 254], [9, 9, 9, 255]), // alpha differs
    ]);
    expect(diffPNG(a, b)).toEqual({ status: 'compared', differingPixels: 2, totalPixels: 4 });
  });

  it('flags dimension mismatches instead of comparing', () => {
    const wide = encodePNG(3, 1, [rgba([1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12])]);
    expect(diffPNG(a, wide)).toEqual({
      status: 'dimensions-differ',
      expected: { width: 2, height: 2 },
      actual: { width: 3, height: 1 },
    });
  });

  it('compares across color types (RGB baseline vs RGBA shot)', () => {
    const rgb = encodePNG(2, 1, [[255, 0, 0, 0, 255, 0]], { colorType: 2 });
    const rgbaImg = encodePNG(2, 1, [rgba([255, 0, 0, 255], [0, 255, 0, 255])]);
    expect(diffPNG(rgb, rgbaImg)).toEqual({ status: 'compared', differingPixels: 0, totalPixels: 2 });
  });
});
