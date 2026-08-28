/**
 * expo-media-library compat shim — a browser has no photo library.
 *
 * The one honest mapping is the save half: a browser CAN hand the user a
 * file. `saveToLibraryAsync` / `createAssetAsync` / `Asset.create` resolve the
 * uri's bytes (VFS entries through the file-system shim, `blob:`/`data:`/http
 * sources through fetch), wrap them in a Blob, and click a transient
 * `<a download>`. The read half has nothing behind it: there is no API that
 * lets a page enumerate the user's photos, so every album and asset query
 * resolves EMPTY rather than throwing — a gallery screen renders its empty
 * state instead of an error boundary.
 *
 * Ceilings, stated plainly:
 * - **A download is not a library write.** The file lands wherever the browser
 *   puts downloads, under a name the browser may change. Nothing the app
 *   "saved" can be read back: the asset it gets is a description of what was
 *   handed over, not a handle on anything.
 * - **Albums are permanently empty.** getAlbumsAsync/getAssetsAsync/Query all
 *   resolve empty, getAlbumAsync resolves null, and the mutating album calls
 *   (add/remove/delete/favorite) honestly report `false`.
 * - **No change events.** `addListener` returns a real subscription that never
 *   fires, because nothing outside the page can change a library that does not
 *   exist.
 * - **The download may be blocked.** A cross-origin source without CORS cannot
 *   be read into a Blob; the shim then falls back to a plain anchor on the raw
 *   uri and warns, which the browser may navigate to instead of downloading.
 *
 * Permissions resolve GRANTED, on the same reasoning as permissions.ts and
 * image-picker.tsx: the browser's own download UI is the consent step, so
 * there is no separate grant to withhold ahead of it, and a permission gate
 * here would only block app flows behind a dialog that cannot exist.
 *
 * SDK 57 serves two surfaces from this package — the class API on the root
 * (`Asset`, `Album`, `Query`) and the function API on
 * `expo-media-library/legacy`. One aliased module answers both, so where the
 * two disagree on a name this file exports the union and says so at the
 * declaration.
 */
import * as React from 'react';

import { File as VirtualFile } from './file-system';

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

// ---------------------------------------------------------------------------
// Enums and constants
// ---------------------------------------------------------------------------

/**
 * The two surfaces disagree: the legacy API's MediaType is
 * `{audio, photo, video, unknown}` and the class API's is
 * `{UNKNOWN, IMAGE, AUDIO, VIDEO}` — and note that a still image is 'photo'
 * in one vocabulary and 'image' in the other. One aliased module cannot export
 * two constants under one name, so this is the union of both key sets;
 * `MediaType.photo` and `MediaType.IMAGE` each resolve to their own surface's
 * value.
 */
export const MediaType = {
  audio: 'audio',
  photo: 'photo',
  video: 'video',
  unknown: 'unknown',
  UNKNOWN: 'unknown',
  IMAGE: 'image',
  AUDIO: 'audio',
  VIDEO: 'video',
} as const;
export type MediaTypeValue = 'audio' | 'photo' | 'video' | 'unknown' | 'pairedVideo';
export type MediaTypeNext = 'unknown' | 'image' | 'audio' | 'video';

/** Supported keys for sorting `getAssetsAsync` results. */
export const SortBy = {
  default: 'default',
  mediaType: 'mediaType',
  width: 'width',
  height: 'height',
  creationTime: 'creationTime',
  modificationTime: 'modificationTime',
  duration: 'duration',
} as const;
export type SortByKey = keyof typeof SortBy;
export type SortByValue = [SortByKey, boolean] | SortByKey;
export type MediaTypeObject = { audio: 'audio'; photo: 'photo'; video: 'video'; unknown: 'unknown' };
export type SortByObject = typeof SortBy;

/** Fields the class API's `Query` can filter and order by. */
export const AssetField = {
  CREATION_TIME: 'creationTime',
  MODIFICATION_TIME: 'modificationTime',
  MEDIA_TYPE: 'mediaType',
  WIDTH: 'width',
  HEIGHT: 'height',
  DURATION: 'duration',
  IS_FAVORITE: 'isFavorite',
} as const;
export type AssetField = (typeof AssetField)[keyof typeof AssetField];
export type AssetFieldValueMap = Record<AssetField, never>;

