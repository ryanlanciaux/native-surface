/**
 * expo-file-system compat shim — one virtual filesystem, both SDK 57 APIs.
 *
 * SDK 57 ships two surfaces and real apps mix them in the same tree: the
 * object API at `expo-file-system` (File / Directory / Paths) and the
 * function API at `expo-file-system/legacy` (documentDirectory,
 * readAsStringAsync, downloadAsync, ...). Both specifiers alias to THIS file
 * and both read and write ONE virtual filesystem, so a file written with
 * `writeAsStringAsync` is visible to `new File(uri).text()` and vice versa.
 *
 * The VFS is a flat key/value store over localStorage (namespace
 * "rn-file-system:", mirroring mmkv.ts/async-storage.ts): one entry per path,
 * file bytes held as base64 so binary round-trips exactly, directories as
 * marker entries. localStorage being synchronous is what lets the object API
 * keep its synchronous members honest — `exists`, `size`, `textSync`,
 * `list()`, `create()`, `delete()` really do observe the store. With no
 * localStorage (SSR, privacy mode) the same store lives in a module-level Map
 * for the life of the JS realm: reads-after-writes stay consistent, nothing
 * survives a reload.
 *
 * Ceilings — reported, never worked around:
 * - **There is no disk.** localStorage is per-origin and quota-bound (~5MB in
 *   most browsers, and base64 costs another third on top of the byte count).
 *   A write past the quota throws ERR_FILESYSTEM_QUOTA naming the path and
 *   the limit instead of truncating; the previous contents survive intact.
 * - **A uri here is a key, not a path.** `file:///native-surface/...` resolves
 *   only inside this shim. Handing one to a real native module, an <img>
 *   src, or any transfer that does not go through these functions finds
 *   nothing.
 * - **Uploads are XHR/fetch.** There is no OS session: `sessionType`
 *   BACKGROUND is accepted and ignored, and a task dies with the page. Upload
 *   progress is real when XMLHttpRequest exists (only it reports
 *   `upload.onprogress`); the fetch fallback reports one final event.
 * - **Transfers obey CORS**, unlike a device. Downloads and uploads fail on
 *   hosts without Access-Control-Allow-Origin where a phone would not.
 * - **md5 is always null.** `info()` and the `md5` getter are synchronous and
 *   SubtleCrypto has no MD5 digest, so the shim reports the documented
 *   "cannot be read" value rather than shipping a hand-rolled digest.
 * - **Percent-escapes are literal.** Paths are keyed as written, so "a b" and
 *   "a%20b" are two different entries (a real device decodes them to one).
 * - **Watchers see this realm only.** Every mutation here is observed; another
 *   tab writing the same origin's localStorage is not.
 *
 * Sources OUTSIDE the VFS (`blob:`, `data:`, `http(s):` — for example an
 * object URL from the image-picker shim) are accepted by the asynchronous
 * entry points, which fetch them: `copyAsync`/`moveAsync` ingest them and
 * `File`'s async readers (`text`, `bytes`, `base64`, `arrayBuffer`) resolve
 * them. They are not VFS entries, so `exists` is false and the synchronous
 * readers and every writer throw — the asymmetry is honest, since nothing can
 * fetch synchronously.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Mirrors expo-modules-core's CodedError shape so `error.code` branches work. */
interface CodedFileSystemError extends Error {
  code: string;
}

function fsError(code: string, message: string): CodedFileSystemError {
  const error = new Error(message) as CodedFileSystemError;
  error.name = 'FileSystemError';
  error.code = code;
  return error;
}

// ---------------------------------------------------------------------------
// Backing store
// ---------------------------------------------------------------------------

const PREFIX = 'rn-file-system:';
const FILE_KEY = `${PREFIX}f:`;
const DIR_KEY = `${PREFIX}d:`;

/** Fallback store when localStorage is unavailable — see the header note. */
const memory = new Map<string, string>();

function backingStore(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch {
    /* SSR / privacy mode */
  }
  return null;
}

function readKey(key: string): string | null {
  const ls = backingStore();
  return ls ? ls.getItem(key) : (memory.get(key) ?? null);
}

/** Quota is the one storage failure an app can act on, so it gets its own code. */
function writeKey(key: string, value: string, subject: string): void {
  const ls = backingStore();
  if (!ls) {
    memory.set(key, value);
    return;
  }
  try {
    ls.setItem(key, value);
  } catch (e) {
    if (isQuotaError(e)) {
      throw fsError(
        'ERR_FILESYSTEM_QUOTA',
        `Cannot write ${subject} (${value.length} chars): the browser's localStorage quota — typically ~5MB per origin — is exhausted. ` +
          `This shim stores contents as base64, which costs about a third more than the raw byte count. ` +
          `Nothing was written, so the previous contents are intact; free space by deleting files.`
      );
    }
    throw e;
  }
}

function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  const code = (e as { code?: unknown } | null)?.code;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22;
}

function removeKey(key: string): void {
  const ls = backingStore();
  if (ls) ls.removeItem(key);
  else memory.delete(key);
}

