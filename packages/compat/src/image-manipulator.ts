/**
 * expo-image-manipulator compat shim — a real implementation over canvas 2D.
 *
 * Unlike most shims in this package, nothing here is stubbed: resize, rotate,
 * flip, crop and extent are the same affine draws the native module performs,
 * composed in the order given, and the encode is the browser's own. Work
 * happens on an `OffscreenCanvas` when the realm has one (no DOM node, so it
 * runs off the document and in workers), falling back to a detached
 * `<canvas>`.
 *
 * SDK 57 ships both surfaces and both are here, over one pipeline:
 * - the deprecated `manipulateAsync(uri, actions, saveOptions)`, including the
 *   documented argument validation (it throws TypeErrors on malformed actions
 *   rather than drawing something surprising);
 * - the contextual API — `ImageManipulator.manipulate(uri)` returning a
 *   chainable context (`.resize().crop().rotate()`), `renderAsync()` for an
 *   `ImageRef`, `saveAsync()` for the `{uri, width, height, base64?}` result,
 *   plus the `useImageManipulator` hook.
 *
 * Sources are loaded with `fetch` + `createImageBitmap` (an `<img>` element is
 * the fallback), which covers `data:` uris, object URLs and http(s) sources.
 * Results are object URLs: `URL.createObjectURL` over the encoded blob.
 *
 * Ceilings:
 * - **Cross-origin sources.** Fetching one without `Access-Control-Allow-Origin`
 *   fails outright, and the `<img>` fallback would TAINT the canvas so the
 *   encode throws a SecurityError. Both are reported as
 *   ERR_IMAGE_MANIPULATOR_CORS naming the uri, never as a broken result uri.
 * - **Encoders are the browser's.** `SaveFormat.WEBP` is unavailable in some
 *   engines; rather than silently returning a PNG labelled webp, `saveAsync`
 *   rejects saying which type came back — matching upstream's web behaviour.
 * - **Result uris are object URLs.** They live only in this document and are
 *   never revoked automatically (the caller owns them), so a long-lived
 *   manipulation loop should `URL.revokeObjectURL` what it stops using.
 * - **`extent` is web-only upstream too**, so an app that uses it is already
 *   web-only; it is implemented here with upstream's exact offset math.
 */
import * as React from 'react';

// ---------------------------------------------------------------------------
// Public enums and types
// ---------------------------------------------------------------------------

export const SaveFormat = {
  JPEG: 'jpeg',
  PNG: 'png',
  WEBP: 'webp',
} as const;
export type SaveFormat = (typeof SaveFormat)[keyof typeof SaveFormat];

export const FlipType = {
  Vertical: 'vertical',
  Horizontal: 'horizontal',
} as const;
export type FlipType = (typeof FlipType)[keyof typeof FlipType];

export type ImageResult = {
  uri: string;
  width: number;
  height: number;
  base64?: string;
};

export type ActionResize = { resize: { width?: number; height?: number } };
export type ActionRotate = { rotate: number };
export type ActionFlip = { flip: FlipType };
export type ActionCrop = { crop: { originX: number; originY: number; width: number; height: number } };
export type ActionExtent = {
  extent: { backgroundColor?: string | null; originX?: number; originY?: number; width: number; height: number };
};
export type Action = ActionResize | ActionRotate | ActionFlip | ActionCrop | ActionExtent;

export type SaveOptions = {
  base64?: boolean;
  compress?: number;
  format?: SaveFormat;
};

interface CodedImageManipulatorError extends Error {
  code: string;
}

function imError(code: string, message: string): CodedImageManipulatorError {
  const error = new Error(message) as CodedImageManipulatorError;
  error.name = 'ImageManipulatorError';
  error.code = code;
  return error;
}

// ---------------------------------------------------------------------------
// Canvas plumbing
//
// OffscreenCanvas and HTMLCanvasElement have the same 2D drawing surface but
// different encode calls, so everything below works against this pair.
// ---------------------------------------------------------------------------

type ManipulatorCanvas = OffscreenCanvas | HTMLCanvasElement;
type ManipulatorContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvas(width: number, height: number): ManipulatorCanvas {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw imError(
    'ERR_IMAGE_MANIPULATOR_NO_CANVAS',
    'Image manipulation needs a canvas: this realm has neither OffscreenCanvas nor a document to create one from.'
  );
}

function getContext(canvas: ManipulatorCanvas): ManipulatorContext {
  const context = canvas.getContext('2d');
  if (!context) throw imError('ERR_IMAGE_MANIPULATOR', 'Failed to create a 2D canvas context.');
  return context as ManipulatorContext;
}