/** iOS PHAssetMediaSubtype variants. Nothing here can produce one. */
export const MediaSubtype = {
  DEPTH_EFFECT: 'depthEffect',
  HDR: 'hdr',
  HIGH_FRAME_RATE: 'highFrameRate',
  LIVE_PHOTO: 'livePhoto',
  PANORAMA: 'panorama',
  SCREENSHOT: 'screenshot',
  STREAM: 'stream',
  TIME_LAPSE: 'timelapse',
  SPATIAL_MEDIA: 'spatialMedia',
  VIDEO_CINEMATIC: 'videoCinematic',
} as const;
export type MediaSubtype = (typeof MediaSubtype)[keyof typeof MediaSubtype];

export const PermissionStatus = {
  GRANTED: 'granted',
  UNDETERMINED: 'undetermined',
  DENIED: 'denied',
} as const;
export type PermissionStatus = (typeof PermissionStatus)[keyof typeof PermissionStatus];

export type MediaTypeFilter = 'photo' | 'video';
export type GranularPermission = 'audio' | 'photo' | 'video';
export type AlbumType = 'album' | 'moment' | 'smartAlbum';
export type Location = { latitude: number; longitude: number };
export type Shape = { width: number; height: number };
export type PermissionExpiration = 'never' | number;

export type EXPermissionResponse = {
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
  expires: PermissionExpiration;
};

export type PermissionResponse = EXPermissionResponse & {
  accessPrivileges?: 'all' | 'limited' | 'none';
};

export type PermissionHookOptions<T> = T & { get?: boolean; request?: boolean };

export type EventSubscription = { remove(): void };
export type Subscription = EventSubscription;

export type MediaLibraryAssetsChangeEvent = {
  hasIncrementalChanges: boolean;
  insertedAssets?: unknown[];
  deletedAssets?: unknown[];
  updatedAssets?: unknown[];
};

export type MediaLibraryAssetInfoQueryOptions = { shouldDownloadFromNetwork?: boolean };
export type AlbumsOptions = { includeSmartAlbums?: boolean };
export type SortDescriptor = { key: AssetField; ascending?: boolean };

export type AssetsOptions = {
  first?: number;
  after?: AssetRef;
  album?: AlbumRef;
  sortBy?: SortByValue[] | SortByValue;
  mediaType?: MediaTypeValue[] | MediaTypeValue;
  mediaSubtypes?: MediaSubtype[] | MediaSubtype;
  createdAfter?: Date | number;
  createdBefore?: Date | number;
  resolveWithFullInfo?: boolean;
};

export type PagedInfo<T> = {
  assets: T[];
  endCursor: string;
  hasNextPage: boolean;
  totalCount: number;
};

export type AssetInfo = Asset & {
  localUri?: string;
  location?: Location;
  exif?: object;
  isFavorite?: boolean;
  isNetworkAsset?: boolean;
  orientation?: number;
  pairedVideoAsset?: Asset | null;
};

export type AssetMetadata = {
  id: string;
  filename: string | null;
  mediaType: MediaTypeNext;
  width: number | null;
  height: number | null;
  duration: number | null;
  creationTime: number | null;
  modificationTime: number | null;
  isFavorite: boolean;
};

export type AssetRef = Asset | string;
export type AlbumRef = Album | string;

// ---------------------------------------------------------------------------
// The one real capability: handing the user a file
// ---------------------------------------------------------------------------

interface SavedFile {
  bytes: Uint8Array | null;
  mimeType: string;
  filename: string;
}

function filenameFor(uri: string): string {
  const withoutQuery = uri.split('?')[0] ?? uri;
  const name = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  // blob: uris end in an opaque uuid and data: uris have no name at all.
  return name && name.includes('.') ? name : `media-${Date.now()}`;
}