function storeKeys(): string[] {
  const ls = backingStore();
  const keys: string[] = [];
  if (ls) {
    for (let i = 0; i < ls.length; i++) {
      const key = ls.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
  } else {
    for (const key of memory.keys()) if (key.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Encoding helpers
//
// Contents live as base64 because localStorage holds strings and a UTF-16
// string cannot carry arbitrary bytes losslessly.
// ---------------------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large file does not blow String.fromCharCode's argument limit.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  if (typeof btoa === 'function') return btoa(binary);
  return nodeBuffer().from(binary, 'binary').toString('base64');
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = typeof atob === 'function' ? atob(base64) : nodeBuffer().from(base64, 'base64').toString('binary');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface BufferLike {
  from(input: string, encoding: string): { toString(encoding: string): string };
}

/** Only reached in a realm without atob/btoa; vitest and every browser have them. */
function nodeBuffer(): BufferLike {
  const buffer = (globalThis as { Buffer?: BufferLike }).Buffer;
  if (!buffer) {
    throw fsError('ERR_FILESYSTEM_ENCODING', 'No base64 encoder available (atob/btoa and Buffer are both missing).');
  }
  return buffer;
}

function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Byte length of a base64 payload without paying to decode it. */
function base64ByteLength(base64: string): number {
  if (base64.length === 0) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function toBlob(bytes: Uint8Array, type: string): Blob {
  // Copied so the BlobPart is a plain-ArrayBuffer view; a SharedArrayBuffer-
  // backed one is not a legal BlobPart.
  return new Blob([new Uint8Array(bytes)], { type: type || 'application/octet-stream' });
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

function mimeTypeFor(path: string): string {
  return MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? '';
}

// ---------------------------------------------------------------------------
// Paths (the members `Paths` inherits from PathUtilities upstream)
// ---------------------------------------------------------------------------

const SCHEME = 'file://';
const ROOT = '/native-surface';
const DOCUMENT_PATH = `${ROOT}/documents`;
const CACHE_PATH = `${ROOT}/cache`;
const BUNDLE_PATH = `${ROOT}/bundle`;
/** Always present, so an app never has to create the directories it was handed. */
const IMPLICIT_DIRS: readonly string[] = ['/', ROOT, DOCUMENT_PATH, CACHE_PATH, BUNDLE_PATH];

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

type PathLike = string | File | Directory;

function pathString(value: PathLike): string {
  return typeof value === 'string' ? value : value.uri;
}

/** True for anything this store can key on: a file:// uri or a bare path. */
function isVfsUri(uri: string): boolean {
  return uri.startsWith(SCHEME) || !SCHEME_RE.test(uri);
}

/** Collapses `.`/`..`/duplicate slashes and drops the scheme; never trailing-slashed. */
function normalizePath(input: string): string {
  const raw = SCHEME_RE.test(input) ? input.replace(SCHEME_RE, '') : input;
  const segments: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/** Joins constructor arguments the way `new File(Paths.cache, 'a', 'b.txt')` expects. */
function resolvePath(uris: readonly PathLike[]): string {
  return normalizePath(uris.map(pathString).join('/'));
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

function basename(path: string, ext?: string): string {
  const normalized = normalizePath(path);
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return ext && name.endsWith(ext) && name !== ext ? name.slice(0, -ext.length) : name;
}

function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index);
}

function relativePath(from: string, to: string): string {
  const fromSegments = normalizePath(from).split('/').filter(Boolean);
  const toSegments = normalizePath(to).split('/').filter(Boolean);
  let shared = 0;
  while (shared < fromSegments.length && shared < toSegments.length && fromSegments[shared] === toSegments[shared]) {
    shared++;
  }
  const up = fromSegments.slice(shared).map(() => '..');
  return [...up, ...toSegments.slice(shared)].join('/');
}

function fileUri(path: string): string {
  return SCHEME + path;
}

function directoryUri(path: string): string {
  return `${SCHEME}${path === '/' ? '' : path}/`;
}

// ---------------------------------------------------------------------------
// VFS core — every public member of both APIs goes through these.
// ---------------------------------------------------------------------------

interface FileRecord {
  /** base64 contents */
  data: string;
  mtime: number;
  ctime: number;
  type: string;
}

interface DirRecord {
  mtime: number;
  ctime: number;
}

function parseRecord<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt entry (hand-edited storage, half-written value) reads as absent
    // rather than poisoning every later call.
    return null;
  }
}

function readFileRecord(path: string): FileRecord | null {
  return parseRecord<FileRecord>(readKey(FILE_KEY + path));
}

function readDirRecord(path: string): DirRecord | null {
  return parseRecord<DirRecord>(readKey(DIR_KEY + path));
}

function fileExists(path: string): boolean {
  return readKey(FILE_KEY + path) !== null;
}

function directoryExists(path: string): boolean {
  return IMPLICIT_DIRS.includes(path) || readKey(DIR_KEY + path) !== null;
}

function pathExists(path: string): boolean {
  return fileExists(path) || directoryExists(path);
}

/** Direct children only, as `readDirectoryAsync` / `Directory.list()` report them. */
function listChildren(path: string): { path: string; isDirectory: boolean }[] {
  const children: { path: string; isDirectory: boolean }[] = [];
  const seen = new Set<string>();
  const collect = (childPath: string, isDirectory: boolean): void => {
    if (childPath === path || seen.has(childPath) || dirname(childPath) !== path) return;
    seen.add(childPath);
    children.push({ path: childPath, isDirectory });
  };
  for (const key of storeKeys()) {
    if (key.startsWith(FILE_KEY)) collect(key.slice(FILE_KEY.length), false);
    else if (key.startsWith(DIR_KEY)) collect(key.slice(DIR_KEY.length), true);
  }
  for (const implicit of IMPLICIT_DIRS) collect(implicit, true);
  children.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return children;
}

function descendants(path: string): string[] {
  const prefix = `${path}/`;
  const out: string[] = [];
  for (const key of storeKeys()) {
    const child = key.startsWith(FILE_KEY)
      ? key.slice(FILE_KEY.length)
      : key.startsWith(DIR_KEY)
        ? key.slice(DIR_KEY.length)
        : null;
    if (child !== null && child.startsWith(prefix)) out.push(child);
  }
  return out;
}

function directorySize(path: string): number {
  const prefix = `${path}/`;
  let total = 0;
  for (const key of storeKeys()) {
    if (!key.startsWith(FILE_KEY)) continue;
    const child = key.slice(FILE_KEY.length);
    if (child.startsWith(prefix)) total += base64ByteLength(readFileRecord(child)?.data ?? '');
  }
  return total;
}

function usedBytes(): number {
  let total = 0;
  for (const key of storeKeys()) {
    if (key.startsWith(FILE_KEY)) total += base64ByteLength(readFileRecord(key.slice(FILE_KEY.length))?.data ?? '');
  }
  return total;
}

function requireParentDirectory(path: string): void {
  const parent = dirname(path);
  if (!directoryExists(parent)) {
    throw fsError(
      'ERR_FILESYSTEM_NO_PARENT',
      `Cannot create ${fileUri(path)}: the containing directory ${directoryUri(parent)} does not exist. ` +
        `Create it first (makeDirectoryAsync, or new Directory(uri).create({ intermediates: true })).`
    );
  }
}

function writeDirRecord(path: string): void {
  const now = Date.now();
  const record: DirRecord = { mtime: now, ctime: readDirRecord(path)?.ctime ?? now };
  writeKey(DIR_KEY + path, JSON.stringify(record), directoryUri(path));
}

function makeDirectory(path: string, options: { intermediates?: boolean; idempotent?: boolean } = {}): void {
  if (pathExists(path)) {
    if (options.idempotent || options.intermediates) return;
    throw fsError('ERR_FILESYSTEM_EXISTS', `Cannot create directory ${directoryUri(path)}: something already exists there.`);
  }
  if (options.intermediates) {
    let current = '';
    for (const segment of path.split('/').filter(Boolean)) {
      current += `/${segment}`;
      if (!directoryExists(current)) writeDirRecord(current);
    }
  } else {
    requireParentDirectory(path);
    writeDirRecord(path);
  }
  notifyWatchers('created', path, true);
}

function writeFileBytes(path: string, bytes: Uint8Array, options: { append?: boolean; type?: string } = {}): void {
  const existing = readFileRecord(path);
  if (!existing) requireParentDirectory(path);
  if (directoryExists(path)) {
    throw fsError('ERR_FILESYSTEM_IS_DIRECTORY', `Cannot write ${fileUri(path)}: that path is a directory.`);
  }
  const data =
    options.append && existing ? bytesToBase64(concatBytes(base64ToBytes(existing.data), bytes)) : bytesToBase64(bytes);
  const now = Date.now();
  const record: FileRecord = {
    data,
    mtime: now,
    ctime: existing?.ctime ?? now,
    type: options.type ?? existing?.type ?? mimeTypeFor(path),
  };
  writeKey(FILE_KEY + path, JSON.stringify(record), fileUri(path));
  notifyWatchers(existing ? 'modified' : 'created', path, false);
}

function readFileBytes(path: string): Uint8Array {
  const record = readFileRecord(path);
  if (!record) throw fsError('ERR_FILESYSTEM_NOT_FOUND', `File ${fileUri(path)} does not exist.`);
  return base64ToBytes(record.data);
}

function deletePath(path: string, options: { idempotent?: boolean; silent?: boolean } = {}): void {
  if (!pathExists(path)) {
    if (options.idempotent) return;
    throw fsError('ERR_FILESYSTEM_NOT_FOUND', `Cannot delete ${fileUri(path)}: it does not exist.`);
  }
  const isDirectory = directoryExists(path);
  if (isDirectory) {
    for (const child of descendants(path)) {
      removeKey(FILE_KEY + child);
      removeKey(DIR_KEY + child);
    }
  }
  removeKey(FILE_KEY + path);
  removeKey(DIR_KEY + path);
  if (!options.silent) notifyWatchers('deleted', path, isDirectory);
}

/**
 * Copies a file or directory tree and returns where it landed — copying INTO
 * an existing directory keeps the source's own name, as upstream does, so the
 * resolved target is what callers (and `move`) must go by.
 */
function copyPath(from: string, to: string, options: { overwrite?: boolean } = {}): string {
  const intoDirectory = directoryExists(to) && to !== from;
  const target = intoDirectory ? `${to}/${basename(from)}` : to;
  if (directoryExists(from)) {
    makeDirectory(target, { intermediates: true, idempotent: true });
    for (const child of listChildren(from)) copyPath(child.path, `${target}/${basename(child.path)}`, options);
    return target;
  }
  const record = readFileRecord(from);
  if (!record) throw fsError('ERR_FILESYSTEM_NOT_FOUND', `Cannot copy ${fileUri(from)}: it does not exist.`);
  if (pathExists(target) && options.overwrite === false) {
    throw fsError('ERR_FILESYSTEM_EXISTS', `Cannot copy to ${fileUri(target)}: something already exists there.`);
  }
  writeFileBytes(target, base64ToBytes(record.data), { type: record.type });
  return target;
}

function movePath(from: string, to: string, options: { overwrite?: boolean } = {}): string {
  const target = copyPath(from, to, options);
  const wasDirectory = directoryExists(from);
  // 'renamed' is the event a move produces upstream, so the copy/delete pair
  // this shim performs must not surface as created + deleted.
  deletePath(from, { idempotent: true, silent: true });
  notifyWatchers('renamed', from, wasDirectory);
  return target;
}

// ---------------------------------------------------------------------------
// Watchers
//
// Every mutation above funnels through notifyWatchers, so `File.watch` and
// `Directory.watch` are real here — for changes made in THIS realm.
// ---------------------------------------------------------------------------

export const DEFAULT_DEBOUNCE_MS = 100;

export type WatchEventType = 'created' | 'modified' | 'deleted' | 'renamed';

export type WatchEvent<T extends File | Directory> = {
  type: WatchEventType;
  target: T;
  nativeEventFlags?: number;
  newTarget?: T;
};

export type WatchOptions = {
  debounce?: number;
  events?: WatchEventType[];
};

export type WatchSubscription = {
  remove(): void;
};

interface WatcherEntry {
  path: string;
  /** Directory watchers also observe their direct children, as upstream does. */
  watchesChildren: boolean;
  options: WatchOptions;
  deliver: (type: WatchEventType, path: string, isDirectory: boolean) => void;
  timer: ReturnType<typeof setTimeout> | null;
  pending: { type: WatchEventType; path: string; isDirectory: boolean } | null;
}

const watchers = new Set<WatcherEntry>();

function notifyWatchers(type: WatchEventType, path: string, isDirectory: boolean): void {
  for (const watcher of watchers) {
    const matches = watcher.path === path || (watcher.watchesChildren && dirname(path) === watcher.path);
    if (!matches) continue;
    if (watcher.options.events && !watcher.options.events.includes(type)) continue;
    const debounce = watcher.options.debounce ?? DEFAULT_DEBOUNCE_MS;
    if (debounce <= 0) {
      watcher.deliver(type, path, isDirectory);
      continue;
    }
    // Upstream coalesces a burst into one callback; the last event wins.
    watcher.pending = { type, path, isDirectory };
    if (watcher.timer !== null) clearTimeout(watcher.timer);
    watcher.timer = setTimeout(() => {
      watcher.timer = null;
      const event = watcher.pending;
      watcher.pending = null;
      if (event) watcher.deliver(event.type, event.path, event.isDirectory);
    }, debounce);
  }
}

function addWatcher(entry: Omit<WatcherEntry, 'timer' | 'pending'>): WatchSubscription {
  const watcher: WatcherEntry = { ...entry, timer: null, pending: null };
  watchers.add(watcher);
  return {
    remove: () => {
      if (watcher.timer !== null) clearTimeout(watcher.timer);
      watchers.delete(watcher);
    },
  };
}

// ---------------------------------------------------------------------------
// Sources outside the VFS (blob:, data:, http(s):) — see the header note.
// ---------------------------------------------------------------------------

async function fetchExternalBytes(uri: string): Promise<Uint8Array> {
  if (typeof fetch !== 'function') {
    throw fsError(
      'ERR_FILESYSTEM_NO_FETCH',
      `Cannot read ${uri}: only file:// uris live in this shim's store, and this realm has no fetch to resolve the rest.`
    );
  }
  const response = await fetch(uri);
  if (!response.ok) {
    throw fsError('ERR_FILESYSTEM_FETCH', `Cannot read ${uri}: the request failed with HTTP ${response.status}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Bytes for any uri either API accepts — VFS entry or fetchable source. */
async function bytesForUri(uri: string): Promise<Uint8Array> {
  return isVfsUri(uri) ? readFileBytes(normalizePath(uri)) : fetchExternalBytes(uri);
}

// ---------------------------------------------------------------------------
// Shared enums and types
//
// Both surfaces declare EncodingType with identical members, so one export
// serves both specifiers. Where the two disagree on a name the comment says so.
// ---------------------------------------------------------------------------

export const EncodingType = {
  UTF8: 'utf8',
  Base64: 'base64',
} as const;
export type EncodingType = (typeof EncodingType)[keyof typeof EncodingType];

export const FileMode = {
  ReadWrite: 'rw',
  ReadOnly: 'r',
  WriteOnly: 'w',
  Append: 'wa',
  Truncate: 'wt',
} as const;
export type FileMode = (typeof FileMode)[keyof typeof FileMode];

export const UploadType = {
  BINARY_CONTENT: 0,
  MULTIPART: 1,
} as const;
export type UploadType = (typeof UploadType)[keyof typeof UploadType];

/** The legacy spelling of UploadType — same values, different module upstream. */
export const FileSystemUploadType = UploadType;
export type FileSystemUploadType = UploadType;

/** iOS session modes. Accepted and ignored — see the header ceiling on uploads. */
export const FileSystemSessionType = {
  BACKGROUND: 0,
  FOREGROUND: 1,
} as const;
export type FileSystemSessionType = (typeof FileSystemSessionType)[keyof typeof FileSystemSessionType];

export type NetworkTaskSessionType = 'background' | 'foreground';
export type FileSystemAcceptedUploadHttpMethod = 'POST' | 'PUT' | 'PATCH';

export type FileCreateOptions = { intermediates?: boolean; overwrite?: boolean };
export type DirectoryCreateOptions = { intermediates?: boolean; overwrite?: boolean; idempotent?: boolean };
export type RelocationOptions = { overwrite?: boolean };
export type RelocatingOptions = { from: string; to: string };
export type InfoOptions = { md5?: boolean };
export type DeletingOptions = { idempotent?: boolean };
export type MakeDirectoryOptions = { intermediates?: boolean };
export type FileWriteOptions = { encoding?: EncodingType | 'utf8' | 'base64'; append?: boolean };
export type WritingOptions = FileWriteOptions;
export type ReadingOptions = { encoding?: EncodingType | 'utf8' | 'base64'; position?: number; length?: number };

/**
 * The union of both surfaces' FileInfo: the object API omits `isDirectory`
 * and the legacy API requires it, and one shim answers both callers.
 */
export type FileInfo = {
  exists: boolean;
  uri: string;
  isDirectory: boolean;
  size?: number;
  modificationTime?: number;
  creationTime?: number;
  md5?: string;
};

export type DirectoryInfo = {
  exists: boolean;
  uri?: string;
  size?: number;
  modificationTime?: number;
  creationTime?: number;
  files?: string[];
};

export type PathInfo = { exists: boolean; isDirectory: boolean | null };

export type DownloadProgress = { bytesWritten: number; totalBytes: number };
export type UploadProgress = { bytesSent: number; totalBytes: number };
export type DownloadProgressData = { totalBytesWritten: number; totalBytesExpectedToWrite: number };
export type UploadProgressData = { totalBytesSent: number; totalBytesExpectedToSend: number };
export type FileSystemNetworkTaskProgressCallback<T extends DownloadProgressData | UploadProgressData> = (data: T) => void;
export type DownloadProgressCallback = FileSystemNetworkTaskProgressCallback<DownloadProgressData>;

export type DownloadOptions = {
  /** Legacy-only; the shim always reports null — see the md5 ceiling. */
  md5?: boolean;
  cache?: boolean;
  headers?: Record<string, string>;
  sessionType?: FileSystemSessionType;
  idempotent?: boolean;
  onProgress?: (data: DownloadProgress) => void;
  signal?: AbortSignal;
};

export type DownloadTaskOptions = {
  headers?: Record<string, string>;
  sessionType?: NetworkTaskSessionType;
  onProgress?: (data: DownloadProgress) => void;
  signal?: AbortSignal;
};

export type UploadOptions = {
  httpMethod?: FileSystemAcceptedUploadHttpMethod;
  uploadType?: UploadType;
  headers?: Record<string, string>;
  fieldName?: string;
  mimeType?: string;
  parameters?: Record<string, string>;
  onProgress?: (data: UploadProgress) => void;
  sessionType?: NetworkTaskSessionType;
  signal?: AbortSignal;
};

export type UploadOptionsBinary = { uploadType?: FileSystemUploadType };
export type UploadOptionsMultipart = {
  uploadType: FileSystemUploadType;
  fieldName?: string;
  mimeType?: string;
  parameters?: Record<string, string>;
};

export type FileSystemUploadOptions = (UploadOptionsBinary | UploadOptionsMultipart) & {
  headers?: Record<string, string>;
  httpMethod?: FileSystemAcceptedUploadHttpMethod;
  sessionType?: FileSystemSessionType;
};

export type FileSystemHttpResult = { headers: Record<string, string>; status: number; mimeType: string | null };
export type FileSystemDownloadResult = FileSystemHttpResult & { uri: string; md5?: string };
export type DownloadResult = FileSystemDownloadResult;
/** Superset of both surfaces' upload results, so either caller destructures cleanly. */
export type UploadResult = FileSystemHttpResult & { body: string };
export type FileSystemUploadResult = UploadResult;

export type DownloadPauseState = {
  url: string;
  fileUri: string;
  options?: DownloadOptions;
  isDirectory?: boolean;
  headers?: Record<string, string>;
  resumeData?: string;
};

export type UploadTaskState = 'idle' | 'active' | 'completed' | 'cancelled' | 'error';
export type DownloadTaskState = UploadTaskState | 'paused';
export type ProgressEvent<T> = { uuid: string; data: T };
export type FileSystemRequestDirectoryPermissionsResult = { granted: false } | { granted: true; directoryUri: string };

export type PickFileGeneralOptions = { initialUri?: string; mimeTypes?: string | string[]; multipleFiles?: boolean };
export type PickSingleFileOptions = PickFileGeneralOptions & { multipleFiles?: false };
export type PickMultipleFilesOptions = PickFileGeneralOptions & { multipleFiles: true };
export type PickFileOptions = PickSingleFileOptions | PickMultipleFilesOptions;
export type PickFileCanceledResult = { result: null; canceled: true };
export type PickSingleFileSuccessResult = { result: File; canceled: false };
export type PickMultipleFilesSuccessResult = { result: File[]; canceled: false };
export type PickSingleFileResult = PickSingleFileSuccessResult | PickFileCanceledResult;
export type PickMultipleFilesResult = PickMultipleFilesSuccessResult | PickFileCanceledResult;

/**
 * The quota this shim reports as "disk". localStorage offers no way to ask,
 * and navigator.storage.estimate() is async while `Paths.totalDiskSpace` is a
 * synchronous getter — so the conventional 5MB per-origin budget stands in.
 */
const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Object API — File / Directory / Paths
// ---------------------------------------------------------------------------

export class FileHandle {
  private path: string;
  private closed = false;
  offset: number | null;
  size: number | null;

  constructor(path: string, mode: FileMode) {
    this.path = path;
    const record = readFileRecord(path);
    if (!record) throw fsError('ERR_FILESYSTEM_NOT_FOUND', `Cannot open ${fileUri(path)}: it does not exist.`);
    if (mode === FileMode.Truncate) writeFileBytes(path, new Uint8Array(0), { type: record.type });
    this.size = mode === FileMode.Truncate ? 0 : base64ByteLength(record.data);
    this.offset = mode === FileMode.Append ? this.size : 0;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw fsError('ERR_FILESYSTEM_CLOSED', `Cannot use a closed file handle for ${fileUri(this.path)}.`);
    }
  }

  close(): void {
    this.closed = true;
    this.offset = null;
    this.size = null;
  }

  readBytes(length: number): Uint8Array {
    this.assertOpen();
    const start = this.offset ?? 0;
    const slice = readFileBytes(this.path).slice(start, start + length);
    this.offset = start + slice.length;
    return slice;
  }

  writeBytes(bytes: Uint8Array): void {
    this.assertOpen();
    const existing = readFileBytes(this.path);
    const start = this.offset ?? 0;
    const next = new Uint8Array(Math.max(existing.length, start + bytes.length));
    next.set(existing, 0);
    next.set(bytes, start);
    writeFileBytes(this.path, next);
    this.offset = start + bytes.length;
    this.size = next.length;
  }
}

/**
 * A file in the virtual filesystem. As upstream, an instance can be created
 * for any path — it does not have to exist yet.
 *
 * Constructed from a non-`file:` uri (an object URL, a data: uri, an http
 * URL) the instance becomes a read-only handle on that source: the async
 * readers fetch it, everything synchronous and every writer throws. See the
 * header note.
 */
export class File {
  private path: string;
  private external: string | null;

  constructor(...uris: PathLike[]) {
    const first = uris[0];
    const single = uris.length === 1 && typeof first === 'string' && !isVfsUri(first) ? first : null;
    this.external = single;
    // External uris still get a path so `name`/`extension` stay meaningful.
    this.path = single ? normalizePath(single) : resolvePath(uris);
  }

  /** Upstream calls this from its JS constructor; this shim has nothing to reject. */
  validatePath(): void {}

  private assertLocal(operation: string): void {
    if (this.external !== null) {
      throw fsError(
        'ERR_FILESYSTEM_EXTERNAL',
        `Cannot ${operation} ${this.external}: it is not an entry in this virtual filesystem. ` +
          `Ingest it first with copyAsync({ from, to }), then operate on the file:// uri.`
      );
    }
  }

  get uri(): string {
    return this.external ?? fileUri(this.path);
  }

  get parentDirectory(): Directory {
    return new Directory(fileUri(dirname(this.path)));
  }

  /** File name, including the extension. */
  get name(): string {
    return basename(this.path);
  }

  /** File extension, for example '.png'. */
  get extension(): string {
    return extname(this.path);
  }

  get exists(): boolean {
    return this.external === null && fileExists(this.path);
  }

  get size(): number {
    return this.external !== null ? 0 : base64ByteLength(readFileRecord(this.path)?.data ?? '');
  }

  get type(): string {
    return readFileRecord(this.path)?.type ?? mimeTypeFor(this.path);
  }

  /** Always null — see the md5 ceiling in the header. */
  get md5(): string | null {
    return null;
  }

  get lastModified(): number | null {
    return readFileRecord(this.path)?.mtime ?? null;
  }

  /** @deprecated Upstream deprecated this in favour of `lastModified`. */
  get modificationTime(): number | null {
    return this.lastModified;
  }

  get creationTime(): number | null {
    return readFileRecord(this.path)?.ctime ?? null;
  }

  /** Android content:// sharing has no browser equivalent; the file uri is all there is. */
  get contentUri(): string {
    return this.uri;
  }

  create(options: FileCreateOptions = {}): void {
    this.assertLocal('create');
    if (fileExists(this.path)) {
      if (options.overwrite) {
        writeFileBytes(this.path, new Uint8Array(0));
        return;
      }
      throw fsError('ERR_FILESYSTEM_EXISTS', `Cannot create ${this.uri}: it already exists.`);
    }
    if (options.intermediates) makeDirectory(dirname(this.path), { intermediates: true, idempotent: true });
    writeFileBytes(this.path, new Uint8Array(0));
  }

  delete(): void {
    this.assertLocal('delete');
    deletePath(this.path);
  }

  info(_options: InfoOptions = {}): FileInfo {
    const record = this.external === null ? readFileRecord(this.path) : null;
    if (!record) return { exists: false, uri: this.uri, isDirectory: false };
    return {
      exists: true,
      uri: this.uri,
      isDirectory: false,
      size: base64ByteLength(record.data),
      modificationTime: record.mtime,
      creationTime: record.ctime,
    };
  }

  write(content: string | Uint8Array, options: FileWriteOptions = {}): void {
    this.assertLocal('write to');
    const bytes =
      typeof content === 'string'
        ? options.encoding === EncodingType.Base64
          ? base64ToBytes(content)
          : utf8ToBytes(content)
        : content;
    writeFileBytes(this.path, bytes, { append: options.append });
  }

  textSync(): string {
    return bytesToUtf8(this.bytesSync());
  }

  base64Sync(): string {
    this.assertLocal('read');
    const record = readFileRecord(this.path);
    if (!record) throw fsError('ERR_FILESYSTEM_NOT_FOUND', `File ${this.uri} does not exist.`);
    return record.data;
  }

  bytesSync(): Uint8Array {
    this.assertLocal('read');
    return readFileBytes(this.path);
  }

  async text(): Promise<string> {
    return bytesToUtf8(await this.bytes());
  }

  async base64(): Promise<string> {
    return this.external === null ? this.base64Sync() : bytesToBase64(await this.bytes());
  }

  async bytes(): Promise<Uint8Array> {
    return bytesForUri(this.uri);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.bytes();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text()) as unknown;
  }

  /** Upstream's `File` implements Blob; these are the Blob members it owes. */
  slice(start?: number, end?: number, contentType?: string): Blob {
    return toBlob(this.bytesSync(), this.type).slice(start, end, contentType);
  }

  /** Typed off `Response` exactly as upstream does, so both realms' FormData fit. */
  async formData(): ReturnType<Response['formData']> {
    if (typeof Response === 'undefined') {
      throw fsError('ERR_FILESYSTEM_NO_RESPONSE', `Cannot parse ${this.uri} as form data: this realm has no Response.`);
    }
    return new Response(toBlob(await this.bytes(), this.type)).formData();
  }

  readableStream(): ReadableStream<Uint8Array> {
    if (typeof ReadableStream === 'undefined') {
      throw fsError('ERR_FILESYSTEM_NO_STREAMS', `Cannot stream ${this.uri}: this realm has no ReadableStream.`);
    }
    const bytes = this.bytesSync();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  stream(): ReadableStream<Uint8Array> {
    return this.readableStream();
  }

  writableStream(): WritableStream<Uint8Array> {
    this.assertLocal('stream to');
    if (typeof WritableStream === 'undefined') {
      throw fsError('ERR_FILESYSTEM_NO_STREAMS', `Cannot stream to ${this.uri}: this realm has no WritableStream.`);
    }
    const path = this.path;
    if (!fileExists(path)) writeFileBytes(path, new Uint8Array(0));
    return new WritableStream<Uint8Array>({
      write(chunk) {
        writeFileBytes(path, chunk, { append: true });
      },
    });
  }

  open(mode: FileMode = FileMode.ReadWrite): FileHandle {
    this.assertLocal('open');
    return new FileHandle(this.path, mode);
  }

  copy(destination: Directory | File, options: RelocationOptions = {}): Promise<void> {
    this.copySync(destination, options);
    return Promise.resolve();
  }

  copySync(destination: Directory | File, options: RelocationOptions = {}): void {
    this.assertLocal('copy');
    copyPath(this.path, normalizePath(destination.uri), options);
  }

  move(destination: Directory | File, options: RelocationOptions = {}): Promise<void> {
    this.moveSync(destination, options);
    return Promise.resolve();
  }

  moveSync(destination: Directory | File, options: RelocationOptions = {}): void {
    this.assertLocal('move');
    this.path = movePath(this.path, normalizePath(destination.uri), options);
  }

  rename(newName: string): void {
    this.assertLocal('rename');
    this.path = movePath(this.path, `${dirname(this.path)}/${newName}`);
  }

  watch(callback: (event: WatchEvent<File>) => void, options: WatchOptions = {}): WatchSubscription {
    return addWatcher({
      path: this.path,
      watchesChildren: false,
      options,
      deliver: (type, path) => callback({ type, target: new File(fileUri(path)) }),
    });
  }

  upload(url: string, options: UploadOptions = {}): Promise<UploadResult> {
    return new UploadTask(this, url, options).uploadAsync();
  }

  createUploadTask(url: string, options: UploadOptions = {}): UploadTask {
    return new UploadTask(this, url, options);
  }

  static async downloadFileAsync(url: string, destination: Directory | File, options: DownloadOptions = {}): Promise<File> {
    const target = destinationFile(url, destination);
    if (target.exists && options.idempotent !== true) {
      throw fsError(
        'ERR_FILESYSTEM_EXISTS',
        `Cannot download to ${target.uri}: a file already exists there. Pass { idempotent: true } to overwrite it.`
      );
    }
    await runDownload(url, target, options);
    return target;
  }

  static createDownloadTask(url: string, destination: File | Directory, options: DownloadTaskOptions = {}): DownloadTask {
    return new DownloadTask(url, destination, options);
  }

  /**
   * A hidden <input type="file"> — the browser's only file picker. Picked
   * bytes are copied into the cache directory so the returned `File`s are real
   * VFS entries; the user's own files are never touched.
   */
  static pickFileAsync(options?: PickSingleFileOptions): Promise<PickSingleFileResult>;
  static pickFileAsync(options: PickMultipleFilesOptions): Promise<PickMultipleFilesResult>;
  static async pickFileAsync(options: PickFileOptions = {}): Promise<PickSingleFileResult | PickMultipleFilesResult> {
    const picked = await pickBrowserFiles(options);
    if (picked.length === 0) return { result: null, canceled: true };
    if (options.multipleFiles) return { result: picked, canceled: false };
    return { result: picked[0] as File, canceled: false };
  }
}

/** Where a download lands when the caller passes a directory instead of a file. */
function destinationFile(url: string, destination: Directory | File): File {
  if (!(destination instanceof Directory)) return destination;
  const name = basename(normalizePath(url.split('?')[0] ?? url)) || 'download';
  return new File(destination, name);
}

async function pickBrowserFiles(options: PickFileOptions): Promise<File[]> {
  if (typeof document === 'undefined') return [];
  const input = document.createElement('input');
  input.type = 'file';
  const mimeTypes = options.mimeTypes;
  input.accept = Array.isArray(mimeTypes) ? mimeTypes.join(',') : (mimeTypes ?? '');
  if (options.multipleFiles) input.multiple = true;
  input.style.display = 'none';
  document.body?.appendChild(input);
  const picked = await new Promise<globalThis.File[]>((resolve) => {
    let settled = false;
    const done = (files: globalThis.File[]): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files ? Array.from(input.files) : []));
    input.addEventListener('cancel', () => done([]));
    try {
      input.click();
    } catch {
      done([]);
    }
  });
  if (picked.length === 0) return [];
  const directory = `${CACHE_PATH}/picked`;
  makeDirectory(directory, { intermediates: true, idempotent: true });
  const results: File[] = [];
  for (const browserFile of picked) {
    const path = `${directory}/${browserFile.name}`;
    writeFileBytes(path, new Uint8Array(await browserFile.arrayBuffer()), { type: browserFile.type });
    results.push(new File(fileUri(path)));
  }
  return results;
}

/** A directory in the virtual filesystem. Like `File`, it need not exist yet. */
export class Directory {
  private path: string;

  constructor(...uris: PathLike[]) {
    this.path = resolvePath(uris);
  }

  validatePath(): void {}

  get uri(): string {
    return directoryUri(this.path);
  }

  get name(): string {
    return basename(this.path);
  }

  get parentDirectory(): Directory {
    return new Directory(fileUri(dirname(this.path)));
  }

  get exists(): boolean {
    return directoryExists(this.path);
  }

  get size(): number | null {
    return directoryExists(this.path) ? directorySize(this.path) : null;
  }

  create(options: DirectoryCreateOptions = {}): void {
    makeDirectory(this.path, options);
  }

  delete(): void {
    deletePath(this.path);
  }

  info(): DirectoryInfo {
    if (!directoryExists(this.path)) return { exists: false };
    const record = readDirRecord(this.path);
    return {
      exists: true,
      uri: this.uri,
      size: directorySize(this.path),
      modificationTime: record?.mtime,
      creationTime: record?.ctime,
      files: listChildren(this.path).map((child) => basename(child.path)),
    };
  }

  createFile(name: string, mimeType: string | null): File {
    const path = `${this.path}/${name}`;
    writeFileBytes(path, new Uint8Array(0), { type: mimeType ?? mimeTypeFor(name) });
    return new File(fileUri(path));
  }

  createDirectory(name: string): Directory {
    const path = `${this.path}/${name}`;
    makeDirectory(path);
    return new Directory(directoryUri(path));
  }

  /** @hidden Upstream's internal listing form; kept because deep imports use it. */
  listAsRecords(): { isDirectory: boolean; uri: string }[] {
    return listChildren(this.path).map((child) => ({
      isDirectory: child.isDirectory,
      uri: child.isDirectory ? directoryUri(child.path) : fileUri(child.path),
    }));
  }

  list(): (Directory | File)[] {
    if (!directoryExists(this.path)) {
      throw fsError('ERR_FILESYSTEM_NOT_FOUND', `Cannot list ${this.uri}: it does not exist.`);
    }
    return listChildren(this.path).map((child) =>
      child.isDirectory ? new Directory(directoryUri(child.path)) : new File(fileUri(child.path))
    );
  }

  copy(destination: Directory | File, options: RelocationOptions = {}): Promise<void> {
    this.copySync(destination, options);
    return Promise.resolve();
  }

  copySync(destination: Directory | File, options: RelocationOptions = {}): void {
    copyPath(this.path, normalizePath(destination.uri), options);
  }

  move(destination: Directory | File, options: RelocationOptions = {}): Promise<void> {
    this.moveSync(destination, options);
    return Promise.resolve();
  }

  moveSync(destination: Directory | File, options: RelocationOptions = {}): void {
    this.path = movePath(this.path, normalizePath(destination.uri), options);
  }

  rename(newName: string): void {
    this.path = movePath(this.path, `${dirname(this.path)}/${newName}`);
  }

  watch(callback: (event: WatchEvent<File | Directory>) => void, options: WatchOptions = {}): WatchSubscription {
    return addWatcher({
      path: this.path,
      watchesChildren: true,
      options,
      deliver: (type, path, isDirectory) =>
        callback({ type, target: isDirectory ? new Directory(directoryUri(path)) : new File(fileUri(path)) }),
    });
  }

  /**
   * `showDirectoryPicker` exists only in Chromium and yields a handle this
   * store cannot adopt, so this fails loudly rather than pretending.
   */
  static async pickDirectoryAsync(_initialUri?: string): Promise<Directory> {
    throw fsError(
      'ERR_FILESYSTEM_UNSUPPORTED',
      'Directory.pickDirectoryAsync is not available: a browser grants no directory handle this virtual filesystem can adopt.'
    );
  }
}

/** Path utilities plus the three well-known directories. */
export class Paths {
  static get cache(): Directory {
    return new Directory(directoryUri(CACHE_PATH));
  }

  static get document(): Directory {
    return new Directory(directoryUri(DOCUMENT_PATH));
  }

  static get bundle(): Directory {
    return new Directory(directoryUri(BUNDLE_PATH));
  }

  /** An iOS App Group concept; a browser origin has no shared containers. */
  static get appleSharedContainers(): Record<string, Directory> {
    return {};
  }

  static get totalDiskSpace(): number {
    return ASSUMED_QUOTA_BYTES;
  }

  static get availableDiskSpace(): number {
    return Math.max(0, ASSUMED_QUOTA_BYTES - usedBytes());
  }

  static info(...uris: string[]): PathInfo {
    const path = resolvePath(uris);
    if (directoryExists(path)) return { exists: true, isDirectory: true };
    if (fileExists(path)) return { exists: true, isDirectory: false };
    return { exists: false, isDirectory: null };
  }

  static join(...paths: PathLike[]): string {
    return normalizePath(paths.map(pathString).join('/'));
  }

  static relative(from: PathLike, to: PathLike): string {
    return relativePath(pathString(from), pathString(to));
  }

  static isAbsolute(path: PathLike): boolean {
    const value = pathString(path);
    return value.startsWith('/') || value.startsWith(SCHEME);
  }

  static normalize(path: PathLike): string {
    return normalizePath(pathString(path));
  }

  static dirname(path: PathLike): string {
    return dirname(pathString(path));
  }

  static basename(path: PathLike, ext?: string): string {
    return basename(pathString(path), ext);
  }

  static extname(path: PathLike): string {
    return extname(pathString(path));
  }

  static parse(path: PathLike): { root: string; dir: string; base: string; ext: string; name: string } {
    const value = pathString(path);
    const ext = extname(value);
    const base = basename(value);
    return { root: '/', dir: dirname(value), base, ext, name: ext ? base.slice(0, -ext.length) : base };
  }
}

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

interface DownloadOutcome {
  status: number;
  headers: Record<string, string>;
  mimeType: string | null;
  bytesWritten: number;
}

function headersToRecord(headers: Headers | null): Record<string, string> {
  const record: Record<string, string> = {};
  headers?.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

/**
 * Streams the response so progress callbacks carry real byte counts, falling
 * back to one final event when the body is not a readable stream. `startAt`
 * drives resume: it asks for a Range, and a server that answers 200 instead of
 * 206 is treated as a restart rather than silently corrupting the file.
 *
 * Chunks are accumulated and written once — each VFS write re-encodes the
 * whole file to base64, so writing per chunk would be quadratic.
 */
async function runDownload(
  url: string,
  target: File,
  options: DownloadOptions | DownloadTaskOptions,
  startAt = 0,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadOutcome> {
  if (typeof fetch !== 'function') {
    throw fsError('ERR_FILESYSTEM_NO_FETCH', `Cannot download ${url}: this realm has no fetch.`);
  }
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (startAt > 0) headers.Range = `bytes=${startAt}-`;
  const response = await fetch(url, { headers, signal: options.signal });
  if (!response.ok) {
    throw fsError('ERR_FILESYSTEM_DOWNLOAD', `Unable to download ${url}: the server responded with HTTP ${response.status}.`);
  }
  const resuming = startAt > 0 && response.status === 206;
  const targetPath = normalizePath(target.uri);
  const contentType = response.headers.get('content-type');
  const declared = Number(response.headers.get('content-length'));
  const expected = Number.isFinite(declared) && declared > 0 ? declared + (resuming ? startAt : 0) : -1;
  const report = options.onProgress ?? onProgress;

  const reader = response.body?.getReader?.();
  let received: Uint8Array;
  if (reader) {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      length += value.length;
      report?.({ bytesWritten: (resuming ? startAt : 0) + length, totalBytes: expected });
    }
    received = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      received.set(chunk, offset);
      offset += chunk.length;
    }
  } else {
    received = new Uint8Array(await response.arrayBuffer());
  }

  writeFileBytes(targetPath, received, { append: resuming, type: contentType ?? undefined });
  const written = (resuming ? startAt : 0) + received.length;
  report?.({ bytesWritten: written, totalBytes: expected < 0 ? written : expected });
  return { status: response.status, headers: headersToRecord(response.headers), mimeType: contentType, bytesWritten: written };
}

interface UploadRequest {
  url: string;
  bytes: Uint8Array;
  filename: string;
  method: FileSystemAcceptedUploadHttpMethod;
  headers: Record<string, string>;
  multipart: boolean;
  fieldName: string;
  mimeType: string;
  parameters: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (sent: number, total: number) => void;
}

function buildFormData(request: UploadRequest): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(request.parameters)) form.append(key, value);
  form.append(request.fieldName, toBlob(request.bytes, request.mimeType), request.filename);
  return form;
}