/** Distinguishes a tainted-canvas failure from every other encode failure. */
function isSecurityError(e: unknown): boolean {
  return (e as { name?: unknown } | null)?.name === 'SecurityError';
}

async function canvasToBlob(canvas: ManipulatorCanvas, type: string, quality?: number): Promise<Blob> {
  try {
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type, quality });
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(imError('ERR_IMAGE_MANIPULATOR', `The browser produced no ${type} data.`))),
        type,
        quality
      );
    });
  } catch (e) {
    if (isSecurityError(e)) {
      throw imError(
        'ERR_IMAGE_MANIPULATOR_CORS',
        'Cannot read the manipulated image back: the canvas is tainted by a cross-origin source. ' +
          'Serve the image with Access-Control-Allow-Origin, or copy it into a same-origin blob first.'
      );
    }
    throw e;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader === 'function') {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(imError('ERR_IMAGE_MANIPULATOR', `Unable to read the result as base64: ${String(reader.error)}`));
      reader.readAsDataURL(blob);
    });
    return dataUrl.replace(/^data:[^;]*;base64,/, '');
  }
  // Workers and Node have no FileReader; the bytes are already reachable.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  if (typeof btoa === 'function') return btoa(binary);
  const buffer = (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } }).Buffer;
  if (!buffer) throw imError('ERR_IMAGE_MANIPULATOR', 'No base64 encoder available in this realm.');
  return buffer.from(binary, 'binary').toString('base64');
}

function objectUrlFor(blob: Blob): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw imError('ERR_IMAGE_MANIPULATOR', 'Cannot produce a result uri: this realm has no URL.createObjectURL.');
  }
  return URL.createObjectURL(blob);
}

/**
 * fetch + createImageBitmap first: the fetched bytes become a same-origin blob,
 * so the canvas is never tainted. The `<img>` fallback covers realms without
 * createImageBitmap and CAN taint — which the encode then reports.
 */
async function loadImageCanvas(uri: string): Promise<ManipulatorCanvas> {
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(uri);
      if (!response.ok) {
        throw imError('ERR_IMAGE_MANIPULATOR_LOAD', `Unable to load ${uri}: the request failed with HTTP ${response.status}.`);
      }
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = createCanvas(bitmap.width, bitmap.height);
      getContext(canvas).drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      bitmap.close?.();
      return canvas;
    } catch (e) {
      if ((e as CodedImageManipulatorError).code) throw e;
      // A network-level fetch rejection on a cross-origin uri is a CORS denial.
      if (/^https?:/i.test(uri)) {
        throw imError(
          'ERR_IMAGE_MANIPULATOR_CORS',
          `Unable to load ${uri}: the fetch was rejected, which for a cross-origin image means the host sent no ` +
            `Access-Control-Allow-Origin. A device has no such restriction; a browser does.`
        );
      }
      throw e;
    }
  }
  return loadImageElementCanvas(uri);
}

function loadImageElementCanvas(uri: string): Promise<ManipulatorCanvas> {
  if (typeof Image !== 'function') {
    throw imError('ERR_IMAGE_MANIPULATOR_LOAD', `Unable to load ${uri}: this realm has neither createImageBitmap nor Image.`);
  }
  return new Promise<ManipulatorCanvas>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const canvas = createCanvas(image.naturalWidth, image.naturalHeight);
      getContext(canvas).drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
      resolve(canvas);
    };
    image.onerror = () =>
      reject(
        imError(
          'ERR_IMAGE_MANIPULATOR_LOAD',
          `Unable to load ${uri}. For a cross-origin source this usually means the host sent no Access-Control-Allow-Origin.`
        )
      );
    image.src = uri;
  });
}

// ---------------------------------------------------------------------------
// Actions — each takes a canvas and returns a new one, as the native module's
// pipeline does. The geometry matches upstream's web implementation exactly.
// ---------------------------------------------------------------------------

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function resizeAction(canvas: ManipulatorCanvas, { width, height }: ActionResize['resize']): ManipulatorCanvas {
  const imageRatio = canvas.width / canvas.height;
  let requestedWidth = 0;
  let requestedHeight = 0;
  // One dimension implies the other, preserving the aspect ratio.
  if (width !== undefined) {
    requestedWidth = width;
    requestedHeight = requestedWidth / imageRatio;
  }
  if (height !== undefined) {
    requestedHeight = height;
    if (requestedWidth === 0) requestedWidth = requestedHeight * imageRatio;
  }
  const targetWidth = Math.round(requestedWidth);
  const targetHeight = Math.round(requestedHeight);
  const result = createCanvas(targetWidth, targetHeight);
  const context = getContext(result);
  // Upstream's web build hand-rolls a Hermite resample; the browser's own
  // high-quality downscale is the same idea and orders of magnitude faster.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, targetWidth, targetHeight);
  return result;
}

