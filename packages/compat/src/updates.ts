/**
 * expo-updates compat shim — an OTA system a web page does not have.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — the module-scope constants, checkForUpdateAsync/
 * fetchUpdateAsync/reloadAsync, the extra-param and log accessors, the
 * reload-screen calls, the state-change emitter and useUpdates(), plus the
 * UpdateCheckResultNotAvailableReason / UpdatesLogEntryCode /
 * UpdatesLogEntryLevel / UpdatesCheckAutomaticallyValue / UpdateInfoType
 * enums.
 *
 * There is nothing to fake here, so nothing is faked: the page IS the
 * build, delivered by the web server. isEnabled is false, isEmbeddedLaunch
 * is true, channel / runtimeVersion / updateId / createdAt are null and
 * `manifest` is an empty OBJECT — the shape every consumer of a disabled
 * expo-updates already handles, because that is exactly what the real module
 * reports in development. checkForUpdateAsync answers "no update available
 * on the server" and fetchUpdateAsync "nothing new"; the one call with a
 * genuine web meaning, reloadAsync, does the real thing and reloads the
 * document.
 *
 * Type discipline matters more than usual in this file: the real module
 * builds `manifest` at MODULE SCOPE as
 * `JSON.parse(ExpoUpdates.manifestString)`, and reads `channel`,
 * `runtimeVersion` and `updateId` as strings. A value of the wrong type here
 * is not a runtime warning later, it is a crash during import of anything
 * that touches this module. Every constant below is annotated with the
 * type the real package's consumers parse.
 *
 * Honest ceilings:
 * - **No update channel, no rollback, no embedded-vs-downloaded distinction.**
 *   Shipping new code to a web build is a deploy, not a fetched update.
 * - **reloadAsync cannot show a reload screen.** location.reload() replaces
 *   the document; showReloadScreen/hideReloadScreen are accepted and ignored.
 * - **No log store.** readLogEntriesAsync returns [] — expo-updates' log
 *   entries come from the native updates runtime.
 * - **UpdateEventType is legacy.** The enum was removed from expo-updates in
 *   SDK 51 along with the `addListener` event API; it is kept here (with
 *   its historical values) so apps and libraries still importing the name
 *   link instead of dying at module evaluation.
 */
import * as React from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structural stand-in for expo-manifests' ExpoUpdatesManifest | EmbeddedManifest.
 * The real types come from a package that is not part of this boundary; the
 * fields below are the ones apps read off `Updates.manifest`.
 */