function parseXhrHeaders(raw: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of (raw ?? '').split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

/**
 * XHR when it exists, because it is the only browser API that reports UPLOAD
 * progress; fetch otherwise (Node, workers), which can only report the final
 * byte count.
 */
function performUpload(request: UploadRequest): Promise<UploadResult> {
  const body: BodyInit = request.multipart ? buildFormData(request) : toBlob(request.bytes, request.mimeType);
  const total = request.bytes.length;

  if (typeof XMLHttpRequest === 'function') {
    return new Promise<UploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(request.method, request.url, true);
      for (const [key, value] of Object.entries(request.headers)) xhr.setRequestHeader(key, value);
      // A multipart Content-Type must carry the boundary the browser picks, so
      // only the binary form sets it here.
      if (!request.multipart && request.mimeType && !('Content-Type' in request.headers)) {
        xhr.setRequestHeader('Content-Type', request.mimeType);
      }
      xhr.upload.onprogress = (event) => request.onProgress?.(event.loaded, event.total || total);
      xhr.onload = () => {
        request.onProgress?.(total, total);
        resolve({
          status: xhr.status,
          headers: parseXhrHeaders(xhr.getAllResponseHeaders()),
          mimeType: xhr.getResponseHeader('content-type'),
          body: xhr.responseText,
        });
      };
      xhr.onerror = () =>
        reject(fsError('ERR_FILESYSTEM_UPLOAD', `Upload to ${request.url} failed (network error, or blocked by CORS).`));
      xhr.onabort = () => reject(fsError('ERR_FILESYSTEM_CANCELLED', `Upload to ${request.url} was cancelled.`));
      request.signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(body);
    });
  }

  if (typeof fetch !== 'function') {
    throw fsError('ERR_FILESYSTEM_NO_FETCH', `Cannot upload to ${request.url}: this realm has neither XMLHttpRequest nor fetch.`);
  }
  const headers = { ...request.headers };
  if (!request.multipart && request.mimeType && !('Content-Type' in headers)) headers['Content-Type'] = request.mimeType;
  return fetch(request.url, { method: request.method, headers, body, signal: request.signal }).then(async (response) => {
    request.onProgress?.(total, total);
    return {
      status: response.status,
      headers: headersToRecord(response.headers),
      mimeType: response.headers.get('content-type'),
      body: await response.text(),
    };
  });
}

