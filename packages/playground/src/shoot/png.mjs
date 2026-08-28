// Minimal PNG reader + pixel differ for `playground shoot --diff`, built on
// node:zlib so the diff path adds no dependencies. Scope is exactly the PNGs
// headless Chromium screenshots produce (and that this tool itself wrote):
// 8-bit depth, greyscale/RGB/RGBA (color types 0/2/4/6), non-interlaced.
// Palette and 16-bit PNGs are out of scope and rejected loudly.
import { inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(left, up, upLeft) {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

/**
 * @param {Uint8Array} bytes PNG file contents.
 * @returns {{ width: number, height: number, pixels: Uint8Array }} pixels are
 *   RGBA, row-major, 4 bytes per pixel regardless of source color type.
 */
export function decodePNG(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength);
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG (bad signature)');
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length; // length + type + data + crc
  }
  if (width === 0 || height === 0) throw new Error('PNG missing IHDR');
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (only the 8-bit PNGs Chromium emits)`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = CHANNELS[colorType];
  if (channels === undefined || colorType === 3) {
    throw new Error(`unsupported PNG color type ${colorType} (greyscale/RGB/RGBA only)`);
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error('PNG pixel data truncated');
  const pixels = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const value = raw[pos + x];
      const left = x >= channels ? line[x - channels] : 0;
      const up = prev[x];
      const upLeft = x >= channels ? prev[x - channels] : 0;
      let out;
      switch (filter) {
        case 0:
          out = value;
          break;
        case 1:
          out = value + left;
          break;
        case 2:
          out = value + up;
          break;
        case 3:
          out = value + ((left + up) >> 1);
          break;
        case 4:
          out = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`unsupported PNG filter ${filter} on row ${y}`);
      }
      line[x] = out & 0xff;
    }
    pos += stride;
    for (let px = 0; px < width; px++) {
      const s = px * channels;
      const d = (y * width + px) * 4;
      if (colorType === 6) {
        pixels[d] = line[s];
        pixels[d + 1] = line[s + 1];
        pixels[d + 2] = line[s + 2];
        pixels[d + 3] = line[s + 3];
      } else if (colorType === 2) {
        pixels[d] = line[s];
        pixels[d + 1] = line[s + 1];
        pixels[d + 2] = line[s + 2];
        pixels[d + 3] = 255;
      } else if (colorType === 0) {
        pixels[d] = pixels[d + 1] = pixels[d + 2] = line[s];
        pixels[d + 3] = 255;
      } else {
        pixels[d] = pixels[d + 1] = pixels[d + 2] = line[s];
        pixels[d + 3] = line[s + 1];
      }
    }
    prev.set(line);
  }
  return { width, height, pixels };
}

/**
 * Compares two PNG buffers pixel-for-pixel (a pixel differs when any RGBA
 * channel differs).
 * @returns {{ status: 'dimensions-differ', expected: object, actual: object }
 *   | { status: 'compared', differingPixels: number, totalPixels: number }}
 */
export function diffPNG(expectedBytes, actualBytes) {
  const expected = decodePNG(expectedBytes);
  const actual = decodePNG(actualBytes);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      status: 'dimensions-differ',
      expected: { width: expected.width, height: expected.height },
      actual: { width: actual.width, height: actual.height },
    };
  }
  const totalPixels = expected.width * expected.height;
  let differingPixels = 0;
  for (let i = 0; i < totalPixels; i++) {
    const o = i * 4;
    if (
      expected.pixels[o] !== actual.pixels[o] ||
      expected.pixels[o + 1] !== actual.pixels[o + 1] ||
      expected.pixels[o + 2] !== actual.pixels[o + 2] ||
      expected.pixels[o + 3] !== actual.pixels[o + 3]
    ) {
      differingPixels++;
    }
  }
  return { status: 'compared', differingPixels, totalPixels };
}