function sizeFromAngle(width: number, height: number, angle: number): { width: number; height: number } {
  const radians = (angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(radians));
  const s = Math.abs(Math.sin(radians));
  return { width: height * s + width * c, height: height * c + width * s };
}

function rotateAction(canvas: ManipulatorCanvas, degrees: ActionRotate['rotate']): ManipulatorCanvas {
  const { width, height } = sizeFromAngle(canvas.width, canvas.height, degrees);
  const result = createCanvas(width, height);
  const context = getContext(result);
  context.translate(result.width / 2, result.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
  return result;
}

function flipAction(canvas: ManipulatorCanvas, flip: ActionFlip['flip']): ManipulatorCanvas {
  const result = createCanvas(canvas.width, canvas.height);
  const context = getContext(result);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.scale(flip === FlipType.Horizontal ? -1 : 1, flip === FlipType.Vertical ? -1 : 1);
  context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
  return result;
}

function cropAction(canvas: ManipulatorCanvas, options: ActionCrop['crop']): ManipulatorCanvas {
  let { originX = 0, originY = 0, width = 0, height = 0 } = options;
  width = clamp(width, canvas.width);
  height = clamp(height, canvas.height);
  originX = clamp(originX, canvas.width);
  originY = clamp(originY, canvas.height);
  // The rect cannot run past the source edge.
  width = Math.min(originX + width, canvas.width) - originX;
  height = Math.min(originY + height, canvas.height) - originY;
  if (width === 0 || height === 0) {
    throw imError('ERR_IMAGE_MANIPULATOR_CROP', `Crop size must be greater than 0: ${JSON.stringify(options)}`);
  }
  const result = createCanvas(width, height);
  getContext(result).drawImage(canvas, originX, originY, width, height, 0, 0, width, height);
  return result;
}

function extentAction(canvas: ManipulatorCanvas, options: ActionExtent['extent']): ManipulatorCanvas {
  const { backgroundColor = null, originX = 0, originY = 0, width = 0, height = 0 } = options;
  if (width === 0 || height === 0) {
    throw imError('ERR_IMAGE_MANIPULATOR_EXTENT', `Extent size must be greater than 0: ${JSON.stringify(options)}`);
  }
  const result = createCanvas(width, height);
  // A negative origin moves the image INTO the new frame rather than sampling
  // outside the source, so the source rect and destination offset both shift.
  const sx = originX < 0 ? 0 : originX;
  const sy = originY < 0 ? 0 : originY;
  const sw = originX < 0 ? Math.min(canvas.width, width + originX) : Math.min(canvas.width - originX, width);
  const sh = originY < 0 ? Math.min(canvas.height, height + originY) : Math.min(canvas.height - originY, height);
  const dx = originX < 0 ? -originX : 0;
  const dy = originY < 0 ? -originY : 0;
  const context = getContext(result);
  if (backgroundColor != null) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(canvas, sx, sy, sw, sh, dx, dy, sw, sh);
  return result;
}

// ---------------------------------------------------------------------------
// Argument validation — upstream's, so malformed actions fail the same way.
// ---------------------------------------------------------------------------

export function validateUri(uri: string): void {
  if (typeof uri !== 'string') throw new TypeError('The "uri" argument must be a string');
}

export function validateActions(actions: Action[]): void {
  if (!Array.isArray(actions)) throw new TypeError('The "actions" argument must be an array');
  const supported = ['crop', 'extent', 'flip', 'rotate', 'resize'];
  for (const action of actions) {
    if (typeof action !== 'object' || action === null) throw new TypeError('Action must be an object');
    const keys = Object.keys(action);
    if (keys.length !== 1) {
      throw new TypeError(`Single action must contain exactly one transformation: ${supported.join(', ')}`);
    }
    const type = keys[0];
    if (type != null && !supported.includes(type)) throw new TypeError(`Unsupported action type: ${type}`);
    if (type === 'crop') validateCropAction(action as ActionCrop);
    else if (type === 'extent') validateExtentAction(action as ActionExtent);
    else if (type === 'flip') validateFlipAction(action as ActionFlip);
    else if (type === 'rotate') validateRotateAction(action as ActionRotate);
    else if (type === 'resize') validateResizeAction(action as ActionResize);
  }
}

function validateCropAction(action: ActionCrop): void {
  const crop = action.crop;
  const valid =
    typeof crop === 'object' &&
    crop !== null &&
    typeof crop.originX === 'number' &&
    typeof crop.originY === 'number' &&
    typeof crop.width === 'number' &&
    typeof crop.height === 'number';
  if (!valid) {
    throw new TypeError(
      'Crop action must be an object of shape { originX: number; originY: number; width: number; height: number }'
    );
  }
}

function validateExtentAction(action: ActionExtent): void {
  const extent = action.extent;
  const valid =
    typeof extent === 'object' &&
    extent !== null &&
    (extent.backgroundColor == null || typeof extent.backgroundColor === 'string') &&
    (extent.originX == null || typeof extent.originX === 'number') &&
    (extent.originY == null || typeof extent.originY === 'number') &&
    typeof extent.width === 'number' &&
    typeof extent.height === 'number';
  if (!valid) {
    throw new TypeError(
      'Extent action must be an object of shape { backgroundColor?: string; originX?: number; originY?: number; width: number; height: number }'
    );
  }
}

function validateFlipAction(action: ActionFlip): void {
  if (action.flip !== FlipType.Horizontal && action.flip !== FlipType.Vertical) {
    throw new TypeError(`Unsupported flip type: ${String(action.flip)}`);
  }
}

function validateRotateAction(action: ActionRotate): void {
  if (typeof action.rotate !== 'number') throw new TypeError('Rotation must be a number');
}

function validateResizeAction(action: ActionResize): void {
  const resize = action.resize;
  const valid =
    typeof resize === 'object' &&
    resize !== null &&
    (typeof resize.width === 'number' || resize.width === undefined) &&
    (typeof resize.height === 'number' || resize.height === undefined);
  if (!valid) throw new TypeError('Resize action must be an object of shape { width?: number; height?: number }');
}

export function validateSaveOptions({ base64, compress, format }: SaveOptions): void {
  if (base64 !== undefined && typeof base64 !== 'boolean') throw new TypeError('The "base64" argument must be a boolean');
  if (compress !== undefined) {
    if (typeof compress !== 'number') throw new TypeError('The "compress" argument must be a number');
    if (compress < 0 || compress > 1) throw new TypeError('The "compress" argument must be a number between 0 and 1');
  }
  const allowed: SaveFormat[] = [SaveFormat.JPEG, SaveFormat.PNG, SaveFormat.WEBP];
  if (format !== undefined && !allowed.includes(format)) {
    throw new TypeError(`The "format" argument must be one of: ${allowed.join(', ')}`);
  }
}

export function validateArguments(uri: string, actions: Action[], saveOptions: SaveOptions): void {
  validateUri(uri);
  validateActions(actions);
  validateSaveOptions(saveOptions);
}

// ---------------------------------------------------------------------------
// ImageRef / ImageManipulatorContext
// ---------------------------------------------------------------------------

/** A reference to a rendered image. `release()` exists for parity; there is no native handle to free. */
export class ImageRef {
  readonly nativeRefType = 'image';
  readonly uri: string;
  private canvas: ManipulatorCanvas;

  constructor(uri: string, canvas: ManipulatorCanvas) {
    this.uri = uri;
    this.canvas = canvas;
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  release(): void {}

  async saveAsync(options: SaveOptions = { base64: false }): Promise<ImageResult> {
    const requestedType = `image/${options.format ?? SaveFormat.JPEG}`;
    const blob = await canvasToBlob(this.canvas, requestedType, options.compress);
    if (blob.type && blob.type !== requestedType) {
      // A browser that cannot encode the requested type quietly hands back PNG;
      // returning that as if it were the requested format would be a lie.
      throw imError(
        'ERR_IMAGE_MANIPULATOR_FORMAT',
        `This browser cannot encode "${requestedType}" images — it produced "${blob.type}" instead. Try JPEG or PNG.`
      );
    }
    return {
      uri: objectUrlFor(blob),
      width: this.width,
      height: this.height,
      base64: options.base64 ? await blobToBase64(blob) : undefined,
    };
  }
}

type CanvasLoader = () => ManipulatorCanvas | Promise<ManipulatorCanvas>;

/**
 * Chainable manipulation context. Each call queues a transformation on a
 * promise chain — the calls are synchronous and return `this`, exactly as
 * upstream, and `renderAsync()` awaits the whole chain.
 */
export class ImageManipulatorContext {
  private loader: CanvasLoader;
  private task: Promise<ManipulatorCanvas> | undefined;

  constructor(loader: CanvasLoader) {
    this.loader = loader;
  }

  private get currentTask(): Promise<ManipulatorCanvas> {
    if (!this.task) this.task = Promise.resolve().then(() => this.loader());
    return this.task;
  }

  private addTask(step: (canvas: ManipulatorCanvas) => ManipulatorCanvas): ImageManipulatorContext {
    this.task = this.currentTask.then(step);
    return this;
  }

  resize(size: { width?: number | null; height?: number | null }): ImageManipulatorContext {
    return this.addTask((canvas) =>
      resizeAction(canvas, { width: size.width ?? undefined, height: size.height ?? undefined })
    );
  }

  rotate(degrees: number): ImageManipulatorContext {
    return this.addTask((canvas) => rotateAction(canvas, degrees));
  }

  flip(flipType: FlipType): ImageManipulatorContext {
    return this.addTask((canvas) => flipAction(canvas, flipType));
  }

  crop(rect: ActionCrop['crop']): ImageManipulatorContext {
    return this.addTask((canvas) => cropAction(canvas, rect));
  }

  /** @platform web — upstream only implements extent on web, and so does this. */
  extent(options: ActionExtent['extent']): ImageManipulatorContext {
    return this.addTask((canvas) => extentAction(canvas, options));
  }

  reset(): ImageManipulatorContext {
    this.task = Promise.resolve().then(() => this.loader());
    return this;
  }

  release(): void {
    this.task = undefined;
  }

  async renderAsync(): Promise<ImageRef> {
    const canvas = await this.currentTask;
    // The ref gets its own copy: the context may keep drawing on the original,
    // and saveAsync must be able to re-encode at a different format/quality.
    const copy = createCanvas(canvas.width, canvas.height);
    getContext(copy).drawImage(canvas, 0, 0);
    // PNG for the ref's own uri so it is lossless; saveAsync re-encodes.
    const blob = await canvasToBlob(canvas, 'image/png');
    return new ImageRef(objectUrlFor(blob), copy);
  }
}

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

/** Anything `manipulate` accepts: a uri, or a rendered ref carrying one. */
export type ImageManipulatorSource = string | ImageRef | { uri: string };

function loaderFor(source: ImageManipulatorSource): CanvasLoader {
  if (typeof source === 'string') return () => loadImageCanvas(source);
  if (typeof source === 'object' && source !== null && typeof source.uri === 'string') {
    const uri = source.uri;
    return () => loadImageCanvas(uri);
  }
  throw imError('ERR_IMAGE_MANIPULATOR_SOURCE', `Source not supported: ${String(source)}`);
}

/**
 * The module object upstream exports under this name (its NativeModule
 * instance), so `ImageManipulator.manipulate(uri)` reads the same here.
 */
const imageManipulatorModule = {
  Context: ImageManipulatorContext,
  Image: ImageRef,
  manipulate(source: ImageManipulatorSource): ImageManipulatorContext {
    return new ImageManipulatorContext(loaderFor(source));
  },
};

export const ImageManipulator = imageManipulatorModule;
/** Upstream declares `ImageManipulator` as a class, so the name is a type too. */
export type ImageManipulator = typeof imageManipulatorModule;

/**
 * @deprecated Upstream replaced this with the contextual API
 * (`ImageManipulator.manipulate` / `useImageManipulator`). Kept because it is
 * still what most published code calls.
 */
export async function manipulateAsync(
  uri: string,
  actions: Action[] = [],
  saveOptions: SaveOptions = {}
): Promise<ImageResult> {
  validateArguments(uri, actions, saveOptions);
  const { format = SaveFormat.JPEG, ...rest } = saveOptions;
  const context = ImageManipulator.manipulate(uri);
  // Applied in array order — the actions compose, so the order is the result.
  for (const action of actions) {
    if ('resize' in action) context.resize(action.resize);
    else if ('rotate' in action) context.rotate(action.rotate);
    else if ('flip' in action) context.flip(action.flip);
    else if ('crop' in action) context.crop(action.crop);
    else if ('extent' in action) context.extent(action.extent);
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format, ...rest });
  context.release();
  image.release();
  return result;
}

/**
 * Upstream builds this on `useReleasingSharedObject`; the equivalent here is a
 * memo keyed on the source plus a release on unmount, since the context holds
 * canvases rather than a native handle.
 */
export function useImageManipulator(source: ImageManipulatorSource): ImageManipulatorContext {
  const key = typeof source === 'string' ? source : source.uri;
  const context = React.useMemo(() => ImageManipulator.manipulate(source), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => context.release(), [context]);
  return context;
}

const ImageManipulatorModule = {
  ImageManipulator,
  ImageManipulatorContext,
  ImageRef,
  SaveFormat,
  FlipType,
  manipulateAsync,
  useImageManipulator,
};

export default ImageManipulatorModule;