type UploadProgressListener = (data: UploadProgress) => void;
type DownloadProgressListener = (data: DownloadProgress) => void;

/**
 * One class for both surfaces' `UploadTask`: the object API constructs it as
 * `(file, url, options)` and the legacy API as `(url, fileUri, options,
 * callback)`. Two different classes cannot share one export name, so the
 * constructor accepts either shape and `uploadAsync()` resolves the superset
 * result both callers destructure.
 */
export class UploadTask {
  private url: string;
  private sourceUri: string;
  private options: UploadOptions & FileSystemUploadOptions;
  private legacyCallback?: FileSystemNetworkTaskProgressCallback<UploadProgressData>;
  private listeners = new Set<UploadProgressListener>();
  private controller: AbortController | null = null;
  private cancelRequested = false;
  private _state: UploadTaskState = 'idle';

  constructor(file: File, url: string, options?: UploadOptions);
  constructor(
    url: string,
    fileUri: string,
    options?: FileSystemUploadOptions,
    callback?: FileSystemNetworkTaskProgressCallback<UploadProgressData>
  );
  constructor(
    a: File | string,
    b: string,
    options: (UploadOptions & FileSystemUploadOptions) | undefined = {},
    callback?: FileSystemNetworkTaskProgressCallback<UploadProgressData>
  ) {
    if (typeof a === 'string') {
      this.url = a;
      this.sourceUri = b;
    } else {
      this.url = b;
      this.sourceUri = a.uri;
    }
    this.options = options ?? {};
    this.legacyCallback = callback;
  }

