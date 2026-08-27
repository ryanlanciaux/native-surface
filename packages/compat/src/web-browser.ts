/**
 * expo-web-browser compat shim — window.open-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — openBrowserAsync/openAuthSessionAsync/dismissBrowser/
 * dismissAuthSession/maybeCompleteAuthSession, the Android Custom Tabs
 * service calls (warmUpAsync/coolDownAsync/mayInitWithUrlAsync/
 * getCustomTabsSupportingBrowsersAsync) and the WebBrowserResultType /
 * WebBrowserPresentationStyle enums.
 *
 * An in-app browser is a popup window here. openBrowserAsync opens one and
 * reports 'opened'; openAuthSessionAsync opens one and settles when either
 * the popup hands back a redirect or the user closes it. Two channels detect
 * the redirect, because either one alone has holes:
 *   1. postMessage from the popup — the redirect page calls
 *      maybeCompleteAuthSession(), which posts its URL to the opener keyed by
 *      a handle both windows read from localStorage. This is the upstream web
 *      handshake and works only when the redirect page is our own app.
 *   2. same-origin polling — reading popup.location.href throws for a
 *      cross-origin document, so when it IS readable and matches redirectUrl
 *      the session resolves even if that page never calls back.
 * A poll also watches popup.closed and resolves {type:'dismiss'}.
 *
 * Honest ceilings:
 * - **Popup blockers.** window.open only succeeds inside the user-gesture
 *   task that triggered it. Called from a timer, a promise continuation, or
 *   too long after a tap, the browser blocks it: openAuthSessionAsync rejects
 *   with ERR_WEB_BROWSER_BLOCKED (as upstream does) and openBrowserAsync
 *   resolves 'cancel' rather than claiming 'opened' for a window that never
 *   appeared.
 * - **Cross-origin redirect detection is impossible.** For a third-party
 *   identity host that redirects to a URL we do not serve, neither channel
 *   fires: the document is unreadable and nothing calls
 *   maybeCompleteAuthSession. The session then only ever settles as
 *   'dismiss' when the user closes the popup. There is no browser API that
 *   fixes this; the redirect target must be same-origin with the app.
 * - **No browser chrome control.** toolbarColor, controlsColor, readerMode,
 *   dismissButtonStyle, presentationStyle and friends are accepted and
 *   ignored — a popup is not SFSafariViewController. windowName and
 *   windowFeatures ARE honored; they are the web leg of the same options.
 * - **Custom Tabs has no web equivalent.** warmUpAsync / coolDownAsync /
 *   mayInitWithUrlAsync resolve empty results and
 *   getCustomTabsSupportingBrowsersAsync reports no packages.
 */
import { assertOpenable } from './url-safety';

export enum WebBrowserResultType {
  CANCEL = 'cancel',
  DISMISS = 'dismiss',
  OPENED = 'opened',
  LOCKED = 'locked',
}

export enum WebBrowserPresentationStyle {
  FULL_SCREEN = 'fullScreen',
  PAGE_SHEET = 'pageSheet',
  FORM_SHEET = 'formSheet',
  CURRENT_CONTEXT = 'currentContext',
  OVER_FULL_SCREEN = 'overFullScreen',
  OVER_CURRENT_CONTEXT = 'overCurrentContext',
  POPOVER = 'popover',
  AUTOMATIC = 'automatic',
}

export type RedirectEvent = { url: string };
export type WebBrowserWindowFeatures = Record<string, number | boolean | string>;

export type WebBrowserOpenOptions = {
  toolbarColor?: string;
  browserPackage?: string;
  enableBarCollapsing?: boolean;
  secondaryToolbarColor?: string;
  showTitle?: boolean;
  enableDefaultShareMenuItem?: boolean;
  showInRecents?: boolean;
  createTask?: boolean;
  useProxyActivity?: boolean;
  controlsColor?: string;
  dismissButtonStyle?: 'done' | 'close' | 'cancel';
  readerMode?: boolean;
  presentationStyle?: WebBrowserPresentationStyle;
  windowName?: string;
  windowFeatures?: string | WebBrowserWindowFeatures;
};

export type AuthSessionOpenOptions = WebBrowserOpenOptions & {
  preferEphemeralSession?: boolean;
  preferUniversalLinks?: boolean;
};

export type WebBrowserResult = { type: WebBrowserResultType };
export type WebBrowserRedirectResult = { type: 'success'; url: string };
export type WebBrowserAuthSessionResult = WebBrowserRedirectResult | WebBrowserResult;

