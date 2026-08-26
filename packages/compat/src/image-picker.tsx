/**
 * Image-picker compat shim serving TWO aliased packages over one flow:
 *   - expo-image-picker → launchImageLibraryAsync/launchCameraAsync,
 *     permission helpers + hooks, MediaTypeOptions/MediaType
 *   - react-native-image-picker → launchImageLibrary/launchCamera with the
 *     documented dual promise/callback form
 *
 * The picker is a transient hidden <input type="file"> (capture="environment"
 * for the camera variants — mobile browsers open the camera, desktop falls
 * back to the file dialog). Selected files become object-URL assets (data-URL
 * fallback when createObjectURL is missing); image dimensions come from
 * createImageBitmap, falling back to a timeout-guarded Image element, else
 * 0x0. Cancellation is the input's 'cancel' event or an empty change — both
 * resolve the documented canceled shape ({canceled: true, assets: null} /
 * {didCancel: true}); nothing rejects on user action. In a DOM-less realm the
 * pickers resolve canceled immediately.
 *
 * Permissions resolve granted: the browser's file dialog IS the user consent
 * step, so there is no separate permission to deny ahead of it.
 */
import * as React from 'react';

// ---------------------------------------------------------------------------
// DOM plumbing
// ---------------------------------------------------------------------------

type InputFactory = () => HTMLInputElement;
let inputFactory: InputFactory | null = null;

/**
 * TEST-ONLY hook: inject the <input> the next pick will use so a test can
 * fire 'change'/'cancel' on it without a real file dialog. Pass null to
 * restore the default document.createElement path. Not part of either
 * package's API — do not use in app code.
 */
export function __setInputFactory(factory: InputFactory | null): void {
  inputFactory = factory;
}

interface PickRequest {
  accept: string;
  capture: boolean;
  multiple: boolean;
}

function pickFiles(request: PickRequest): Promise<File[] | null> {
  if (!inputFactory && typeof document === 'undefined') return Promise.resolve(null);
  const input = inputFactory ? inputFactory() : document.createElement('input');
  input.type = 'file';
  input.accept = request.accept;
  if (request.multiple) input.multiple = true;
  if (request.capture) input.setAttribute('capture', 'environment');
  let attached = false;
  if (!inputFactory && document.body) {
    input.style.display = 'none';
    document.body.appendChild(input);
    attached = true;
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (files: File[] | null): void => {
      if (settled) return;
      settled = true;
      if (attached) input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => {
      const files = input.files;
      done(files && files.length > 0 ? Array.from(files) : null);
    });
    input.addEventListener('cancel', () => done(null));
    try {
      input.click();
    } catch {
      done(null);
    }
  });
}

async function fileToUri(file: File): Promise<string> {
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return URL.createObjectURL(file);
    }
  } catch {
    /* fall through to data URL */
  }
  try {
    if (typeof FileReader !== 'undefined') {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }
  } catch {
    /* no readable representation */
  }
  return '';
}

function measureSize(file: File): Promise<{ width: number; height: number }> {
  const zero = { width: 0, height: 0 };
  if (!file.type.startsWith('image/')) return Promise.resolve(zero);
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then(
      (bitmap) => {
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
      },
      () => zero
    );
  }
  try {
    if (typeof Image !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(file);
      return new Promise((resolve) => {
        const img = new Image();
        // Hosts that never fire load/error (jsdom) must not hang the pick.
        const timer = setTimeout(() => resolve(zero), 3000);
        img.onload = () => {
          clearTimeout(timer);
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(zero);
        };
        img.src = url;
      });
    }
  } catch {
    /* fall through */
  }
  return Promise.resolve(zero);
}

// ---------------------------------------------------------------------------
// expo-image-picker surface
// ---------------------------------------------------------------------------

export const MediaTypeOptions = {
  All: 'All',
  Videos: 'Videos',
  Images: 'Images',
} as const;
export type MediaTypeOptions = (typeof MediaTypeOptions)[keyof typeof MediaTypeOptions];