  get state(): UploadTaskState {
    return this._state;
  }

  addListener(eventName: 'progress', listener: UploadProgressListener): { remove(): void } {
    if (eventName !== 'progress') return { remove: () => {} };
    this.listeners.add(listener);
    return { remove: () => void this.listeners.delete(listener) };
  }

  release(): void {
    this.listeners.clear();
  }

  cancel(): void {
    if (this._state !== 'active') return;
    this.cancelRequested = true;
    this._state = 'cancelled';
    this.controller?.abort();
  }

  /** The legacy surface spells cancel() this way. */
  async cancelAsync(): Promise<void> {
    this.cancel();
  }

  async uploadAsync(): Promise<UploadResult> {
    if (this._state !== 'idle') {
      throw fsError('ERR_FILESYSTEM_TASK_STATE', `The upload task for ${this.url} has already run (state: ${this._state}).`);
    }
    this._state = 'active';
    this.controller = typeof AbortController === 'function' ? new AbortController() : null;
    const options = this.options;
    const name = basename(normalizePath(this.sourceUri));
    try {
      const bytes = await bytesForUri(this.sourceUri);
      const result = await performUpload({
        url: this.url,
        bytes,
        filename: name,
        method: options.httpMethod ?? 'POST',
        headers: options.headers ?? {},
        multipart: options.uploadType === UploadType.MULTIPART,
        // Upstream's documented default field name is the file name without extension.
        fieldName: options.fieldName ?? basename(normalizePath(this.sourceUri), extname(this.sourceUri)) ?? 'file',
        mimeType: options.mimeType ?? mimeTypeFor(this.sourceUri),
        parameters: options.parameters ?? {},
        signal: options.signal ?? this.controller?.signal ?? undefined,
        onProgress: (sent, totalBytes) => {
          for (const listener of this.listeners) listener({ bytesSent: sent, totalBytes });
          options.onProgress?.({ bytesSent: sent, totalBytes });
          this.legacyCallback?.({ totalBytesSent: sent, totalBytesExpectedToSend: totalBytes });
        },
      });
      this._state = this.cancelRequested ? 'cancelled' : 'completed';
      return result;
    } catch (e) {
      this._state = this.cancelRequested ? 'cancelled' : 'error';
      throw e;
    }
  }
}