export type ServiceActionResult = { servicePackage?: string };
export type WebBrowserMayInitWithUrlResult = ServiceActionResult;
export type WebBrowserWarmUpResult = ServiceActionResult;
export type WebBrowserCoolDownResult = ServiceActionResult;

export type WebBrowserCustomTabsResults = {
  defaultBrowserPackage?: string;
  preferredBrowserPackage?: string;
  browserPackages: string[];
  servicePackages: string[];
};

export type WebBrowserCompleteAuthSessionOptions = { skipRedirectCheck?: boolean };
export type WebBrowserCompleteAuthSessionResult = { type: 'success' | 'failed'; message: string };

/** Matches expo-modules-core's CodedError so `error.code` branches keep working. */
class WebBrowserCodedError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CodedError';
  }
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    // Privacy mode / partitioned storage: the auth handshake degrades to the
    // same-origin polling channel.
    return null;
  }
}

// Upstream's key names, so a page that still runs the real package's other
// half completes against a session this shim started.
const HANDLE_KEY = 'ExpoWebBrowserRedirectHandle';
const originUrlKey = (handle: string): string => `ExpoWebBrowser_OriginUrl_${handle}`;
const redirectUrlKey = (handle: string): string => `ExpoWebBrowser_RedirectUrl_${handle}`;

const POPUP_WIDTH = 500;
const POPUP_HEIGHT = 650;
/** Poll cadence for popup.closed and the same-origin redirect probe. */
const POLL_INTERVAL_MS = 250;

// ---------------------------------------------------------------------------
// Window features
// ---------------------------------------------------------------------------

function normalizeFeatures(options?: string | WebBrowserWindowFeatures): WebBrowserWindowFeatures {
  if (typeof options === 'string') {
    const features: WebBrowserWindowFeatures = {};
    for (const pair of options.split(',')) {
      const [key, value] = pair.trim().split('=');
      if (key && value) features[key] = value;
    }
    return features;
  }
  return options ?? {};
}

function featuresToString(features: WebBrowserWindowFeatures): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(features)) {
    const value = typeof raw === 'boolean' ? (raw ? 'yes' : 'no') : raw;
    if (key && value !== '' && value !== undefined) parts.push(`${key}=${String(value)}`);
  }
  return parts.join(',');
}

