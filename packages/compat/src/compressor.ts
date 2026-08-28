/**
 * react-native-compressor compat shim.
 *
 * The real package is a native module, and its unlinked stub is aggressive: it
 * replaces the module with a Proxy whose every property access THROWS
 * "The package 'react-native-compressor' doesn't seem to be linked...". So
 * merely importing it is fine and the first call takes the app down — including
 * a `clearCache()` that an app may run at startup.
 *
 * The metadata half of that surface is genuinely implementable here, because a
 * `<video>` element already knows a file's dimensions and duration and can be
 * drawn to a canvas for a thumbnail. That is the half Bluesky actually uses
 * (`getVideoMetaData`, `createVideoThumbnail`, `clearCache`).
 *
 * COMPRESSION is the honest gap. Re-encoding video needs WebCodecs plus a
 * muxer, which is a real project rather than a shim, and silently returning
 * the input uri would be worse than failing: the caller would upload an
 * untouched file believing it had been compressed to fit a limit. So
 * `Video.compress` rejects, naming why. Image compression IS available and
 * goes through a canvas re-encode.
 */

const NOT_IMPLEMENTED =
  'react-native-compressor compat: video compression needs WebCodecs plus a muxer and is not implemented on the canvas host. ' +
  'The metadata functions (getVideoMetaData, createVideoThumbnail) do work.';

function noDom(): never {
  throw new Error('react-native-compressor compat: no DOM available in this environment.');
}

/** A detached, muted, preload-metadata video element for one measurement. */
async function withVideo<T>(uri: string, fn: (video: HTMLVideoElement) => Promise<T>): Promise<T> {
  if (typeof document === 'undefined') noDom();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  // Needed to draw a frame without tainting the canvas; harmless for same-origin.
  video.crossOrigin = 'anonymous';
  video.src = uri;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () =>
        reject(new Error(`react-native-compressor compat: could not load video metadata for ${uri}`));
    });
    return await fn(video);
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

export interface VideoMetaData {
  duration: number;
  width: number;
  height: number;
  size: number;
  extension: string;
}

/** Best-effort extension from the uri, since a blob:/data: uri carries none. */
function extensionOf(uri: string): string {
  const clean = uri.split('?')[0] ?? uri;
  const match = /\.([a-z0-9]{2,5})$/i.exec(clean);
  return match ? match[1]!.toLowerCase() : 'mp4';
}

/**
 * Duration is in SECONDS, matching the real module — callers convert. Size is
 * 0 unless the bytes are reachable: a `<video>` never exposes a byte count, so
 * this HEADs the uri rather than inventing one.
 */
export async function getVideoMetaData(uri: string): Promise<VideoMetaData> {
  return withVideo(uri, async (video) => {
    let size = 0;
    try {
      const head = await fetch(uri, { method: 'HEAD' });
      size = Number(head.headers.get('content-length') ?? 0) || 0;
    } catch {
      /* opaque or unreachable — report 0 rather than guess */
    }
    return {
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      width: video.videoWidth,
      height: video.videoHeight,
      size,
      extension: extensionOf(uri),
    };
  });
}

export interface VideoThumbnailResult {
  path: string;
  size: number;
  mime: string;
  width: number;
  height: number;
}

/** Seeks to `startTime` (seconds), draws that frame, returns an object URL. */
export async function createVideoThumbnail(uri: string, startTime = 0): Promise<VideoThumbnailResult> {
  return withVideo(uri, async (video) => {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.onseeked = done;
      // A seek past the end never fires `seeked`; clamp and fall back.
      video.currentTime = Math.min(startTime, Math.max(0, (video.duration || 0) - 0.05));
      if (video.readyState >= 2 && video.currentTime === 0 && startTime === 0) done();
    });
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('react-native-compressor compat: could not acquire a 2D context.');
    ctx.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) {
      // toBlob returns null when the canvas is tainted by a cross-origin frame.
      throw new Error(
        `react-native-compressor compat: could not read a frame from ${uri} — the source is cross-origin ` +
          `without CORS, which taints the canvas.`
      );
    }
    return {
      path: URL.createObjectURL(blob),
      size: blob.size,
      mime: 'image/jpeg',
      width: canvas.width,
      height: canvas.height,
    };
  });
}

/** Cached transcodes live in native temp storage; there is none here. */
export async function clearCache(): Promise<void> {}
export async function getRealPath(path: string, _type?: string): Promise<string> {
  return path;
}
export async function getFileSize(uri: string): Promise<number> {
  try {
    const head = await fetch(uri, { method: 'HEAD' });
    return Number(head.headers.get('content-length') ?? 0) || 0;
  } catch {
    return 0;
  }
}

export interface CompressorOptions {
  compressionMethod?: 'auto' | 'manual';
  maxSize?: number;
  quality?: number;
  minimumFileSizeForCompress?: number;
  [key: string]: unknown;
}

export const Video = {
  compress: async (_uri: string, _options?: CompressorOptions): Promise<string> => {
    throw new Error(NOT_IMPLEMENTED);
  },
  cancelCompression: (_uuid?: string): void => {},
  activateBackgroundTask: async (): Promise<void> => {},
  deactivateBackgroundTask: async (): Promise<void> => {},
};

/**
 * Image compression IS real — a canvas re-encode, which is exactly what the
 * native module does under the hood.
 */
export const Image = {
  compress: async (uri: string, options: CompressorOptions = {}): Promise<string> => {
    if (typeof document === 'undefined') noDom();
    const quality = typeof options.quality === 'number' ? options.quality : 0.8;
    const maxSize = typeof options.maxSize === 'number' ? options.maxSize : 0;
    const bitmap = await createImageBitmap(await (await fetch(uri)).blob());
    let { width, height } = bitmap;
    if (maxSize > 0 && Math.max(width, height) > maxSize) {
      const ratio = maxSize / Math.max(width, height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('react-native-compressor compat: could not acquire a 2D context.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error(`react-native-compressor compat: could not encode ${uri} (tainted canvas?).`);
    return URL.createObjectURL(blob);
  },
  cancelCompression: (_uuid?: string): void => {},
};

export const Audio = {
  compress: async (): Promise<string> => {
    throw new Error(NOT_IMPLEMENTED);
  },
  cancelCompression: (_uuid?: string): void => {},
};

export const backgroundUpload = async (): Promise<never> => {
  throw new Error('react-native-compressor compat: background upload requires a native session.');
};

const Compressor = {
  Video,
  Image,
  Audio,
  getVideoMetaData,
  createVideoThumbnail,
  clearCache,
  getRealPath,
  getFileSize,
  backgroundUpload,
};

export default Compressor;