async function resolveForDownload(uri: string): Promise<SavedFile> {
  const filename = filenameFor(uri);
  try {
    // The file-system shim reads its own file:// uris and fetches everything
    // else, so one call covers VFS entries, object URLs, data: and http(s).
    const file = new VirtualFile(uri);
    return { bytes: await file.bytes(), mimeType: file.type, filename };
  } catch {
    return { bytes: null, mimeType: '', filename };
  }
}

/**
 * Clicks a transient `<a download>`. The object URL is minted here and revoked
 * here, so a caller's own blob uri is never invalidated by saving it.
 */
function clickDownload(href: string, filename: string, ownsUrl: boolean): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body?.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    if (ownsUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      // Revoking synchronously can race the download in some browsers; a task
      // tick is enough for the click to have taken the reference.
      setTimeout(() => URL.revokeObjectURL(href), 0);
    }
  }
}

async function downloadToUser(uri: string): Promise<SavedFile> {
  const resolved = await resolveForDownload(uri);
  if (typeof document === 'undefined') {
    warnOnce('no-document', 'compat media-library: no document in this realm, so nothing was handed to the user.');
    return resolved;
  }
  const canMintUrl = typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function';
  if (resolved.bytes && canMintUrl) {
    const blob = new Blob([new Uint8Array(resolved.bytes)], { type: resolved.mimeType || 'application/octet-stream' });
    clickDownload(URL.createObjectURL(blob), resolved.filename, true);
    return resolved;
  }
  warnOnce(
    'raw-anchor',
    'compat media-library: could not read the source into a Blob (cross-origin without CORS, or no createObjectURL). ' +
      'Falling back to a plain anchor on the uri, which the browser may navigate to rather than download.'
  );
  clickDownload(uri, resolved.filename, false);
  return resolved;
}

/** Real dimensions when the browser can decode the bytes; 0x0 otherwise. */
async function measure(file: SavedFile): Promise<Shape> {
  const zero = { width: 0, height: 0 };
  if (!file.bytes || typeof createImageBitmap !== 'function') return zero;
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }));
    const shape = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return shape;
  } catch {
    return zero;
  }
}

function legacyMediaTypeFor(mimeType: string, filename: string): MediaTypeValue {
  const probe = mimeType || filename.toLowerCase();
  if (probe.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(probe)) return 'video';
  if (probe.startsWith('audio/') || /\.(mp3|m4a|wav|aac)$/.test(probe)) return 'audio';
  if (probe.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|avif)$/.test(probe)) return 'photo';
  return 'unknown';
}

function nextMediaTypeFor(legacy: MediaTypeValue): MediaTypeNext {
  return legacy === 'photo' ? 'image' : legacy === 'pairedVideo' ? 'video' : legacy;
}

// ---------------------------------------------------------------------------
// Asset / Album / Query — the class API
//
// These carry the legacy plain-object FIELDS as well as the class API's
// getters, so `asset.uri` (legacy) and `await asset.getUri()` (class API) both
// work off one object and `createAssetAsync` can return something the legacy
// callers destructure.
// ---------------------------------------------------------------------------

export class Asset {
  id: string;
  filename: string;
  uri: string;
  /** Legacy vocabulary ('photo'); `getMediaType()` answers in the class API's ('image'). */
  mediaType: MediaTypeValue;
  mediaSubtypes?: MediaSubtype[];
  width: number;
  height: number;
  creationTime: number;
  modificationTime: number;
  duration: number;
  albumId?: string;

  /**
   * Upstream's constructor takes only an id; the optional second argument lets
   * `createAssetAsync` return a populated instance instead of a bare handle.
   */
  constructor(id: string, fields: Partial<Omit<Asset, 'id'>> = {}) {
    const now = Date.now();
    this.id = id;
    this.filename = fields.filename ?? filenameFor(id);
    this.uri = fields.uri ?? id;
    this.mediaType = fields.mediaType ?? 'unknown';
    this.width = fields.width ?? 0;
    this.height = fields.height ?? 0;
    this.creationTime = fields.creationTime ?? now;
    this.modificationTime = fields.modificationTime ?? now;
    this.duration = fields.duration ?? 0;
  }

  async getCreationTime(): Promise<number | null> {
    return this.creationTime;
  }

  async getModificationTime(): Promise<number | null> {
    return this.modificationTime;
  }

