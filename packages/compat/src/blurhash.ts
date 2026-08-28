/**
 * Dependency-free placeholder-hash decoders for the image compat shim.
 *
 *   - decodeBlurhash: the standard blurhash algorithm (woltapp/blurhash
 *     reference decoder, reimplemented): base83 → DC/AC cosine components →
 *     linear-light accumulation → sRGB bytes.
 *   - thumbHashToRGBA: the thumbhash reference algorithm (evanw/thumbhash,
 *     reimplemented): packed LPQA DCT coefficients → RGBA at the hash's own
 *     approximate aspect ratio (≤ 32px on the long side).
 *
 * Both return unpremultiplied sRGB RGBA suitable for putImagePixels. Pure
 * functions, no engine or DOM dependencies.
 */

// ---------------------------------------------------------------------------
// blurhash
// ---------------------------------------------------------------------------

const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

const base83Values = new Map<string, number>();
for (let i = 0; i < BASE83.length; i++) base83Values.set(BASE83.charAt(i), i);

function decode83(str: string): number {
  let value = 0;
  for (const c of str) {
    const digit = base83Values.get(c);
    if (digit === undefined) throw new Error(`blurhash: invalid base83 character '${c}'`);
    value = value * 83 + digit;
  }
  return value;
}

function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
}

const signPow = (v: number, exp: number): number => Math.sign(v) * Math.pow(Math.abs(v), exp);

/**
 * A well-formed blurhash: all base83 chars and the exact length its own
 * size flag demands. Used as the "plain string placeholder is a blurhash"
 * heuristic (per expo-image, which accepts bare blurhash strings).
 */
export function isBlurhashString(hash: string): boolean {
  if (hash.length < 6) return false;
  for (const c of hash) if (!base83Values.has(c)) return false;
  const sizeFlag = decode83(hash.charAt(0));
  const numX = (sizeFlag % 9) + 1;
  const numY = Math.floor(sizeFlag / 9) + 1;
  return hash.length === 4 + 2 * numX * numY;
}

/** Decode a blurhash into width*height unpremultiplied RGBA bytes (alpha 255). */
export function decodeBlurhash(hash: string, width = 32, height = 32, punch = 1): Uint8ClampedArray {
  if (hash.length < 6) throw new Error(`blurhash: hash too short (${hash.length})`);
  const sizeFlag = decode83(hash.charAt(0));
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;
  if (hash.length !== 4 + 2 * numX * numY)
    throw new Error(`blurhash: expected length ${4 + 2 * numX * numY} for ${numX}x${numY} components, got ${hash.length}`);

  const quantisedMax = decode83(hash.charAt(1));
  const maxValue = (quantisedMax + 1) / 166;

  // colors[i] = [r, g, b] in linear light
  const colors: Array<[number, number, number]> = [];
  const dc = decode83(hash.substring(2, 6));
  colors.push([srgbToLinear((dc >> 16) & 255), srgbToLinear((dc >> 8) & 255), srgbToLinear(dc & 255)]);
  for (let i = 1; i < numX * numY; i++) {
    const ac = decode83(hash.substring(4 + i * 2, 6 + i * 2));
    colors.push([
      signPow((Math.floor(ac / (19 * 19)) - 9) / 9, 2) * maxValue * punch,
      signPow(((Math.floor(ac / 19) % 19) - 9) / 9, 2) * maxValue * punch,
      signPow(((ac % 19) - 9) / 9, 2) * maxValue * punch,
    ]);
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j++) {
        const basisY = Math.cos((Math.PI * y * j) / height);
        for (let i = 0; i < numX; i++) {
          const basis = Math.cos((Math.PI * x * i) / width) * basisY;
          const color = colors[i + j * numX]!;
          r += color[0] * basis;
          g += color[1] * basis;
          b += color[2] * basis;
        }
      }
      const p = 4 * (x + y * width);
      pixels[p] = linearToSrgb(r);
      pixels[p + 1] = linearToSrgb(g);
      pixels[p + 2] = linearToSrgb(b);
      pixels[p + 3] = 255;
    }
  }
  return pixels;
}

