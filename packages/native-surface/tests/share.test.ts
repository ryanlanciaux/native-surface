/**
 * Share contract (RN core's Share, not react-native-share). The load-bearing
 * promise is that NO host-side outcome rejects: apps branch on result.action
 * without a catch, so a browser with no share sheet must resolve, not throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

type ShareModule = typeof import('../src/api/Share');
type ShareData = { title?: string; text?: string; url?: string };

async function loadShare(share: ((data: ShareData) => Promise<void>) | null): Promise<ShareModule> {
  vi.resetModules();
  vi.stubGlobal('navigator', share ? { share } : {});
  return import('../src/api/Share');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Share.share', () => {
  it('resolves sharedAction and maps the content onto the Web Share payload', async () => {
    const calls: ShareData[] = [];
    const { Share } = await loadShare(async (data) => {
      calls.push(data);
    });
    const result = await Share.share({ message: 'look at this', url: 'https://example.com', title: 'Post' });
    expect(result.action).toBe(Share.sharedAction);
    expect(result.activityType).toBeNull();
    expect(calls).toEqual([{ title: 'Post', text: 'look at this', url: 'https://example.com' }]);
  });

  it('resolves dismissedAction (and warns once) when the host has no share sheet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { Share } = await loadShare(null);
    expect((await Share.share({ message: 'hi' })).action).toBe(Share.dismissedAction);
    expect((await Share.share({ message: 'hi again' })).action).toBe('dismissedAction');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('resolves dismissedAction when the user aborts the sheet', async () => {
    const abort = Object.assign(new Error('Share canceled'), { name: 'AbortError' });
    const { Share } = await loadShare(() => Promise.reject(abort));
    const result = await Share.share({ url: 'https://example.com' });
    expect(result.action).toBe(Share.dismissedAction);
    expect(result.activityType).toBeUndefined();
  });

  it('rejects only for a malformed call, exactly as RN does', async () => {
    const { Share } = await loadShare(async () => {});
    await expect(Share.share({} as { message?: string })).rejects.toThrow('At least one of URL and message');
  });

  it('hands back a fresh result each call', async () => {
    const { Share } = await loadShare(async () => {});
    const first = await Share.share({ message: 'a' });
    first.activityType = 'com.example.scribbled';
    const second = await Share.share({ message: 'b' });
    expect(second.activityType).toBeNull();
  });
});
