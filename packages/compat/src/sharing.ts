/**
 * expo-sharing compat shim — navigator.share-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — isAvailableAsync/shareAsync plus the incoming-share half
 * (getSharedPayloads/getResolvedSharedPayloadsAsync/clearSharedPayloads/
 * useIncomingShare) and its types.
 *
 * shareAsync maps onto the Web Share API: the `url` argument becomes
 * ShareData.url and `dialogTitle` becomes ShareData.title. The platform
 * fields have no browser counterpart and are accepted and ignored —
 * `mimeType` and `UTI` describe a file to a native intent/UTI system, and
 * `anchor` positions an iPad popover.
 *
 * Honest ceilings:
 * - **navigator.share exists only in a secure context, and mostly on mobile
 *   browsers.** isAvailableAsync reports that truthfully instead of always
 *   resolving true; shareAsync rejects with a message naming the reason when
 *   the API is absent, rather than silently dropping the share.
 * - **A user gesture is required.** Called outside one, the browser rejects
 *   with NotAllowedError; a user dismissing the sheet rejects with
 *   AbortError. Both propagate unchanged — the caller's catch is where that
 *   distinction belongs, and swallowing a cancel would look like a
 *   successful share.
 * - **Sharing a local file URI is not possible.** The Web Share API takes
 *   File objects, not paths, and a canvas host has no filesystem to read one
 *   from. A `file:`/`content:` URL is passed through as ShareData.url, which
 *   the browser will refuse — apps that share generated media should hand a
 *   blob:/data: URL instead.
 * - **No incoming shares.** A web page cannot register as a share target
 *   without a PWA manifest and an installed app, so nothing is ever shared
 *   INTO this host: the payload getters report an empty list (truthful for
 *   this host) rather than throwing the way the upstream web module does,
 *   which keeps useIncomingShare usable.
 */
import * as React from 'react';

export type SharingOptions = {
  mimeType?: string;
  UTI?: string;
  dialogTitle?: string;
  anchor?: { x?: number; y?: number; width?: number; height?: number };
};

export type ShareType = 'text' | 'url' | 'audio' | 'image' | 'video' | 'file';
export type ContentType = 'text' | 'audio' | 'image' | 'video' | 'file' | 'website';

export type SharePayload = {
  value: string;
  shareType: ShareType;
  mimeType?: string;
};

export type BaseResolvedSharePayload = SharePayload & {
  contentUri: string | null;
  contentType: ContentType | null;
  contentMimeType: string | null;
  originalName: string | null;
  contentSize: number | null;
};

export type UriBasedResolvedSharePayload = BaseResolvedSharePayload & {
  contentType: 'audio' | 'file' | 'video' | 'image' | 'website';
  contentUri: string;
};

export type TextBasedResolvedSharePayload = BaseResolvedSharePayload & {
  contentType?: 'text';
};

export type ResolvedSharePayload = UriBasedResolvedSharePayload | TextBasedResolvedSharePayload;

export type UseIncomingShareResult = {
  sharedPayloads: SharePayload[];
  resolvedSharedPayloads: ResolvedSharePayload[];
  clearSharedPayloads: () => void;
  isResolving: boolean;
  error: Error | null;
  refreshSharePayloads: () => void;
};

function webShare(): Navigator['share'] | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return typeof navigator.share === 'function' ? navigator.share.bind(navigator) : undefined;
}

export async function isAvailableAsync(): Promise<boolean> {
  return webShare() !== undefined;
}

export async function shareAsync(url: string, options: SharingOptions = {}): Promise<void> {
  const share = webShare();
  if (!share) {
    throw new Error(
      'compat sharing: navigator.share is not available in this environment. The Web Share API requires a secure context (https/localhost) and is unsupported in most desktop browsers — check Sharing.isAvailableAsync() before calling shareAsync.'
    );
  }
  await share({ url, title: options.dialogTitle });
}

/** Always empty: a canvas host is not registered as a share target. */
export function getSharedPayloads(): SharePayload[] {
  return [];
}

export async function getResolvedSharedPayloadsAsync(): Promise<ResolvedSharePayload[]> {
  return [];
}

export function clearSharedPayloads(): void {}

export function useIncomingShare(): UseIncomingShareResult {
  // Nothing can arrive, so the state is constant; the identities are stable so
  // effects keyed on them never re-run.
  const refreshSharePayloads = React.useCallback((): void => {}, []);
  const sharedPayloads = React.useMemo<SharePayload[]>(() => [], []);
  const resolvedSharedPayloads = React.useMemo<ResolvedSharePayload[]>(() => [], []);
  return {
    sharedPayloads,
    resolvedSharedPayloads,
    clearSharedPayloads,
    isResolving: false,
    error: null,
    refreshSharePayloads,
  };
}

/**
 * `import * as Sharing from 'expo-sharing'` is the documented form and is
 * served by the named exports above; the namespace default is here so a
 * default import of the same module also works under ESM/CJS interop.
 */
const Sharing = {
  isAvailableAsync,
  shareAsync,
  getSharedPayloads,
  getResolvedSharedPayloadsAsync,
  clearSharedPayloads,
  useIncomingShare,
};

export default Sharing;
