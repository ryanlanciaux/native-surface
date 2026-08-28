/**
 * react-native-webview compat shim, built on the engine's DOM-portal seam.
 *
 * The canvas cannot paint a browser engine, but the page hosting it IS one:
 * WebView renders a host View carrying `__portal {tag:'iframe'}`, and the
 * engine positions a real <iframe> over the canvas at the view's frame.
 *
 * Fidelity boundaries (iframe physics, not shim gaps):
 *  - The iframe composites ABOVE all canvas content — siblings cannot paint
 *    over the WebView (portal-seam ceiling).
 *  - Script access (injectedJavaScript, the ReactNativeWebView.postMessage
 *    bridge, history/reload introspection) works for SAME-ORIGIN frames only
 *    ({html} sources and same-origin uris). Cross-origin pages must
 *    window.parent.postMessage on their own for onMessage; navigation state
 *    then reports the last-known src with canGoBack:false. Each such gap
 *    warns once at runtime.
 *  - userAgent, allowsInlineMediaPlayback, mediaPlaybackRequiresUserAction,
 *    scalesPageToFit, and domStorageEnabled are accepted and ignored (the
 *    host browser decides); originWhitelist cannot block an iframe navigation
 *    and logs once when it would have.
 */
import * as React from 'react';
import { ActivityIndicator, View } from 'native-surface';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'native-surface';

const HostView = View as unknown as React.FC<Record<string, unknown>>;