function popupFeatures(options?: string | WebBrowserWindowFeatures): string {
  const features = normalizeFeatures(options);
  const width = features.width ?? POPUP_WIDTH;
  const height = features.height ?? POPUP_HEIGHT;
  const screenHeight = typeof screen !== 'undefined' ? screen.height : 0;
  const screenWidth = typeof screen !== 'undefined' ? screen.width : 0;
  return featuresToString({
    ...features,
    toolbar: features.toolbar ?? 'no',
    menubar: features.menubar ?? 'no',
    location: features.location ?? 'yes',
    resizable: features.resizable ?? 'yes',
    status: features.status ?? 'no',
    scrollbars: features.scrollbars ?? 'yes',
    top: features.top ?? Math.max(0, (screenHeight - Number(height)) * 0.5),
    left: features.left ?? Math.max(0, (screenWidth - Number(width)) * 0.5),
    width,
    height,
  });
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/**
 * Upstream's comparison form: origin without the protocol plus the decoded
 * pathname, lowercased. Query and hash are dropped — the redirect carries the
 * auth payload there, so they must not participate in the match.
 */
function normalizeUrl(url: URL | Location): string {
  const origin = url.origin.replace(url.protocol, '').replace(/^\/+/, '').replace(/\/+$/, '');
  return (origin + decodeURI(url.pathname.replace(/\/{2,}/g, '/'))).toLowerCase();
}

function safeNormalize(url: string): string {
  try {
    return normalizeUrl(new URL(url));
  } catch {
    return url;
  }
}

function defaultRedirectUrl(inputUrl: string): string {
  try {
    const parsed = new URL(inputUrl);
    const declared = parsed.searchParams.get('redirect_uri');
    if (declared) return declared;
  } catch {
    /* not an absolute URL — fall through to this page's address */
  }
  return typeof location !== 'undefined' ? location.origin + location.pathname : '';
}

/**
 * Session handle. Upstream derives it from a SHA-256 digest and throws
 * ERR_WEB_BROWSER_CRYPTO on insecure origins; a random token is just as
 * unguessable for a same-origin postMessage check, and it keeps auth working
 * on plain-http dev hosts.
 */
function generateHandle(inputUrl: string): string {
  try {
    const state = new URL(inputUrl).searchParams.get('state');
    if (state) return state;
  } catch {
    /* relative url — mint a fresh handle */
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ns-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// ---------------------------------------------------------------------------
// Open / dismiss
// ---------------------------------------------------------------------------

/** The window openBrowserAsync opened, so dismissBrowser has something to close. */
let browserWindow: Window | null = null;

export async function openBrowserAsync(
  url: string,
  browserParams: WebBrowserOpenOptions = {}
): Promise<WebBrowserResult> {
  if (!hasWindow()) {
    warnOnce('open-no-window', 'compat web-browser: no window (SSR/node); openBrowserAsync resolves cancel.');
    return { type: WebBrowserResultType.CANCEL };
  }
  // See url-safety.ts: a script-only scheme would run in this page's origin.
  if (!assertOpenable(url, 'WebBrowser.openBrowserAsync')) {
    return { type: WebBrowserResultType.CANCEL };
  }
  const { windowName = '_blank', windowFeatures } = browserParams;
  const opened = window.open(url, windowName, popupFeatures(windowFeatures));
  if (!opened) {
    // Reporting 'opened' for a blocked popup would send apps into a flow that
    // is not on screen. 'cancel' is a documented result they already handle.
    warnOnce(
      'open-blocked',
      'compat web-browser: window.open was blocked — call openBrowserAsync directly from a user gesture. Resolving cancel.'
    );
    return { type: WebBrowserResultType.CANCEL };
  }
  browserWindow = opened;
  return { type: WebBrowserResultType.OPENED };
}

export async function dismissBrowser(): Promise<{ type: WebBrowserResultType.DISMISS }> {
  try {
    browserWindow?.close();
  } catch {
    /* already closed or cross-origin navigated away */
  }
  browserWindow = null;
  return { type: WebBrowserResultType.DISMISS };
}

// ---------------------------------------------------------------------------
// Auth session
// ---------------------------------------------------------------------------

interface AuthSession {
  popup: Window;
  handle: string;
  interval: ReturnType<typeof setInterval>;
  messageListener: (event: MessageEvent) => void;
  settle: (result: WebBrowserAuthSessionResult) => void;
}

let authSession: AuthSession | null = null;

function teardownAuthSession(): void {
  const session = authSession;
  if (!session) return;
  authSession = null;
  clearInterval(session.interval);
  if (hasWindow()) window.removeEventListener('message', session.messageListener);
  const store = storage();
  if (store) {
    store.removeItem(HANDLE_KEY);
    store.removeItem(originUrlKey(session.handle));
    store.removeItem(redirectUrlKey(session.handle));
  }
  try {
    session.popup.close();
  } catch {
    /* the popup may already be gone */
  }
}

export async function openAuthSessionAsync(
  url: string,
  redirectUrl?: string | null,
  options?: AuthSessionOpenOptions
): Promise<WebBrowserAuthSessionResult> {
  if (!hasWindow()) {
    warnOnce('auth-no-window', 'compat web-browser: no window (SSR/node); openAuthSessionAsync resolves cancel.');
    return { type: WebBrowserResultType.CANCEL };
  }

  if (!assertOpenable(url, 'WebBrowser.openAuthSessionAsync')) {
    throw new WebBrowserCodedError(
      'ERR_WEB_BROWSER_BLOCKED',
      'Refused to open a script-only URL scheme. See url-safety.ts.'
    );
  }

  // A second call replaces the first: only one popup can be the auth window.
  if (authSession) teardownAuthSession();

  const popup = window.open(url, options?.windowName, popupFeatures(options?.windowFeatures));
  if (!popup) {
    throw new WebBrowserCodedError(
      'ERR_WEB_BROWSER_BLOCKED',
      'Popup window was blocked by the browser or failed to open. openAuthSessionAsync must be called directly from a user gesture.'
    );
  }
  try {
    popup.focus();
  } catch {
    /* focus is advisory */
  }

  const handle = generateHandle(url);
  const normalizedRedirect = safeNormalize(redirectUrl ?? defaultRedirectUrl(url));
  const store = storage();
  if (store) {
    store.setItem(HANDLE_KEY, handle);
    store.setItem(redirectUrlKey(handle), normalizedRedirect);
  }

  return new Promise<WebBrowserAuthSessionResult>((resolve) => {
    const settle = (result: WebBrowserAuthSessionResult): void => {
      teardownAuthSession();
      resolve(result);
    };

    // Channel 1: the redirect page called maybeCompleteAuthSession().
    const messageListener = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { url?: string; expoSender?: string } | null;
      if (!data || data.expoSender !== handle || typeof data.url !== 'string') return;
      settle({ type: 'success', url: data.url });
    };
    window.addEventListener('message', messageListener, false);

    // Channel 2: the popup closed, or its document became readable (same
    // origin) at the redirect URL.
    const interval = setInterval(() => {
      if (popup.closed) {
        settle({ type: WebBrowserResultType.DISMISS });
        return;
      }
      let href: string | null = null;
      try {
        href = popup.location.href;
      } catch {
        // Cross-origin document: unreadable by design. Keep waiting.
        return;
      }
      if (!href || href === 'about:blank') return;
      if (safeNormalize(href) === normalizedRedirect) settle({ type: 'success', url: href });
    }, POLL_INTERVAL_MS);

    authSession = { popup, handle, interval, messageListener, settle };
  });
}

export function dismissAuthSession(): void {
  if (!hasWindow()) return;
  const session = authSession;
  if (!session) return;
  session.settle({ type: WebBrowserResultType.DISMISS });
}

/**
 * Runs in the popup, on the page the auth provider redirected to. Posts the
 * current URL back to the opener; the opener's session resolves 'success' and
 * closes this window.
 */
export function maybeCompleteAuthSession(
  options: WebBrowserCompleteAuthSessionOptions = {}
): WebBrowserCompleteAuthSessionResult {
  if (!hasWindow()) {
    return { type: 'failed', message: 'Cannot use expo-web-browser in a non-browser environment' };
  }
  const store = storage();
  const handle = store?.getItem(HANDLE_KEY);
  if (!handle) {
    return { type: 'failed', message: 'No auth session is currently in progress' };
  }
  const url = window.location.href;
  if (options.skipRedirectCheck !== true) {
    const expected = store?.getItem(redirectUrlKey(handle));
    const current = normalizeUrl(window.location);
    if (expected !== current) {
      return {
        type: 'failed',
        message: `Current URL "${current}" and original redirect URL "${expected ?? ''}" do not match.`,
      };
    }
  }
  // Also recorded in storage: an opener that was reloaded mid-flow lost its
  // message listener, and this is the only trace of the completed redirect.
  store?.setItem(originUrlKey(handle), url);
  const parent = window.opener ?? window.parent;
  if (!parent) {
    throw new WebBrowserCodedError(
      'ERR_WEB_BROWSER_REDIRECT',
      "The window cannot complete the redirect request because the invoking window doesn't have a reference to its parent. This can happen if the parent window was reloaded."
    );
  }
  (parent as Window).postMessage({ url, expoSender: handle }, window.location.origin);
  return { type: 'success', message: 'Attempting to complete auth' };
}

// ---------------------------------------------------------------------------
// Android Custom Tabs service — no web equivalent, resolved as empty results
// ---------------------------------------------------------------------------

export async function getCustomTabsSupportingBrowsersAsync(): Promise<WebBrowserCustomTabsResults> {
  return { browserPackages: [], servicePackages: [] };
}

export async function warmUpAsync(_browserPackage?: string): Promise<WebBrowserWarmUpResult> {
  return {};
}

export async function mayInitWithUrlAsync(
  _url: string,
  _browserPackage?: string
): Promise<WebBrowserMayInitWithUrlResult> {
  return {};
}

export async function coolDownAsync(_browserPackage?: string): Promise<WebBrowserCoolDownResult> {
  return {};
}

/**
 * `import * as WebBrowser from 'expo-web-browser'` is the documented form and
 * is served by the named exports above; the namespace default is here so a
 * default import of the same module also works under ESM/CJS interop.
 */
const WebBrowser = {
  WebBrowserResultType,
  WebBrowserPresentationStyle,
  openBrowserAsync,
  dismissBrowser,
  openAuthSessionAsync,
  dismissAuthSession,
  maybeCompleteAuthSession,
  getCustomTabsSupportingBrowsersAsync,
  warmUpAsync,
  mayInitWithUrlAsync,
  coolDownAsync,
};

export default WebBrowser;