// ---------------------------------------------------------------------------
// thumbhash
// ---------------------------------------------------------------------------

/** Decode base64 (as used by 'thumbhash:BASE64' string sources) to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin =
    typeof atob === 'function'
      ? atob(b64)
      : // Node < 16 fallback; vitest runs where atob is global, browsers always have it.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Buffer.from(b64, 'base64').toString('binary');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Decode a thumbhash into its approximate-aspect-ratio RGBA thumbnail. */
export function thumbHashToRGBA(hash: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  if (hash.length < 5) throw new Error(`thumbhash: hash too short (${hash.length} bytes)`);

  // Header constants (length checked above; `?? 0` satisfies indexed-access checks)
  const header24 = (hash[0] ?? 0) | ((hash[1] ?? 0) << 8) | ((hash[2] ?? 0) << 16);
  const header16 = (hash[3] ?? 0) | ((hash[4] ?? 0) << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = header24 >> 23;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = header16 >> 15;
  const lx = Math.max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = Math.max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
  const aDc = hasAlpha ? ((hash[5] ?? 0) & 15) / 15 : 1;
  const aScale = hasAlpha ? ((hash[5] ?? 0) >> 4) / 15 : 1;

  // Varying factors (saturation boosted 1.25x to compensate for lossy-ness)
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const decodeChannel = (nx: number, ny: number, scale: number): number[] => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++)
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++)
        ac.push(((((hash[acStart + (acIndex >> 1)] ?? 0) >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale);
    return ac;
  };
  const lAc = decodeChannel(lx, ly, lScale);
  const pAc = decodeChannel(3, 3, pScale * 1.25);
  const qAc = decodeChannel(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : [];

  // Inverse DCT into RGBA at the hash's approximate aspect ratio (the
  // reference derives the ratio from the unclamped header counts).
  const ratioLx = isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7;
  const ratioLy = isLandscape ? header16 & 7 : hasAlpha ? 5 : 7;
  const ratio = ratioLx / (ratioLy || 1);
  const w = Math.round(ratio > 1 ? 32 : 32 * ratio);
  const h = Math.round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);
  const fx: number[] = [];
  const fy: number[] = [];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let l = lDc;
      let p = pDc;
      let q = qDc;
      let a = aDc;

      const nX = Math.max(lx, hasAlpha ? 5 : 3);
      for (let cx = 0; cx < nX; cx++) fx[cx] = Math.cos((Math.PI / w) * (x + 0.5) * cx);
      const nY = Math.max(ly, hasAlpha ? 5 : 3);
      for (let cy = 0; cy < nY; cy++) fy[cy] = Math.cos((Math.PI / h) * (y + 0.5) * cy);

      for (let cy = 0, j = 0; cy < ly; cy++)
        for (let cx = cy ? 0 : 1, fy2 = fy[cy]! * 2; cx * ly < lx * (ly - cy); cx++, j++)
          l += lAc[j]! * fx[cx]! * fy2;

      for (let cy = 0, j = 0; cy < 3; cy++) {
        for (let cx = cy ? 0 : 1, fy2 = fy[cy]! * 2; cx < 3 - cy; cx++, j++) {
          const f = fx[cx]! * fy2;
          p += pAc[j]! * f;
          q += qAc[j]! * f;
        }
      }

      if (hasAlpha)
        for (let cy = 0, j = 0; cy < 5; cy++)
          for (let cx = cy ? 0 : 1, fy2 = fy[cy]! * 2; cx < 5 - cy; cx++, j++)
            a += aAc[j]! * fx[cx]! * fy2;

      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = Math.max(0, 255 * Math.min(1, r));
      rgba[i + 1] = Math.max(0, 255 * Math.min(1, g));
      rgba[i + 2] = Math.max(0, 255 * Math.min(1, b));
      rgba[i + 3] = Math.max(0, 255 * Math.min(1, a));
    }
  }
  return { w, h, rgba };
}