  async getDuration(): Promise<number | null> {
    return this.mediaType === 'video' || this.mediaType === 'audio' ? this.duration : null;
  }

  async getFilename(): Promise<string> {
    return this.filename;
  }

  async getWidth(): Promise<number> {
    return this.width;
  }

  async getHeight(): Promise<number> {
    return this.height;
  }

  async getShape(): Promise<Shape | null> {
    return this.width && this.height ? { width: this.width, height: this.height } : null;
  }

  async getUri(): Promise<string> {
    return this.uri;
  }

  async getMediaType(): Promise<MediaTypeNext> {
    return nextMediaTypeFor(this.mediaType);
  }

  async getMediaSubtypes(): Promise<MediaSubtype[]> {
    return [];
  }

  async getLivePhotoVideoUri(): Promise<string | null> {
    return null;
  }

  async getIsInCloud(): Promise<boolean> {
    return false;
  }

  async getOrientation(): Promise<number | null> {
    return null;
  }

  async getInfo(): Promise<AssetInfo> {
    return { ...this, isFavorite: false } as AssetInfo;
  }

  /** There are no albums to belong to — see the header ceiling. */
  async getAlbums(): Promise<Album[]> {
    return [];
  }

  async getLocation(): Promise<Location | null> {
    return null;
  }

  async getExif(): Promise<Record<string, unknown>> {
    return {};
  }

  async getFavorite(): Promise<boolean> {
    return false;
  }

  async setFavorite(_isFavorite: boolean): Promise<void> {
    warnOnce('favorite', 'compat media-library: there is no library to mark favorites in; setFavorite is a no-op.');
  }

  /** A download, not a library write. The returned asset describes what was handed over. */
  static async create(filePath: string, _album?: Album): Promise<Asset> {
    return createAssetAsync(filePath);
  }

  static async delete(_assets: Asset[]): Promise<void> {
    warnOnce('delete-assets', 'compat media-library: nothing was saved to a library, so there is nothing to delete.');
  }
}

export class Album {
  id: string;
  title: string;
  assetCount: number;
  type?: AlbumType;
  startTime: number;
  endTime: number;
  locationNames?: string[];
  approximateLocation?: Location;

  constructor(id: string, fields: Partial<Omit<Album, 'id'>> = {}) {
    this.id = id;
    this.title = fields.title ?? id;
    this.assetCount = fields.assetCount ?? 0;
    this.startTime = fields.startTime ?? 0;
    this.endTime = fields.endTime ?? 0;
  }

  async getAssets(): Promise<Asset[]> {
    return [];
  }

  async getTitle(): Promise<string> {
    return this.title;
  }

  async delete(): Promise<void> {
    warnOnce('delete-album', 'compat media-library: albums are not modelled here; delete is a no-op.');
  }

  async add(_assets: Asset | Asset[]): Promise<void> {
    warnOnce('album-add', 'compat media-library: albums are not modelled here; add is a no-op.');
  }

  async removeAssets(_assets: Asset[]): Promise<void> {
    warnOnce('album-remove', 'compat media-library: albums are not modelled here; removeAssets is a no-op.');
  }

  static async create(name: string, assetsRefs: string[] | Asset[], _moveAssets?: boolean): Promise<Album> {
    warnOnce(
      'album-create',
      'compat media-library: there is no photo library to create an album in. The returned Album is a handle to nothing; ' +
        'its assets were downloaded to the user instead.'
    );
    for (const ref of assetsRefs) await downloadToUser(typeof ref === 'string' ? ref : ref.uri);
    return new Album(name, { title: name });
  }

  static async delete(_albums: Album[], _deleteAssets?: boolean): Promise<void> {
    warnOnce('delete-albums', 'compat media-library: albums are not modelled here; delete is a no-op.');
  }

  /** Upstream types this `Promise<Album>` but documents (and returns) null when absent. */
  static async get(_title: string): Promise<Album | null> {
    return null;
  }

  static async getAll(): Promise<Album[]> {
    return [];
  }
}