export interface WebViewSource {
  uri?: string;
  html?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

export interface WebViewNavigation {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  navigationType: 'click' | 'formsubmit' | 'backforward' | 'reload' | 'formresubmit' | 'other';
}

export interface WebViewNativeEvent {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface WebViewMessageEvent {
  nativeEvent: WebViewNativeEvent & { data: unknown };
}

export interface WebViewErrorEvent {
  nativeEvent: WebViewNativeEvent & { code: number; description: string };
}

export interface WebViewProps {
  source?: WebViewSource;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
  onLoad?: (e: { nativeEvent: WebViewNativeEvent }) => void;
  onLoadStart?: (e: { nativeEvent: WebViewNativeEvent }) => void;
  onLoadEnd?: (e: { nativeEvent: WebViewNativeEvent }) => void;
  onError?: (e: WebViewErrorEvent) => void;
  onMessage?: (e: WebViewMessageEvent) => void;
  onNavigationStateChange?: (state: WebViewNavigation) => void;
  /** Same-origin frames only (cross-origin warns once). */
  injectedJavaScript?: string;
  /** Best effort: evaluated against the initial about:blank document and again
   *  on load — a cross-origin page's own scripts still run first. */
  injectedJavaScriptBeforeContentLoaded?: string;
  startInLoadingState?: boolean;
  renderLoading?: () => React.ReactNode;
  /** false removes allow-scripts from the iframe sandbox. */
  javaScriptEnabled?: boolean;
  /** Accepted and ignored — an iframe cannot enforce it; logs once when it would block. */
  originWhitelist?: string[];
  // Accepted and ignored (host browser policy decides):
  userAgent?: string;
  allowsInlineMediaPlayback?: boolean;
  mediaPlaybackRequiresUserAction?: boolean;
  scalesPageToFit?: boolean;
  domStorageEnabled?: boolean;
}

export interface WebViewHandle {
  reload(): void;
  goBack(): void;
  goForward(): void;
  stopLoading(): void;
  injectJavaScript(script: string): void;
  postMessage(data: string): void;
  requestFocus(): void;
}

const warned = new Set<string>();
function warnOnce(topic: string, message: string): void {
  if (warned.has(topic)) return;
  warned.add(topic);
  console.warn(`native-surface webview: ${message}`);
}

/** The frame's window when the parent may script it; null when cross-origin. */
function sameOriginWindow(el: HTMLIFrameElement | null): Window | null {
  if (!el) return null;
  try {
    const cw = el.contentWindow;
    if (!cw) return null;
    void cw.location.href; // throws cross-origin
    return cw;
  } catch {
    return null;
  }
}

function originAllowed(patterns: string[], url: string): boolean {
  return patterns.some((p) => {
    const re = new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}`);
    return re.test(url);
  });
}

let nextKey = 1;

export const WebView = React.forwardRef<WebViewHandle, WebViewProps>(function WebView(props, ref) {
  const {
    source,
    style,
    containerStyle,
    testID,
    onLayout,
    startInLoadingState = false,
    renderLoading,
    javaScriptEnabled = true,
    originWhitelist,
  } = props;
  const uri = source?.uri;
  const html = source?.html;

  const key = React.useMemo(() => `nswv-${nextKey++}`, []);
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  // handlers attach once (portal create) but must see the latest props
  const propsRef = React.useRef(props);
  propsRef.current = props;
  const [loading, setLoading] = React.useState(startInLoadingState);
  const loadingRef = React.useRef(loading);
  loadingRef.current = loading;

  const navState = React.useCallback((): WebViewNativeEvent => {
    const p = propsRef.current;
    let url = p.source?.uri ?? (p.source?.html != null ? 'about:srcdoc' : 'about:blank');
    let title = '';
    let canGoBack = false;
    const cw = sameOriginWindow(frameRef.current);
    if (cw) {
      try {
        const href = cw.location.href;
        if (href && href !== 'about:blank') url = href;
        title = cw.document?.title ?? '';
        canGoBack = cw.history.length > 1;
      } catch {
        /* frame navigated cross-origin between checks */
      }
    }
    return { url, title, loading: loadingRef.current, canGoBack, canGoForward: false };
  }, []);

  const fireNavigationState = React.useCallback(() => {
    propsRef.current.onNavigationStateChange?.({ ...navState(), navigationType: 'other' });
  }, [navState]);

  const fireLoadStart = React.useCallback(() => {
    propsRef.current.onLoadStart?.({ nativeEvent: { ...navState(), loading: true } });
  }, [navState]);

  const injectBridge = React.useCallback(
    (el: HTMLIFrameElement) => {
      const cw = sameOriginWindow(el) as (Window & { ReactNativeWebView?: unknown }) | null;
      if (!cw) {
        if (propsRef.current.onMessage || propsRef.current.injectedJavaScript) {
          warnOnce(
            'cross-origin-script',
            'cross-origin frame — injectedJavaScript and the ReactNativeWebView.postMessage bridge are unavailable; the page must window.parent.postMessage on its own.'
          );
        }
        return;
      }
      cw.ReactNativeWebView = {
        postMessage: (data: unknown) => window.postMessage({ __nsWebView: key, data }, '*'),
      };
      const p = propsRef.current;
      if (p.injectedJavaScript) {
        try {
          (cw as Window & { eval(js: string): unknown }).eval(p.injectedJavaScript);
        } catch (e) {
          warnOnce('inject-eval', `injectedJavaScript threw: ${String(e)}`);
        }
      }
    },
    [key]
  );

  const onFrameLoad = React.useCallback(() => {
    setLoading(false);
    loadingRef.current = false;
    injectBridge(frameRef.current!);
    const event = { nativeEvent: navState() };
    propsRef.current.onLoad?.(event);
    propsRef.current.onLoadEnd?.(event);
    fireNavigationState();
  }, [injectBridge, navState, fireNavigationState]);

  const onFrameError = React.useCallback(() => {
    setLoading(false);
    loadingRef.current = false;
    const event = { nativeEvent: { ...navState(), code: -1, description: 'frame failed to load' } };
    propsRef.current.onError?.(event);
    propsRef.current.onLoadEnd?.(event);
  }, [navState]);

  const portalRef = React.useCallback(
    (element: HTMLElement | null) => {
      const el = element as HTMLIFrameElement | null;
      const prev = frameRef.current;
      if (prev) {
        prev.removeEventListener('load', onFrameLoad);
        prev.removeEventListener('error', onFrameError);
      }
      frameRef.current = el;
      if (el) {
        el.addEventListener('load', onFrameLoad);
        el.addEventListener('error', onFrameError);
        const before = propsRef.current.injectedJavaScriptBeforeContentLoaded;
        if (before) {
          const cw = sameOriginWindow(el);
          if (cw) {
            try {
              (cw as Window & { eval(js: string): unknown }).eval(before);
            } catch {
              /* initial document not scriptable yet — load-time injection still runs */
            }
          }
        }
        fireLoadStart();
      }
    },
    [onFrameLoad, onFrameError, fireLoadStart]
  );

  // ReactNativeWebView.postMessage contract: bridged frames tag messages with
  // this instance's key; cross-origin pages posting on their own are matched
  // by source window.
  React.useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const handler = propsRef.current.onMessage;
      if (!handler) return;
      const data = e.data as { __nsWebView?: string; data?: unknown } | unknown;
      if (data && typeof data === 'object' && (data as { __nsWebView?: string }).__nsWebView === key) {
        handler({ nativeEvent: { ...navState(), data: (data as { data?: unknown }).data } });
      } else if (frameRef.current && e.source && e.source === frameRef.current.contentWindow) {
        handler({ nativeEvent: { ...navState(), data: e.data } });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [key, navState]);

  // subsequent navigations (source prop changes); the initial one fires from portalRef
  const firstSource = React.useRef(true);
  React.useEffect(() => {
    if (firstSource.current) {
      firstSource.current = false;
      return;
    }
    fireLoadStart();
  }, [uri, html, fireLoadStart]);

  React.useEffect(() => {
    if (originWhitelist && uri && !originAllowed(originWhitelist, uri)) {
      warnOnce(
        `originWhitelist:${uri}`,
        `originWhitelist would block ${uri} — an iframe cannot open it externally; loading in place anyway.`
      );
    }
  }, [uri, originWhitelist]);

  React.useImperativeHandle(
    ref,
    (): WebViewHandle => ({
      reload() {
        const el = frameRef.current;
        if (!el) return;
        fireLoadStart();
        const cw = sameOriginWindow(el);
        const href = cw ? cw.location.href : null;
        if (href && href !== 'about:blank' && el.getAttribute('srcdoc') == null) {
          el.src = href; // re-navigate to wherever the frame actually is
        } else if (el.getAttribute('srcdoc') != null) {
          el.setAttribute('srcdoc', el.getAttribute('srcdoc')!);
        } else if (el.getAttribute('src') != null) {
          el.src = el.getAttribute('src')!; // re-assignment reloads the frame
        }
      },
      goBack() {
        const cw = sameOriginWindow(frameRef.current);
        if (cw) cw.history.back();
        else warnOnce('history', 'goBack/goForward need a same-origin frame — ignored for cross-origin content.');
      },
      goForward() {
        const cw = sameOriginWindow(frameRef.current);
        if (cw) cw.history.forward();
        else warnOnce('history', 'goBack/goForward need a same-origin frame — ignored for cross-origin content.');
      },
      stopLoading() {
        const cw = sameOriginWindow(frameRef.current);
        if (cw) cw.stop?.();
        else warnOnce('stop', 'stopLoading needs a same-origin frame — ignored for cross-origin content.');
      },
      injectJavaScript(script: string) {
        const cw = sameOriginWindow(frameRef.current);
        if (!cw) {
          warnOnce('inject-cross-origin', 'injectJavaScript needs a same-origin frame — ignored for cross-origin content.');
          return;
        }
        try {
          (cw as Window & { eval(js: string): unknown }).eval(script);
        } catch (e) {
          warnOnce('inject-eval', `injectJavaScript threw: ${String(e)}`);
        }
      },
      postMessage(data: string) {
        frameRef.current?.contentWindow?.postMessage(data, '*');
      },
      requestFocus() {
        frameRef.current?.focus();
      },
    }),
    [fireLoadStart]
  );

  const attrs: Record<string, string | boolean> = {
    'sandbox': javaScriptEnabled
      ? 'allow-scripts allow-same-origin allow-forms allow-popups'
      : 'allow-same-origin allow-forms allow-popups',
    'referrerpolicy': 'strict-origin-when-cross-origin',
    'allowfullscreen': true,
    'data-ns-webview': key,
  };
  if (html != null) attrs.srcdoc = html;
  else if (uri != null) attrs.src = uri;

  const showLoading = loading && startInLoadingState;
  return (
    <HostView style={[{ flex: 1 }, containerStyle, style]} testID={testID} onLayout={onLayout}>
      <HostView
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        __portal={{
          tag: 'iframe',
          key,
          attrs,
          // canvas paints UNDER the portal, so the loading view can only show
          // through a fully transparent frame
          style: showLoading ? { opacity: '0' } : {},
        }}
        __portalRef={portalRef}
      />
      {showLoading ? (
        <HostView
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {renderLoading ? renderLoading() : <ActivityIndicator size="large" />}
        </HostView>
      ) : null}
    </HostView>
  );
});

export default WebView;
