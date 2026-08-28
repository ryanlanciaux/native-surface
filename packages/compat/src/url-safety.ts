/**
 * Which URLs a compat shim will hand to `window.open`.
 *
 * This exists because of a difference between the two hosts that is easy to
 * miss. `Linking.openURL` and `WebBrowser.openBrowserAsync` are how an app
 * opens a link, and apps route USER-SUPPLIED links through them — a URL in a
 * post, a profile's website field, a link in a message. On a device a
 * `javascript:` URL is inert: the OS has nothing to do with it and the call
 * quietly fails. In a browser `window.open('javascript:…')` opens a window
 * that inherits the opener's ORIGIN and runs the script in it. The same call
 * that does nothing on a phone is stored XSS on this host.
 *
 * So script-only schemes are refused. Everything else is allowed through,
 * including custom app schemes (`myapp://`) — those simply don't resolve in a
 * browser, which is the honest equivalent of a device with nothing registered
 * to handle them, and it is not this shim's job to decide which schemes a host
 * page cares about.
 *
 * `data:` is refused with the script schemes rather than allowed: a
 * `data:text/html` URL carries script just as directly, browsers already block
 * top-level navigation to it, and refusing it here means the shim's answer
 * matches what the browser would do anyway.
 */

/** Schemes whose entire purpose is to execute script in the opener's origin. */
const REFUSED_SCHEMES = new Set(['javascript:', 'vbscript:', 'data:']);

const warned = new Set<string>();

/**
 * The scheme of `url`, resolved the way the browser would — a relative URL is
 * resolved against the current document, so `/foo` reads as `https:` and not
 * as "no scheme".
 */
function schemeOf(url: string): string | null {
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  try {
    return new URL(url, base).protocol.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether this URL may be handed to `window.open`.
 *
 * An unparseable URL is refused: `window.open` would treat it as a relative
 * path against the host page, which is never what an app asking to "open a
 * link" meant.
 */
export function isOpenableURL(url: string): boolean {
  const scheme = schemeOf(url);
  return scheme !== null && !REFUSED_SCHEMES.has(scheme);
}

/**
 * Refuses and warns once per scheme, naming the caller. Returns whether the
 * URL is safe to open, so a caller reads as
 * `if (!assertOpenable(url, 'Linking.openURL')) return false`.
 */
export function assertOpenable(url: string, caller: string): boolean {
  if (isOpenableURL(url)) return true;
  const scheme = schemeOf(url) ?? '(unparseable)';
  if (!warned.has(scheme)) {
    warned.add(scheme);
    console.warn(
      `native-surface compat: ${caller} refused a "${scheme}" URL. On a device that scheme does ` +
        `nothing; in a browser it would run script in this page's origin, so a link from user ` +
        `content could execute here. Only the scheme is refused — the call resolves as a no-op.`
    );
  }
  return false;
}