/** The object API's download task: pause and resume ride on HTTP Range requests. */
export class DownloadTask {
  private url: string;
  private destination: File | Directory;
  private options: DownloadTaskOptions;
  private listeners = new Set<DownloadProgressListener>();
  private controller: AbortController | null = null;
  private resumeAt = 0;
  private pauseRequested = false;
  private cancelRequested = false;
  private _state: DownloadTaskState = 'idle';

  constructor(url: string, destination: File | Directory, options: DownloadTaskOptions = {}) {
    this.url = url;
    this.destination = destination;
    this.options = options;
  }

  get state(): DownloadTaskState {
    return this._state;
  }

  addListener(eventName: 'progress', listener: DownloadProgressListener): { remove(): void } {
    if (eventName !== 'progress') return { remove: () => {} };
    this.listeners.add(listener);
    return { remove: () => void this.listeners.delete(listener) };
  }

  release(): void {
    this.listeners.clear();
  }

  pause(): void {
    if (this._state !== 'active') return;
    this.pauseRequested = true;
    this.controller?.abort();
  }

  async pauseAsync(): Promise<void> {
    this.pause();
    // Let the aborted read settle so the task really is 'paused' on return.
    await Promise.resolve();
  }

  cancel(): void {
    if (this._state !== 'active' && this._state !== 'paused') return;
    this.cancelRequested = true;
    this._state = 'cancelled';
    this.controller?.abort();
  }