export const MediaType = {
  images: 'images',
  videos: 'videos',
  livePhotos: 'livePhotos',
} as const;
export type MediaType = (typeof MediaType)[keyof typeof MediaType];

export interface ImagePickerAsset {
  assetId: string | null;
  uri: string;
  width: number;
  height: number;
  fileName: string | null;
  fileSize: number;
  mimeType: string;
  type: 'image' | 'video';
}

export interface ImagePickerResult {
  canceled: boolean;
  assets: ImagePickerAsset[] | null;
}

export interface ImagePickerOptions {
  mediaTypes?: MediaTypeOptions | MediaType | MediaType[];
  allowsMultipleSelection?: boolean;
  allowsEditing?: boolean;
  quality?: number;
  [key: string]: unknown;
}

function acceptFor(mediaTypes: ImagePickerOptions['mediaTypes']): string {
  const wants = (kind: 'image' | 'video'): boolean => {
    if (mediaTypes === undefined) return kind === 'image';
    const list = Array.isArray(mediaTypes) ? mediaTypes : [mediaTypes];
    return list.some((m) =>
      kind === 'image' ? m === 'All' || m === 'Images' || m === 'images' || m === 'livePhotos' : m === 'All' || m === 'Videos' || m === 'videos'
    );
  };
  const accept: string[] = [];
  if (wants('image')) accept.push('image/*');
  if (wants('video')) accept.push('video/*');
  return accept.length > 0 ? accept.join(',') : 'image/*';
}

async function toExpoAsset(file: File): Promise<ImagePickerAsset> {
  const [uri, size] = await Promise.all([fileToUri(file), measureSize(file)]);
  return {
    assetId: null,
    uri,
    width: size.width,
    height: size.height,
    fileName: file.name || null,
    fileSize: file.size,
    mimeType: file.type,
    type: file.type.startsWith('video/') ? 'video' : 'image',
  };
}

export async function launchImageLibraryAsync(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
  const files = await pickFiles({
    accept: acceptFor(options.mediaTypes),
    capture: false,
    multiple: options.allowsMultipleSelection === true,
  });
  if (!files) return { canceled: true, assets: null };
  return { canceled: false, assets: await Promise.all(files.map(toExpoAsset)) };
}

export async function launchCameraAsync(options: ImagePickerOptions = {}): Promise<ImagePickerResult> {
  const files = await pickFiles({ accept: acceptFor(options.mediaTypes), capture: true, multiple: false });
  if (!files) return { canceled: true, assets: null };
  return { canceled: false, assets: await Promise.all(files.map(toExpoAsset)) };
}

export interface PermissionResponse {
  status: 'granted';
  granted: true;
  canAskAgain: true;
  expires: 'never';
}

function granted(): PermissionResponse {
  return { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };
}

export async function requestMediaLibraryPermissionsAsync(_writeOnly?: boolean): Promise<PermissionResponse> {
  return granted();
}
export async function getMediaLibraryPermissionsAsync(_writeOnly?: boolean): Promise<PermissionResponse> {
  return granted();
}
export async function requestCameraPermissionsAsync(): Promise<PermissionResponse> {
  return granted();
}
export async function getCameraPermissionsAsync(): Promise<PermissionResponse> {
  return granted();
}

type PermissionHookResult = [PermissionResponse, () => Promise<PermissionResponse>, () => Promise<PermissionResponse>];

function usePermissions(): PermissionHookResult {
  return React.useMemo<PermissionHookResult>(() => [granted(), async () => granted(), async () => granted()], []);
}

export function useMediaLibraryPermissions(): PermissionHookResult {
  return usePermissions();
}
export function useCameraPermissions(): PermissionHookResult {
  return usePermissions();
}

// ---------------------------------------------------------------------------
// react-native-image-picker surface
// ---------------------------------------------------------------------------

export interface Asset {
  uri: string;
  width: number;
  height: number;
  fileName: string | null;
  fileSize: number;
  /** react-native-image-picker puts the mime type in `type`. */
  type: string;
}

export interface ImagePickerResponse {
  didCancel?: boolean;
  errorCode?: string;
  errorMessage?: string;
  assets?: Asset[];
}

