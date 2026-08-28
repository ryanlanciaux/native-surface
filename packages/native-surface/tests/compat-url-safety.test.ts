/**
 * A compat shim must not turn a link into script execution.
 *
 * `Linking.openURL` and `WebBrowser.openBrowserAsync` are how an app opens a
 * link, and apps route USER-SUPPLIED links through them — a URL in a post, a
 * profile's website field, a link in a message. On a device a `javascript:`
 * URL is inert: the OS has nothing registered for it and the call quietly
 * fails. In a browser, `window.open('javascript:…')` opens a window that
 * inherits the opener's ORIGIN and runs the script in it. The same call that
 * does nothing on a phone is stored XSS on this host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOpenableURL } from '../../compat/src/url-safety';

const open = vi.fn();

async function linking() {
  vi.resetModules();
  return import('../../compat/src/expo');
}

describe('url-safety: which schemes reach window.open', () => {
  beforeEach(() => {
    open.mockClear();
    vi.stubGlobal('window', { open, location: { href: 'https://host.test/' } });
    vi.stubGlobal('location', { href: 'https://host.test/' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses the script-only schemes', () => {
    for (const url of [
      'javascript:alert(document.domain)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      expect(isOpenableURL(url), url).toBe(false);
    }
  });

  it('allows ordinary links, and custom app schemes', () => {
    for (const url of [
      'https://example.com/post/1',
      'http://example.com',
      'mailto:someone@example.com',
      'tel:+15551234',
      'sms:+15551234',
      // A custom scheme simply doesn't resolve in a browser, which is the
      // honest equivalent of a device with no handler for it.
      'myapp://profile/42',
      'bluesky://intent/compose',
    ]) {
      expect(isOpenableURL(url), url).toBe(true);
    }
  });

  it('resolves a relative URL the way the browser would', () => {
    // Not "no scheme" — it inherits the page's, which is https here.
    expect(isOpenableURL('/settings')).toBe(true);
  });

  it('Linking.openURL does not hand a javascript: URL to window.open', async () => {
    const { openURL } = await linking();
    await expect(openURL('javascript:alert(1)')).resolves.toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('Linking.openURL still opens a real link', async () => {
    const { openURL } = await linking();
    await expect(openURL('https://example.com')).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });

  it('canOpenURL answers honestly instead of always true', async () => {
    const { canOpenURL } = await linking();
    await expect(canOpenURL('javascript:alert(1)')).resolves.toBe(false);
    await expect(canOpenURL('https://example.com')).resolves.toBe(true);
  });

  it('warns once per scheme, naming the caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { openURL } = await linking();
    await openURL('javascript:alert(1)');
    await openURL('javascript:alert(2)');
    const messages = warn.mock.calls.map(([m]) => String(m));
    expect(messages.filter((m) => m.includes('javascript:'))).toHaveLength(1);
    expect(messages[0]).toContain('Linking.openURL');
  });
});