/** The class API's query builder. Chains fine; there is nothing to match. */
export class Query {
  eq(_field: AssetField, _value: unknown): Query {
    return this;
  }
  within(_field: AssetField, _value: unknown[]): Query {
    return this;
  }
  gt(_field: AssetField, _value: number): Query {
    return this;
  }
  gte(_field: AssetField, _value: number): Query {
    return this;
  }
  lt(_field: AssetField, _value: number): Query {
    return this;
  }
  lte(_field: AssetField, _value: number): Query {
    return this;
  }
  limit(_limit: number): Query {
    return this;
  }
  offset(_offset: number): Query {
    return this;
  }
  orderBy(_sortDescriptors: SortDescriptor | AssetField): Query {
    return this;
  }
  album(_album: Album): Query {
    return this;
  }
  async exe(): Promise<Asset[]> {
    return [];
  }
  async exeForMetadata(): Promise<AssetMetadata[]> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function granted(): PermissionResponse {
  return {
    status: PermissionStatus.GRANTED,
    granted: true,
    canAskAgain: true,
    expires: 'never',
    // 'all' rather than 'limited': nothing here is a partial grant, it is a
    // different mechanism (the browser's download UI) entirely.
    accessPrivileges: 'all',
  };
}

export async function requestPermissionsAsync(
  _writeOnly?: boolean,
  _granularPermissions?: GranularPermission[]
): Promise<PermissionResponse> {
  return granted();
}

export async function getPermissionsAsync(
  _writeOnly?: boolean,
  _granularPermissions?: GranularPermission[]
): Promise<PermissionResponse> {
  return granted();
}

type PermissionHookResult = [PermissionResponse, () => Promise<PermissionResponse>, () => Promise<PermissionResponse>];

/**
 * Upstream's hook starts at `null` and fills in after an async round trip.
 * There is nothing to await here, so the response is available on the first
 * render — which is compatible with the `PermissionResponse | null` the
 * callers are typed against, and spares them a flash of "checking...".
 */
export const usePermissions = (
  _options?: PermissionHookOptions<{ writeOnly?: boolean; granularPermissions?: GranularPermission[] }>
): PermissionHookResult =>
  React.useMemo<PermissionHookResult>(() => [granted(), async () => granted(), async () => granted()], []);

/** Only shown on iOS/Android when access is 'limited'; there is no such state here. */
export async function presentPermissionsPicker(_mediaTypes?: MediaTypeFilter[]): Promise<void> {}

/** The legacy spelling of presentPermissionsPicker. */
export async function presentPermissionsPickerAsync(_mediaTypes?: MediaTypeFilter[]): Promise<void> {}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/**
 * Reports true: the save path really works. The read path does not, and every
 * query below says so by resolving empty — gating a save button on this should
 * enable it.
 */
export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

/** Hands the file to the user. Unlike upstream, nothing is returned to read back. */
export async function saveToLibraryAsync(localUri: string): Promise<void> {
  await downloadToUser(localUri);
}

/**
 * Downloads the file and describes it as an Asset. The id and uri are the
 * source uri: there is no library id to mint, and pretending otherwise would
 * hand back a handle that resolves to nothing.
 */
export async function createAssetAsync(localUri: string, _album?: AlbumRef): Promise<Asset> {
  const saved = await downloadToUser(localUri);
  const shape = await measure(saved);
  const mediaType = legacyMediaTypeFor(saved.mimeType, saved.filename);
  const now = Date.now();
  return new Asset(localUri, {
    filename: saved.filename,
    uri: localUri,
    mediaType,
    width: shape.width,
    height: shape.height,
    creationTime: now,
    modificationTime: now,
    duration: 0,
  });
}

// ---------------------------------------------------------------------------
// Queries — empty, never throwing. See the header ceiling.
// ---------------------------------------------------------------------------

export async function getAssetsAsync(_assetsOptions?: AssetsOptions): Promise<PagedInfo<Asset>> {
  return { assets: [], endCursor: '', hasNextPage: false, totalCount: 0 };
}

export async function getAlbumsAsync(_options?: AlbumsOptions): Promise<Album[]> {
  return [];
}

/** Upstream types this `Promise<Album>` but documents (and returns) null when absent. */
export async function getAlbumAsync(_title: string): Promise<Album | null> {
  return null;
}

export async function getAssetInfoAsync(asset: AssetRef, _options?: MediaLibraryAssetInfoQueryOptions): Promise<AssetInfo> {
  const resolved = typeof asset === 'string' ? new Asset(asset) : asset;
  return { ...resolved, localUri: resolved.uri, isFavorite: false } as AssetInfo;
}

/** There are no content:// uris in a browser; the asset's own uri is the handle. */
export async function getAssetContentUriAsync(asset: AssetRef): Promise<string> {
  return typeof asset === 'string' ? asset : asset.uri;
}

export async function getMomentsAsync(): Promise<Album[]> {
  return [];
}

export async function createAlbumAsync(
  albumName: string,
  asset?: AssetRef,
  _copyAsset?: boolean,
  initialAssetLocalUri?: string
): Promise<Album> {
  const source = typeof asset === 'string' ? asset : (asset?.uri ?? initialAssetLocalUri);
  return Album.create(albumName, source ? [source] : []);
}

export async function addAssetsToAlbumAsync(_assets: AssetRef[] | AssetRef, _album: AlbumRef, _copy?: boolean): Promise<boolean> {
  warnOnce('add-to-album', 'compat media-library: albums are not modelled here; addAssetsToAlbumAsync reports false.');
  return false;
}

export async function removeAssetsFromAlbumAsync(_assets: AssetRef[] | AssetRef, _album: AlbumRef): Promise<boolean> {
  return false;
}

export async function deleteAssetsAsync(_assets: AssetRef[] | AssetRef): Promise<boolean> {
  warnOnce('delete-assets-fn', 'compat media-library: a download cannot be recalled; deleteAssetsAsync reports false.');
  return false;
}

export async function deleteAlbumsAsync(_albums: AlbumRef[] | AlbumRef, _assetRemove?: boolean): Promise<boolean> {
  return false;
}

export async function setAssetFavoriteAsync(_asset: AssetRef, _isFavorite: boolean): Promise<boolean> {
  return false;
}

/** Android scoped-storage migration; there is no album storage to migrate. */
export async function migrateAlbumIfNeededAsync(_album: AlbumRef): Promise<void> {}

export async function albumNeedsMigrationAsync(_album: AlbumRef): Promise<boolean> {
  return false;
}

// ---------------------------------------------------------------------------
// Change events — real subscriptions over a library that never changes.
// ---------------------------------------------------------------------------

const listeners = new Set<(event: MediaLibraryAssetsChangeEvent) => void>();

export function addListener(listener: (event: MediaLibraryAssetsChangeEvent) => void): EventSubscription {
  listeners.add(listener);
  return { remove: () => void listeners.delete(listener) };
}

export function removeSubscription(subscription: EventSubscription): void {
  subscription.remove();
}

export function removeAllListeners(): void {
  listeners.clear();
}

// ---------------------------------------------------------------------------
// Namespace default
//
// `import * as MediaLibrary from 'expo-media-library/legacy'` sees the named
// exports; this keeps the default-import and CJS-interop forms working too.
// ---------------------------------------------------------------------------

const MediaLibrary = {
  MediaType,
  SortBy,
  AssetField,
  MediaSubtype,
  PermissionStatus,
  Asset,
  Album,
  Query,
  isAvailableAsync,
  requestPermissionsAsync,
  getPermissionsAsync,
  usePermissions,
  presentPermissionsPicker,
  presentPermissionsPickerAsync,
  saveToLibraryAsync,
  createAssetAsync,
  getAssetsAsync,
  getAlbumsAsync,
  getAlbumAsync,
  getAssetInfoAsync,
  getAssetContentUriAsync,
  getMomentsAsync,
  createAlbumAsync,
  addAssetsToAlbumAsync,
  removeAssetsFromAlbumAsync,
  deleteAssetsAsync,
  deleteAlbumsAsync,
  setAssetFavoriteAsync,
  migrateAlbumIfNeededAsync,
  albumNeedsMigrationAsync,
  addListener,
  removeSubscription,
  removeAllListeners,
};

export default MediaLibrary;