export interface OptionsCommon {
  mediaType?: 'photo' | 'video' | 'mixed';
  selectionLimit?: number;
  [key: string]: unknown;
}

export type Callback = (response: ImagePickerResponse) => void;

function acceptForRNIP(mediaType: OptionsCommon['mediaType']): string {
  if (mediaType === 'video') return 'video/*';
  if (mediaType === 'mixed') return 'image/*,video/*';
  return 'image/*';
}

async function toRNIPAsset(file: File): Promise<Asset> {
  const [uri, size] = await Promise.all([fileToUri(file), measureSize(file)]);
  return {
    uri,
    width: size.width,
    height: size.height,
    fileName: file.name || null,
    fileSize: file.size,
    type: file.type,
  };
}

async function launchRNIP(request: PickRequest, callback?: Callback): Promise<ImagePickerResponse> {
  const files = await pickFiles(request);
  const response: ImagePickerResponse = files
    ? { assets: await Promise.all(files.map(toRNIPAsset)) }
    : { didCancel: true };
  callback?.(response);
  return response;
}

export function launchImageLibrary(options: OptionsCommon = {}, callback?: Callback): Promise<ImagePickerResponse> {
  // selectionLimit 1 is the documented default; 0 means unlimited.
  const multiple = options.selectionLimit !== undefined && options.selectionLimit !== 1;
  return launchRNIP({ accept: acceptForRNIP(options.mediaType), capture: false, multiple }, callback);
}

export function launchCamera(options: OptionsCommon = {}, callback?: Callback): Promise<ImagePickerResponse> {
  return launchRNIP({ accept: acceptForRNIP(options.mediaType), capture: true, multiple: false }, callback);
}

// ---------------------------------------------------------------------------
// iOS picker-configuration enums.
//
// These describe how the *native* iOS picker presents itself and what it hands
// back. A file input has none of those knobs, so the values exist to satisfy
// module-scope imports (one missing name breaks the whole ESM module) and to
// let option objects keep type-checking; they are not consulted.
// ---------------------------------------------------------------------------

export const UIImagePickerPreferredAssetRepresentationMode = {
  Automatic: 'automatic',
  Compatible: 'compatible',
  Current: 'current',
} as const;
export type UIImagePickerPreferredAssetRepresentationMode =
  (typeof UIImagePickerPreferredAssetRepresentationMode)[keyof typeof UIImagePickerPreferredAssetRepresentationMode];

export const UIImagePickerPresentationStyle = {
  FullScreen: 'fullScreen',
  PageSheet: 'pageSheet',
  FormSheet: 'formSheet',
  CurrentContext: 'currentContext',
  OverFullScreen: 'overFullScreen',
  OverCurrentContext: 'overCurrentContext',
  Popover: 'popover',
  BlurOverFullScreen: 'blurOverFullScreen',
  Automatic: 'automatic',
} as const;
export type UIImagePickerPresentationStyle =
  (typeof UIImagePickerPresentationStyle)[keyof typeof UIImagePickerPresentationStyle];

export const UIImagePickerControllerQualityType = {
  High: 0,
  Medium: 1,
  Low: 2,
  VGA640x480: 3,
  IFrame1280x720: 4,
  IFrame960x540: 5,
} as const;
export type UIImagePickerControllerQualityType =
  (typeof UIImagePickerControllerQualityType)[keyof typeof UIImagePickerControllerQualityType];

export const VideoExportPreset = {
  Passthrough: 0,
  LowQuality: 1,
  MediumQuality: 2,
  HighestQuality: 3,
  H264_640x480: 4,
  H264_960x540: 5,
  H264_1280x720: 6,
  H264_1920x1080: 7,
  H264_3840x2160: 8,
  HEVC_1920x1080: 9,
  HEVC_3840x2160: 10,
} as const;
export type VideoExportPreset = (typeof VideoExportPreset)[keyof typeof VideoExportPreset];

/** Which camera a launch would prefer; the browser picks its own. */
export const CameraType = { back: 'back', front: 'front' } as const;
export type CameraType = (typeof CameraType)[keyof typeof CameraType];