export interface Manifest {
  id?: string;
  createdAt?: string;
  runtimeVersion?: string;
  launchAsset?: { url?: string; key?: string; contentType?: string };
  assets?: unknown[];
  metadata?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

export type LocalAssets = Record<string, string>;

export enum UpdateCheckResultNotAvailableReason {
  NO_UPDATE_AVAILABLE_ON_SERVER = 'noUpdateAvailableOnServer',
  UPDATE_REJECTED_BY_SELECTION_POLICY = 'updateRejectedBySelectionPolicy',
  UPDATE_PREVIOUSLY_FAILED = 'updatePreviouslyFailed',
  ROLLBACK_REJECTED_BY_SELECTION_POLICY = 'rollbackRejectedBySelectionPolicy',
  ROLLBACK_NO_EMBEDDED = 'rollbackNoEmbeddedConfiguration',
}

export type UpdateCheckResultRollBack = {
  isAvailable: false;
  manifest: undefined;
  isRollBackToEmbedded: true;
  reason: undefined;
};

export type UpdateCheckResultAvailable = {
  isAvailable: true;
  manifest: Manifest;
  isRollBackToEmbedded: false;
  reason: undefined;
};

export type UpdateCheckResultNotAvailable = {
  isAvailable: false;
  manifest: undefined;
  isRollBackToEmbedded: false;
  reason: UpdateCheckResultNotAvailableReason;
};

export type UpdateCheckResult =
  | UpdateCheckResultRollBack
  | UpdateCheckResultAvailable
  | UpdateCheckResultNotAvailable;

export type UpdateFetchResultSuccess = { isNew: true; manifest: Manifest; isRollBackToEmbedded: false };
export type UpdateFetchResultFailure = { isNew: false; manifest: undefined; isRollBackToEmbedded: false };
export type UpdateFetchResultRollBackToEmbedded = {
  isNew: false;
  manifest: undefined;
  isRollBackToEmbedded: true;
};
export type UpdateFetchResult =
  | UpdateFetchResultSuccess
  | UpdateFetchResultFailure
  | UpdateFetchResultRollBackToEmbedded;

export enum UpdatesLogEntryCode {
  NONE = 'None',
  NO_UPDATES_AVAILABLE = 'NoUpdatesAvailable',
  UPDATE_ASSETS_NOT_AVAILABLE = 'UpdateAssetsNotAvailable',
  UPDATE_SERVER_UNREACHABLE = 'UpdateServerUnreachable',
  UPDATE_HAS_INVALID_SIGNATURE = 'UpdateHasInvalidSignature',
  UPDATE_CODE_SIGNING_ERROR = 'UpdateCodeSigningError',
  UPDATE_FAILED_TO_LOAD = 'UpdateFailedToLoad',
  ASSETS_FAILED_TO_LOAD = 'AssetsFailedToLoad',
  JS_RUNTIME_ERROR = 'JSRuntimeError',
  INITIALIZATION_ERROR = 'InitializationError',
  UNKNOWN = 'Unknown',
}

export enum UpdatesLogEntryLevel {
  TRACE = 'trace',
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal',
}

export enum UpdatesCheckAutomaticallyValue {
  ON_LOAD = 'ON_LOAD',
  ON_ERROR_RECOVERY = 'ON_ERROR_RECOVERY',
  WIFI_ONLY = 'WIFI_ONLY',
  NEVER = 'NEVER',
}

/**
 * @deprecated Removed from expo-updates in SDK 51 with the event API; kept
 * for source compatibility with apps that still import the name.
 */
export enum UpdateEventType {
  UPDATE_AVAILABLE = 'updateAvailable',
  NO_UPDATE_AVAILABLE = 'noUpdateAvailable',
  ERROR = 'error',
}

export type UpdatesLogEntry = {
  timestamp: number;
  message: string;
  code: UpdatesLogEntryCode;
  level: UpdatesLogEntryLevel;
  updateId?: string;
  assetId?: string;
  stacktrace?: string[];
};

export interface ReloadScreenImageSource {
  url?: string;
  width?: number;
  height?: number;
  scale?: number;
}

export interface ReloadScreenOptions {
  backgroundColor?: string;
  image?: string | number | ReloadScreenImageSource;
  imageResizeMode?: 'contain' | 'cover' | 'center' | 'stretch';
  imageFullScreen?: boolean;
  fade?: boolean;
  spinner?: { enabled?: boolean; color?: string; size?: 'small' | 'medium' | 'large' };
}

export type UpdatesNativeStateRollback = { commitTime: string };

export type UpdatesNativeStateMachineContext = {
  isStartupProcedureRunning: boolean;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isRestarting: boolean;
  restartCount: number;
  latestManifest?: Manifest;
  downloadedManifest?: Manifest;
  rollback?: UpdatesNativeStateRollback;
  checkError?: Error;
  downloadError?: Error;
  lastCheckForUpdateTime?: Date;
  sequenceNumber: number;
  downloadProgress: number;
};

export type UpdatesNativeStateChangeEvent = { context: UpdatesNativeStateMachineContext };

export type CurrentlyRunningInfo = {
  updateId?: string;
  channel?: string;
  createdAt?: Date;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason: string | null;
  launchDuration?: number;
  manifest?: Partial<Manifest>;
  runtimeVersion?: string;
};

export enum UpdateInfoType {
  NEW = 'new',
  ROLLBACK = 'rollback',
}

export type UpdateInfoNew = {
  type: UpdateInfoType.NEW;
  updateId: string;
  createdAt: Date;
  manifest: Manifest;
};

export type UpdateInfoRollback = {
  type: UpdateInfoType.ROLLBACK;
  updateId: undefined;
  createdAt: Date;
  manifest: undefined;
};

export type UpdateInfo = UpdateInfoNew | UpdateInfoRollback;

export type UseUpdatesReturnType = {
  currentlyRunning: CurrentlyRunningInfo;
  isStartupProcedureRunning: boolean;
  availableUpdate?: UpdateInfo;
  downloadedUpdate?: UpdateInfo;
  isUpdateAvailable: boolean;
  isUpdatePending: boolean;
  isChecking: boolean;
  isDownloading: boolean;
  isRestarting: boolean;
  restartCount: number;
  checkError?: Error;
  downloadError?: Error;
  lastCheckForUpdateTimeSinceRestart?: Date;
  downloadProgress?: number;
};

// ---------------------------------------------------------------------------
// Constants — the types consumers parse, with a web build's honest values
// ---------------------------------------------------------------------------

/** No updates runtime is configured; the embedded (served) code is what runs. */
export const isEnabled = false;
export const updateId: string | null = null;
export const channel: string | null = null;
export const runtimeVersion: string | null = null;
export const checkAutomatically: UpdatesCheckAutomaticallyValue | null = null;
export const localAssets: LocalAssets = {};
export const isEmergencyLaunch = false;
export const emergencyLaunchReason: string | null = null;
export const launchDuration: number | null = null;
/** The running code came with the build, not from an update server. */
export const isEmbeddedLaunch = true;
export const isUsingEmbeddedAssets = true;
/** An OBJECT, never a string — see the note about manifestString above. */
export const manifest: Partial<Manifest> = {};
export const createdAt: Date | null = null;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** The one call with a real web meaning: re-fetch the document. */
export async function reloadAsync(_options?: { reloadScreenOptions?: ReloadScreenOptions }): Promise<void> {
  if (typeof location === 'undefined' || typeof location.reload !== 'function') {
    warnOnce('reload', 'compat updates: no document to reload in this environment; reloadAsync is a no-op.');
    return;
  }
  location.reload();
}

export async function checkForUpdateAsync(): Promise<UpdateCheckResult> {
  return {
    isAvailable: false,
    manifest: undefined,
    isRollBackToEmbedded: false,
    reason: UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER,
  };
}

export async function fetchUpdateAsync(): Promise<UpdateFetchResult> {
  return { isNew: false, manifest: undefined, isRollBackToEmbedded: false };
}

/** Extra params ride along on update requests; there are none to make. */
const extraParams = new Map<string, string>();

export async function getExtraParamsAsync(): Promise<Record<string, string>> {
  return Object.fromEntries(extraParams);
}

export async function setExtraParamAsync(key: string, value: string | null | undefined): Promise<void> {
  if (value === null || value === undefined) extraParams.delete(key);
  else extraParams.set(key, value);
}

export async function readLogEntriesAsync(_maxAge?: number): Promise<UpdatesLogEntry[]> {
  return [];
}

export async function clearLogEntriesAsync(): Promise<void> {}

export function setUpdateURLAndRequestHeadersOverride(
  _configOverride: { updateUrl: string; requestHeaders: Record<string, string> } | null
): void {
  warnOnce(
    'url-override',
    'compat updates: setUpdateURLAndRequestHeadersOverride has no effect — there is no update server to point at.'
  );
}

export function setUpdateRequestHeadersOverride(_requestHeaders: Record<string, string> | null): void {
  warnOnce(
    'headers-override',
    'compat updates: setUpdateRequestHeadersOverride has no effect — there is no update request to send.'
  );
}

export async function showReloadScreen(_options?: { reloadScreenOptions?: ReloadScreenOptions }): Promise<void> {}

export async function hideReloadScreen(): Promise<void> {}

// ---------------------------------------------------------------------------
// State machine + hook
// ---------------------------------------------------------------------------

function idleContext(): UpdatesNativeStateMachineContext {
  return {
    isStartupProcedureRunning: false,
    isUpdateAvailable: false,
    isUpdatePending: false,
    isChecking: false,
    isDownloading: false,
    isRestarting: false,
    restartCount: 0,
    sequenceNumber: 0,
    downloadProgress: 0,
  };
}

export let latestContext: UpdatesNativeStateMachineContext = idleContext();

type UpdatesStateChangeListener = (event: UpdatesNativeStateChangeEvent) => void;
const stateListeners = new Set<UpdatesStateChangeListener>();

/** @hidden */
export const addUpdatesStateChangeListener = (listener: UpdatesStateChangeListener): { remove(): void } => {
  stateListeners.add(listener);
  return { remove: () => void stateListeners.delete(listener) };
};

/** @hidden Test seam upstream exposes; nothing here emits on its own. */
export const emitTestStateChangeEvent = (event: UpdatesNativeStateChangeEvent): void => {
  latestContext = event.context;
  for (const listener of [...stateListeners]) listener(event);
};

/** @hidden */
export const resetLatestContext = (): void => {
  latestContext = idleContext();
};

export const currentlyRunning: CurrentlyRunningInfo = {
  updateId: undefined,
  channel: undefined,
  createdAt: undefined,
  isEmbeddedLaunch,
  isEmergencyLaunch,
  emergencyLaunchReason,
  launchDuration: undefined,
  manifest,
  runtimeVersion: undefined,
};

function updatesStateFromContext(context: UpdatesNativeStateMachineContext): Omit<UseUpdatesReturnType, 'currentlyRunning'> {
  return {
    isStartupProcedureRunning: context.isStartupProcedureRunning,
    isUpdateAvailable: context.isUpdateAvailable,
    isUpdatePending: context.isUpdatePending,
    isChecking: context.isChecking,
    isDownloading: context.isDownloading,
    isRestarting: context.isRestarting,
    restartCount: context.restartCount,
    checkError: context.checkError,
    downloadError: context.downloadError,
    lastCheckForUpdateTimeSinceRestart: context.lastCheckForUpdateTime,
    downloadProgress: context.downloadProgress,
  };
}

export const useUpdates = (): UseUpdatesReturnType => {
  const [updatesState, setUpdatesState] = React.useState(() => updatesStateFromContext(latestContext));
  React.useEffect(() => {
    const subscription = addUpdatesStateChangeListener((event) => {
      setUpdatesState(updatesStateFromContext(event.context));
    });
    return () => subscription.remove();
  }, []);
  return { currentlyRunning, ...updatesState };
};

/**
 * `import * as Updates from 'expo-updates'` is the documented form and is
 * served by the named exports above; the namespace default is here so a
 * default import of the same module also works under ESM/CJS interop.
 */
const Updates = {
  UpdateCheckResultNotAvailableReason,
  UpdatesLogEntryCode,
  UpdatesLogEntryLevel,
  UpdatesCheckAutomaticallyValue,
  UpdateInfoType,
  UpdateEventType,
  isEnabled,
  updateId,
  channel,
  runtimeVersion,
  checkAutomatically,
  localAssets,
  isEmergencyLaunch,
  emergencyLaunchReason,
  launchDuration,
  isEmbeddedLaunch,
  isUsingEmbeddedAssets,
  manifest,
  createdAt,
  currentlyRunning,
  reloadAsync,
  checkForUpdateAsync,
  fetchUpdateAsync,
  getExtraParamsAsync,
  setExtraParamAsync,
  readLogEntriesAsync,
  clearLogEntriesAsync,
  setUpdateURLAndRequestHeadersOverride,
  setUpdateRequestHeadersOverride,
  showReloadScreen,
  hideReloadScreen,
  addUpdatesStateChangeListener,
  useUpdates,
};

export default Updates;