  downloadAsync(): Promise<File | null> {
    return this.run();
  }

  resumeAsync(): Promise<File | null> {
    return this.run();
  }

  savable(): DownloadPauseState {
    return {
      url: this.url,
      fileUri: this.destination.uri,
      isDirectory: this.destination instanceof Directory,
      headers: this.options.headers,
      resumeData: String(this.resumeAt),
    };
  }

  static fromSavable(state: DownloadPauseState, options: DownloadTaskOptions = {}): DownloadTask {
    const destination = state.isDirectory ? new Directory(state.fileUri) : new File(state.fileUri);
    const task = new DownloadTask(state.url, destination, {
      ...options,
      headers: { ...state.headers, ...options.headers },
    });
    task.resumeAt = Number(state.resumeData ?? 0) || 0;
    task._state = 'paused';
    return task;
  }

  private async run(): Promise<File | null> {
    this._state = 'active';
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.controller = typeof AbortController === 'function' ? new AbortController() : null;
    const target = destinationFile(this.url, this.destination);
    try {
      const outcome = await runDownload(
        this.url,
        target,
        { ...this.options, signal: this.options.signal ?? this.controller?.signal ?? undefined },
        this.resumeAt,
        (progress) => {
          this.resumeAt = progress.bytesWritten;
          for (const listener of this.listeners) listener(progress);
        }
      );
      this.resumeAt = outcome.bytesWritten;
      this._state = 'completed';
      return target;
    } catch (e) {
      if (this.pauseRequested) {
        this._state = 'paused';
        return null;
      }
      this._state = this.cancelRequested ? 'cancelled' : 'error';
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Legacy API — `expo-file-system/legacy`
//
// Adapters over the same store as the object API above, not a second
// filesystem. Note that in SDK 57 these names ALSO exist on the package root
// as deprecation stubs that throw at runtime; here they work from either
// specifier, because one aliased module serves both and a working call beats a
// thrown one.
// ---------------------------------------------------------------------------

export const documentDirectory: string = directoryUri(DOCUMENT_PATH);
export const cacheDirectory: string = directoryUri(CACHE_PATH);
export const bundleDirectory: string = directoryUri(BUNDLE_PATH);

/** The legacy surface reports times in SECONDS; the object API reports ms. */
function msToSeconds(ms: number | undefined): number | undefined {
  return ms === undefined ? undefined : Math.floor(ms / 1000);
}

export async function getInfoAsync(uri: string, _options: InfoOptions = {}): Promise<FileInfo> {
  // Documented contract: a missing item resolves {exists: false}, never throws.
  if (!isVfsUri(uri)) return { exists: false, uri, isDirectory: false };
  const path = normalizePath(uri);
  if (directoryExists(path)) {
    const record = readDirRecord(path);
    return {
      exists: true,
      uri,
      isDirectory: true,
      size: directorySize(path),
      modificationTime: msToSeconds(record?.mtime),
      creationTime: msToSeconds(record?.ctime),
    };
  }
  const record = readFileRecord(path);
  if (!record) return { exists: false, uri, isDirectory: false };
  return {
    exists: true,
    uri,
    isDirectory: false,
    size: base64ByteLength(record.data),
    modificationTime: msToSeconds(record.mtime),
    creationTime: msToSeconds(record.ctime),
  };
}

export async function readAsStringAsync(uri: string, options: ReadingOptions = {}): Promise<string> {
  const bytes = await bytesForUri(uri);
  if (options.encoding !== EncodingType.Base64) return bytesToUtf8(bytes);
  const position = options.position ?? 0;
  const length = options.length ?? bytes.length - position;
  return bytesToBase64(bytes.slice(position, position + length));
}

export async function writeAsStringAsync(uri: string, contents: string, options: WritingOptions = {}): Promise<void> {
  const bytes = options.encoding === EncodingType.Base64 ? base64ToBytes(contents) : utf8ToBytes(contents);
  writeFileBytes(normalizePath(uri), bytes, { append: options.append });
}

export async function deleteAsync(uri: string, options: DeletingOptions = {}): Promise<void> {
  deletePath(normalizePath(uri), options);
}

/** An Android storage-migration helper; there is no legacy directory here. */
export async function deleteLegacyDocumentDirectoryAndroid(): Promise<void> {}

export async function moveAsync(options: RelocatingOptions): Promise<void> {
  await copyAsync(options);
  if (isVfsUri(options.from)) deletePath(normalizePath(options.from), { idempotent: true, silent: true });
}

/**
 * Also the ingestion point for browser-native sources: copying from a `blob:`,
 * `data:` or `http(s):` uri fetches the bytes into the VFS, which is how a
 * picked or manipulated image gets a file uri these APIs can work with.
 */
export async function copyAsync(options: RelocatingOptions): Promise<void> {
  const to = normalizePath(options.to);
  if (isVfsUri(options.from)) {
    copyPath(normalizePath(options.from), to);
    return;
  }
  writeFileBytes(to, await fetchExternalBytes(options.from));
}

export async function makeDirectoryAsync(uri: string, options: MakeDirectoryOptions = {}): Promise<void> {
  makeDirectory(normalizePath(uri), { ...options, idempotent: options.intermediates });
}

export async function readDirectoryAsync(uri: string): Promise<string[]> {
  const path = normalizePath(uri);
  if (!directoryExists(path)) {
    throw fsError('ERR_FILESYSTEM_NOT_FOUND', `Cannot read directory ${directoryUri(path)}: it does not exist.`);
  }
  return listChildren(path).map((child) => basename(child.path));
}

export async function getFreeDiskStorageAsync(): Promise<number> {
  return Paths.availableDiskSpace;
}

export async function getTotalDiskCapacityAsync(): Promise<number> {
  return Paths.totalDiskSpace;
}

/** There are no content:// uris here; the file uri is the only handle. */
export async function getContentUriAsync(uri: string): Promise<string> {
  return uri;
}

export async function downloadAsync(uri: string, fileUri: string, options: DownloadOptions = {}): Promise<FileSystemDownloadResult> {
  const outcome = await runDownload(uri, new File(fileUri), options);
  return { uri: fileUri, status: outcome.status, headers: outcome.headers, mimeType: outcome.mimeType };
}

export async function uploadAsync(url: string, fileUri: string, options: FileSystemUploadOptions = {}): Promise<FileSystemUploadResult> {
  return new UploadTask(url, fileUri, options).uploadAsync();
}

export function createUploadTask(
  url: string,
  fileUri: string,
  options: FileSystemUploadOptions = {},
  callback?: FileSystemNetworkTaskProgressCallback<UploadProgressData>
): UploadTask {
  return new UploadTask(url, fileUri, options, callback);
}

/**
 * Upstream's abstract base for the legacy network tasks. Nothing here extends
 * it — `UploadTask` and `DownloadResumable` own their own cancellation — but it
 * is a named export of `expo-file-system/legacy`, and one missing name breaks
 * the whole ESM module at link time.
 */
export abstract class FileSystemCancellableNetworkTask<T extends DownloadProgressData | UploadProgressData> {
  protected taskWasCanceled = false;

  async cancelAsync(): Promise<void> {
    this.taskWasCanceled = true;
  }

  protected isTaskCancelled(): boolean {
    return this.taskWasCanceled;
  }

  protected abstract getEventName(): string;
  protected abstract getCallback(): FileSystemNetworkTaskProgressCallback<T> | undefined;
}

function hasResumeData(value: string | undefined): value is string {
  return value !== undefined && Number(value) > 0;
}

/** The legacy resumable download, over the same Range-request machinery. */
export class DownloadResumable {
  private task: DownloadTask;
  private url: string;
  private _fileUri: string;
  private options: DownloadOptions;
  private callback?: FileSystemNetworkTaskProgressCallback<DownloadProgressData>;
  resumeData?: string;

  constructor(
    url: string,
    fileUri: string,
    options: DownloadOptions = {},
    callback?: FileSystemNetworkTaskProgressCallback<DownloadProgressData>,
    resumeData?: string
  ) {
    this.url = url;
    this._fileUri = fileUri;
    this.options = options;
    this.callback = callback;
    this.resumeData = resumeData;
    this.task = this.createTask();
  }

  private taskOptions(): DownloadTaskOptions {
    return {
      headers: this.options.headers,
      signal: this.options.signal,
      onProgress: (progress) =>
        this.callback?.({ totalBytesWritten: progress.bytesWritten, totalBytesExpectedToWrite: progress.totalBytes }),
    };
  }

  private createTask(): DownloadTask {
    if (hasResumeData(this.resumeData)) {
      return DownloadTask.fromSavable(
        { url: this.url, fileUri: this._fileUri, resumeData: this.resumeData, headers: this.options.headers },
        this.taskOptions()
      );
    }
    return new DownloadTask(this.url, new File(this._fileUri), this.taskOptions());
  }

  get fileUri(): string {
    return this._fileUri;
  }

  async downloadAsync(): Promise<FileSystemDownloadResult | undefined> {
    const file = await this.task.downloadAsync();
    if (!file) return undefined;
    return { uri: this._fileUri, status: 200, headers: {}, mimeType: file.type || null };
  }

  async pauseAsync(): Promise<DownloadPauseState> {
    await this.task.pauseAsync();
    this.resumeData = this.task.savable().resumeData;
    return this.savable();
  }

  async resumeAsync(): Promise<FileSystemDownloadResult | undefined> {
    this.task = this.createTask();
    return this.downloadAsync();
  }

  async cancelAsync(): Promise<void> {
    this.task.cancel();
  }

  savable(): DownloadPauseState {
    return { url: this.url, fileUri: this._fileUri, options: this.options, resumeData: this.resumeData };
  }
}

export function createDownloadResumable(
  uri: string,
  fileUri: string,
  options: DownloadOptions = {},
  callback?: FileSystemNetworkTaskProgressCallback<DownloadProgressData>,
  resumeData?: string
): DownloadResumable {
  return new DownloadResumable(uri, fileUri, options, callback, resumeData);
}

/**
 * Android's Storage Access Framework. SAF grants an app a directory OUTSIDE
 * its sandbox; a browser has no such grant to give, so
 * requestDirectoryPermissionsAsync honestly reports {granted: false} and the
 * rest of the namespace operates on the VFS like its top-level twins.
 */
export const StorageAccessFramework = {
  getUriForDirectoryInRoot(folderName: string): string {
    return directoryUri(`${ROOT}/${folderName}`);
  },
  async requestDirectoryPermissionsAsync(_initialFileUrl?: string | null): Promise<FileSystemRequestDirectoryPermissionsResult> {
    return { granted: false };
  },
  /** SAF listings are full uris, unlike readDirectoryAsync's bare names. */
  async readDirectoryAsync(dirUri: string): Promise<string[]> {
    const path = normalizePath(dirUri);
    return listChildren(path).map((child) => (child.isDirectory ? directoryUri(child.path) : fileUri(child.path)));
  },
  async makeDirectoryAsync(parentUri: string, dirName: string): Promise<string> {
    const path = `${normalizePath(parentUri)}/${dirName}`;
    makeDirectory(path, { intermediates: true, idempotent: true });
    return directoryUri(path);
  },
  async createFileAsync(parentUri: string, fileName: string, mimeType: string): Promise<string> {
    const path = `${normalizePath(parentUri)}/${fileName}`;
    writeFileBytes(path, new Uint8Array(0), { type: mimeType });
    return fileUri(path);
  },
  writeAsStringAsync,
  readAsStringAsync,
  deleteAsync,
  moveAsync,
  copyAsync,
};

// ---------------------------------------------------------------------------
// Namespace default
//
// `import * as FileSystem from 'expo-file-system'` sees the named exports;
// this default keeps the `import FileSystem from '...'` and CJS-interop forms
// working too. (Upstream has no default export; an extra one costs nothing and
// a missing one breaks a link.)
// ---------------------------------------------------------------------------

const FileSystem = {
  File,
  Directory,
  Paths,
  FileHandle,
  UploadTask,
  DownloadTask,
  DownloadResumable,
  StorageAccessFramework,
  EncodingType,
  FileMode,
  UploadType,
  FileSystemUploadType,
  FileSystemSessionType,
  DEFAULT_DEBOUNCE_MS,
  documentDirectory,
  cacheDirectory,
  bundleDirectory,
  getInfoAsync,
  readAsStringAsync,
  writeAsStringAsync,
  deleteAsync,
  deleteLegacyDocumentDirectoryAndroid,
  moveAsync,
  copyAsync,
  makeDirectoryAsync,
  readDirectoryAsync,
  getFreeDiskStorageAsync,
  getTotalDiskCapacityAsync,
  getContentUriAsync,
  downloadAsync,
  uploadAsync,
  createUploadTask,
  createDownloadResumable,
};

export default FileSystem;

/**
 * TEST-ONLY: erase the whole virtual filesystem — the localStorage namespace,
 * the in-memory fallback, and every registered watcher. Not part of
 * expo-file-system; app code should delete through the documented APIs.
 */
export function __resetFileSystem(): void {
  for (const key of storeKeys()) removeKey(key);
  memory.clear();
  for (const watcher of watchers) if (watcher.timer !== null) clearTimeout(watcher.timer);
  watchers.clear();
}
