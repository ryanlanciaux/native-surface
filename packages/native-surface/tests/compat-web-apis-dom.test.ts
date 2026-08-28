// @vitest-environment jsdom
/**
 * Expo browser-API compat pack, DOM half: the behavior that only exists once
 * there is a document. openAuthSessionAsync's two redirect channels (the
 * popup's postMessage handshake and same-origin location polling) plus its
 * dismiss-on-close poll; the wake lock's acquire / reference count / release
 * and the re-acquire the Screen Wake Lock API forces after a tab is hidden;
 * and screen.orientation reads, locks and change events. The DOM-less half —
 * import safety, the geolocation mapping, the UA matrix, updates' constants —
 * lives in compat-web-apis.test.ts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as WebBrowser from '../../compat/src/web-browser';
import * as KeepAwake from '../../compat/src/keep-awake';
import * as ScreenOrientation from '../../compat/src/screen-orientation';
import * as Sharing from '../../compat/src/sharing';

afterEach(() => {
  KeepAwake.__resetKeepAwake();
  ScreenOrientation.removeOrientationChangeListeners();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// web-browser
// ---------------------------------------------------------------------------

interface FakePopup {
  closed: boolean;
  location: { href: string };
  focus: () => void;
  close: () => void;
}

function fakePopup(href = 'about:blank'): FakePopup {
  const popup: FakePopup = {
    closed: false,
    location: { href },
    focus: () => {},
    close: () => {
      popup.closed = true;
    },
  };
  return popup;
}

function stubOpen(popup: FakePopup | null) {
  return vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
}

describe('web-browser compat shim (popups)', () => {
  test('openBrowserAsync reports opened, and cancel when the popup is blocked', async () => {
    const popup = fakePopup();
    const open = stubOpen(popup);
    await expect(WebBrowser.openBrowserAsync('https://example.com', { windowName: 'preview' })).resolves.toEqual({
      type: 'opened',
    });
    expect(open).toHaveBeenCalledWith('https://example.com', 'preview', expect.stringContaining('width='));

    // dismissBrowser closes the window it opened.
    await expect(WebBrowser.dismissBrowser()).resolves.toEqual({ type: 'dismiss' });
    expect(popup.closed).toBe(true);

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubOpen(null);
    await expect(WebBrowser.openBrowserAsync('https://example.com')).resolves.toEqual({ type: 'cancel' });
  });

  test('openAuthSessionAsync resolves dismiss when the user closes the popup', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    stubOpen(popup);
    const session = WebBrowser.openAuthSessionAsync('https://idp.example/authorize', 'http://localhost:3000/callback');
    await vi.advanceTimersByTimeAsync(300);

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(300);
    await expect(session).resolves.toEqual({ type: 'dismiss' });
    // The session's storage handle is cleaned up on settle.
    expect(localStorage.getItem('ExpoWebBrowserRedirectHandle')).toBeNull();
  });

  test('a redirect page posting back through maybeCompleteAuthSession resolves success', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    stubOpen(popup);
    const session = WebBrowser.openAuthSessionAsync('https://idp.example/authorize', 'http://localhost:3000/callback');
    await vi.advanceTimersByTimeAsync(10);

    const handle = localStorage.getItem('ExpoWebBrowserRedirectHandle');
    expect(handle).toBeTruthy();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { url: 'http://localhost:3000/callback?code=abc', expoSender: handle },
        origin: window.location.origin,
      })
    );
    await expect(session).resolves.toEqual({ type: 'success', url: 'http://localhost:3000/callback?code=abc' });
    expect(popup.closed).toBe(true);
  });

  test('a message from another origin or another session is ignored', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    stubOpen(popup);
    const session = WebBrowser.openAuthSessionAsync('https://idp.example/authorize', 'http://localhost:3000/callback');
    await vi.advanceTimersByTimeAsync(10);

    const handle = localStorage.getItem('ExpoWebBrowserRedirectHandle');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { url: 'http://evil.example/callback', expoSender: handle },
        origin: 'http://evil.example',
      })
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { url: 'http://localhost:3000/callback', expoSender: 'some-other-session' },
        origin: window.location.origin,
      })
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(popup.closed).toBe(false);

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(300);
    await expect(session).resolves.toEqual({ type: 'dismiss' });
  });

  test('a same-origin redirect is detected by polling even without a callback', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    stubOpen(popup);
    const session = WebBrowser.openAuthSessionAsync('https://idp.example/authorize', 'http://localhost:3000/callback');
    await vi.advanceTimersByTimeAsync(300);

    popup.location.href = 'http://localhost:3000/callback?code=xyz&state=1';
    await vi.advanceTimersByTimeAsync(300);
    await expect(session).resolves.toEqual({
      type: 'success',
      url: 'http://localhost:3000/callback?code=xyz&state=1',
    });
  });

  test('a cross-origin popup document is unreadable and never resolves success', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    // Reading location.href of a cross-origin document throws — the ceiling
    // this shim documents.
    Object.defineProperty(popup, 'location', {
      get() {
        throw new DOMException('Blocked a frame with origin', 'SecurityError');
      },
    });
    stubOpen(popup);
    const session = WebBrowser.openAuthSessionAsync('https://idp.example/authorize', 'http://localhost:3000/callback');
    await vi.advanceTimersByTimeAsync(2_000);

    popup.closed = true;
    await vi.advanceTimersByTimeAsync(300);
    await expect(session).resolves.toEqual({ type: 'dismiss' });
  });

  test('dismissAuthSession settles the pending session', async () => {
    vi.useFakeTimers();
    const popup = fakePopup();
    stubOpen(popup);
    const session = WebBrowser.openAuthSessionAsync('https://idp.example/authorize');
    await vi.advanceTimersByTimeAsync(10);
    WebBrowser.dismissAuthSession();
    await expect(session).resolves.toEqual({ type: 'dismiss' });
    expect(popup.closed).toBe(true);
  });

  test('a blocked popup rejects with ERR_WEB_BROWSER_BLOCKED', async () => {
    stubOpen(null);
    await expect(WebBrowser.openAuthSessionAsync('https://idp.example/authorize')).rejects.toMatchObject({
      code: 'ERR_WEB_BROWSER_BLOCKED',
    });
  });

  test('maybeCompleteAuthSession reports the two documented failures', () => {
    expect(WebBrowser.maybeCompleteAuthSession()).toEqual({
      type: 'failed',
      message: 'No auth session is currently in progress',
    });

    localStorage.setItem('ExpoWebBrowserRedirectHandle', 'handle-1');
    localStorage.setItem('ExpoWebBrowser_RedirectUrl_handle-1', 'localhost:3000/somewhere-else');
    const mismatch = WebBrowser.maybeCompleteAuthSession();
    expect(mismatch.type).toBe('failed');
    expect(mismatch.message).toMatch(/do not match/);

    // skipRedirectCheck posts anyway; jsdom's window.opener is null, so the
    // fallback parent (window itself) receives it.
    expect(WebBrowser.maybeCompleteAuthSession({ skipRedirectCheck: true })).toEqual({
      type: 'success',
      message: 'Attempting to complete auth',
    });
    expect(localStorage.getItem('ExpoWebBrowser_OriginUrl_handle-1')).toBe(window.location.href);
  });
});

// ---------------------------------------------------------------------------
// keep-awake
// ---------------------------------------------------------------------------

interface FakeSentinel {
  released: boolean;
  type: string;
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  fireRelease: () => void;
}

function makeSentinel(): FakeSentinel {
  const listeners = new Set<() => void>();
  const sentinel: FakeSentinel = {
    released: false,
    type: 'screen',
    release: async () => {
      sentinel.released = true;
      sentinel.fireRelease();
    },
    addEventListener: (type, listener) => {
      if (type === 'release') listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    fireRelease: () => {
      for (const listener of [...listeners]) listener();
    },
  };
  return sentinel;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

describe('keep-awake compat shim (Screen Wake Lock)', () => {
  let sentinels: FakeSentinel[];
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sentinels = [];
    request = vi.fn(async (type: string) => {
      expect(type).toBe('screen');
      const sentinel = makeSentinel();
      sentinels.push(sentinel);
      return sentinel;
    });
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    setVisibility('visible');
  });

  test('isAvailableAsync reflects the API being present', async () => {
    await expect(KeepAwake.isAvailableAsync()).resolves.toBe(true);
  });

  test('a tag holds one lock, reference counted across paired calls', async () => {
    await KeepAwake.activateKeepAwakeAsync('screen-a');
    expect(request).toHaveBeenCalledTimes(1);

    await KeepAwake.activateKeepAwakeAsync('screen-a');
    expect(request).toHaveBeenCalledTimes(1); // still one lock for the tag

    await KeepAwake.deactivateKeepAwake('screen-a');
    expect(sentinels[0]!.released).toBe(false); // one holder left

    await KeepAwake.deactivateKeepAwake('screen-a');
    expect(sentinels[0]!.released).toBe(true);
  });

  test('separate tags take separate locks', async () => {
    await KeepAwake.activateKeepAwakeAsync('a');
    await KeepAwake.activateKeepAwakeAsync('b');
    expect(request).toHaveBeenCalledTimes(2);
    await KeepAwake.deactivateKeepAwake('a');
    expect(sentinels[0]!.released).toBe(true);
    expect(sentinels[1]!.released).toBe(false);
    await KeepAwake.deactivateKeepAwake('b');
    expect(sentinels[1]!.released).toBe(true);
  });

  test('a lock the browser took back while hidden is re-acquired on visibilitychange', async () => {
    await KeepAwake.activateKeepAwakeAsync('reader');
    expect(request).toHaveBeenCalledTimes(1);

    // Hiding the tab releases the sentinel — specified behavior, not an error.
    setVisibility('hidden');
    sentinels[0]!.released = true;
    sentinels[0]!.fireRelease();
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1); // still hidden: nothing to take

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    // The replacement lock is the one that gets released.
    await KeepAwake.deactivateKeepAwake('reader');
    expect(sentinels[1]!.released).toBe(true);
  });

  test('a released tag is not re-acquired after deactivation', async () => {
    await KeepAwake.activateKeepAwakeAsync('transient');
    await KeepAwake.deactivateKeepAwake('transient');
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('addListener reports RELEASE for the tag', async () => {
    const events: KeepAwake.KeepAwakeEvent[] = [];
    await KeepAwake.activateKeepAwakeAsync('watched');
    const subscription = KeepAwake.addListener('watched', (event) => events.push(event));
    sentinels[0]!.released = true;
    sentinels[0]!.fireRelease();
    expect(events).toEqual([{ state: 'release' }]);
    subscription.remove();
    sentinels[0]!.fireRelease();
    expect(events).toHaveLength(1);
  });

  test('deactivating a tag that was never activated throws the documented coded error', async () => {
    await expect(KeepAwake.deactivateKeepAwake('ghost')).rejects.toMatchObject({
      code: 'ERR_KEEP_AWAKE_TAG_INVALID',
    });
  });

  test('a refused wake-lock request propagates, and the tag stays deactivatable', async () => {
    request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await expect(KeepAwake.activateKeepAwakeAsync('refused')).rejects.toThrow(/denied/);
    await expect(KeepAwake.deactivateKeepAwake('refused')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// screen-orientation
// ---------------------------------------------------------------------------

interface FakeOrientation {
  type: string;
  lock: ReturnType<typeof vi.fn>;
  unlock: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  fireChange: () => void;
}

function installOrientation(type = 'portrait-primary'): FakeOrientation {
  const listeners = new Set<() => void>();
  const orientation: FakeOrientation = {
    type,
    lock: vi.fn(async () => {}),
    unlock: vi.fn(() => {}),
    addEventListener: (event, listener) => {
      if (event === 'change') listeners.add(listener);
    },
    removeEventListener: (_event, listener) => {
      listeners.delete(listener);
    },
    fireChange: () => {
      for (const listener of [...listeners]) listener();
    },
  };
  Object.defineProperty(window.screen, 'orientation', { value: orientation, configurable: true });
  return orientation;
}

describe('screen-orientation compat shim (Screen Orientation API)', () => {
  test('screen.orientation.type maps onto the Orientation enum', async () => {
    const orientation = installOrientation('landscape-primary');
    await expect(ScreenOrientation.getOrientationAsync()).resolves.toBe(
      ScreenOrientation.Orientation.LANDSCAPE_LEFT
    );
    orientation.type = 'portrait-secondary';
    await expect(ScreenOrientation.getOrientationAsync()).resolves.toBe(
      ScreenOrientation.Orientation.PORTRAIT_DOWN
    );
    orientation.type = 'something-new';
    await expect(ScreenOrientation.getOrientationAsync()).resolves.toBe(ScreenOrientation.Orientation.UNKNOWN);
  });

  test('lockAsync applies the web lock and records it', async () => {
    const orientation = installOrientation();
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    expect(orientation.lock).toHaveBeenCalledWith('portrait-primary');
    await expect(ScreenOrientation.getOrientationLockAsync()).resolves.toBe(
      ScreenOrientation.OrientationLock.PORTRAIT_UP
    );
    await expect(ScreenOrientation.getPlatformOrientationLockAsync()).resolves.toEqual({
      screenOrientationLockWeb: ScreenOrientation.WebOrientationLock.PORTRAIT_PRIMARY,
    });
    await expect(
      ScreenOrientation.supportsOrientationLockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
    ).resolves.toBe(true);
  });

  test('a refused lock rejects with the fullscreen reason attached', async () => {
    const orientation = installOrientation();
    orientation.lock.mockRejectedValueOnce(
      new DOMException('screen.orientation.lock() is not available on this device.', 'NotSupportedError')
    );
    await expect(ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)).rejects.toThrow(
      /fullscreen/
    );
  });

  test('unlockAsync calls the real unlock and resets the recorded lock', async () => {
    const orientation = installOrientation();
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    await ScreenOrientation.unlockAsync();
    expect(orientation.unlock).toHaveBeenCalledTimes(1);
    await expect(ScreenOrientation.getOrientationLockAsync()).resolves.toBe(
      ScreenOrientation.OrientationLock.DEFAULT
    );
  });

  test('lockPlatformAsync takes the web lock directly', async () => {
    const orientation = installOrientation();
    await ScreenOrientation.lockPlatformAsync({
      screenOrientationLockWeb: ScreenOrientation.WebOrientationLock.LANDSCAPE,
    });
    expect(orientation.lock).toHaveBeenCalledWith('landscape');
    await expect(ScreenOrientation.getOrientationLockAsync()).resolves.toBe(ScreenOrientation.OrientationLock.OTHER);
    await expect(
      ScreenOrientation.lockPlatformAsync({ screenOrientationConstantAndroid: 1 })
    ).rejects.toBeInstanceOf(TypeError);
  });

  test('change listeners fire on orientation change and stop after removal', async () => {
    const orientation = installOrientation('portrait-primary');
    const events: ScreenOrientation.OrientationChangeEvent[] = [];
    const subscription = ScreenOrientation.addOrientationChangeListener((event) => events.push(event));

    orientation.type = 'landscape-secondary';
    orientation.fireChange();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]!.orientationInfo.orientation).toBe(ScreenOrientation.Orientation.LANDSCAPE_RIGHT);

    subscription.remove();
    orientation.fireChange();
    await Promise.resolve();
    expect(events).toHaveLength(1);
  });

  test('removeOrientationChangeListeners unbinds every subscriber', async () => {
    const orientation = installOrientation();
    const events: unknown[] = [];
    ScreenOrientation.addOrientationChangeListener(() => events.push(1));
    ScreenOrientation.addOrientationChangeListener(() => events.push(2));
    ScreenOrientation.removeOrientationChangeListeners();
    orientation.fireChange();
    await Promise.resolve();
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sharing
// ---------------------------------------------------------------------------

describe('sharing compat shim (navigator.share)', () => {
  test('availability tracks the real navigator, and a share reaches it', async () => {
    await expect(Sharing.isAvailableAsync()).resolves.toBe(false); // jsdom has no share
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    try {
      await expect(Sharing.isAvailableAsync()).resolves.toBe(true);
      await Sharing.shareAsync('blob:http://localhost:3000/img', { dialogTitle: 'Look' });
      expect(share).toHaveBeenCalledWith({ url: 'blob:http://localhost:3000/img', title: 'Look' });
    } finally {
      Reflect.deleteProperty(navigator, 'share');
    }
  });
});
