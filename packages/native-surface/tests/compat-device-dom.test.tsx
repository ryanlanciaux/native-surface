// @vitest-environment jsdom
/**
 * Storage + device-API compat pack, DOM half: netinfo's window
 * online/offline eventing and the image-picker's hidden-input flow, driven
 * through the documented test-only __setInputFactory hook so no real file
 * dialog is involved. createImageBitmap is stubbed for dimension probing —
 * jsdom decodes no images.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import NetInfo, { NetInfoStateType, type NetInfoState } from '../../compat/src/netinfo';
import {
  __setInputFactory,
  launchCameraAsync,
  launchImageLibrary,
  launchImageLibraryAsync,
  MediaTypeOptions,
  requestMediaLibraryPermissionsAsync,
} from '../../compat/src/image-picker';

afterEach(() => {
  __setInputFactory(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('netinfo compat shim (window events)', () => {
  test('listeners get the current state on subscribe, event-driven changes, and stop after unsubscribe', async () => {
    const events: NetInfoState[] = [];
    const unsubscribe = NetInfo.addEventListener((state) => events.push(state));
    await Promise.resolve(); // initial state is delivered on a microtask
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe(NetInfoStateType.wifi);

    window.dispatchEvent(new Event('offline'));
    const offline = events.find((s) => s.type === NetInfoStateType.none);
    expect(offline).toBeDefined();
    expect(offline!.isConnected).toBe(false);
    expect(offline!.isInternetReachable).toBe(false);
    expect(offline!.details).toBeNull();

    const count = events.length;
    unsubscribe();
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('offline'));
    expect(events).toHaveLength(count);
  });
});

describe('image-picker compat shim', () => {
  function makeFile(): File {
    return new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' });
  }

  function stubBitmap(width: number, height: number): void {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width, height, close: () => {} }))
    );
  }

  test('expo launchImageLibraryAsync returns the documented asset shape', async () => {
    const input = document.createElement('input');
    __setInputFactory(() => input);
    stubBitmap(320, 240);
    const promise = launchImageLibraryAsync({ mediaTypes: MediaTypeOptions.Images });
    expect(input.accept).toBe('image/*');
    const file = makeFile();
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    const result = await promise;
    expect(result.canceled).toBe(false);
    expect(result.assets).toHaveLength(1);
    const asset = result.assets![0]!;
    expect(asset.uri).toBeTruthy();
    expect(asset.width).toBe(320);
    expect(asset.height).toBe(240);
    expect(asset.fileName).toBe('photo.png');
    expect(asset.mimeType).toBe('image/png');
    expect(asset.fileSize).toBe(4);
    expect(asset.type).toBe('image');
  });

  test('cancel resolves {canceled: true, assets: null}', async () => {
    const input = document.createElement('input');
    __setInputFactory(() => input);
    const promise = launchImageLibraryAsync();
    input.dispatchEvent(new Event('cancel'));
    await expect(promise).resolves.toEqual({ canceled: true, assets: null });
  });

  test('an empty change also counts as cancellation', async () => {
    const input = document.createElement('input');
    __setInputFactory(() => input);
    const promise = launchImageLibraryAsync();
    input.dispatchEvent(new Event('change'));
    await expect(promise).resolves.toEqual({ canceled: true, assets: null });
  });

  test('launchCameraAsync requests camera capture', async () => {
    const input = document.createElement('input');
    __setInputFactory(() => input);
    const promise = launchCameraAsync();
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.accept).toBe('image/*');
    input.dispatchEvent(new Event('cancel'));
    await promise;
  });

  test('react-native-image-picker form resolves and calls the callback', async () => {
    const input = document.createElement('input');
    __setInputFactory(() => input);
    stubBitmap(64, 48);
    const callback = vi.fn();
    const promise = launchImageLibrary({ mediaType: 'photo' }, callback);
    const file = makeFile();
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    const response = await promise;
    expect(response.didCancel).toBeUndefined();
    const asset = response.assets![0]!;
    expect(asset.type).toBe('image/png'); // RNIP's `type` is the mime type
    expect(asset.width).toBe(64);
    expect(callback).toHaveBeenCalledWith(response);
  });

  test('rnip cancel reports didCancel through promise and callback', async () => {
    const input = document.createElement('input');
    __setInputFactory(() => input);
    const callback = vi.fn();
    const promise = launchImageLibrary({}, callback);
    input.dispatchEvent(new Event('cancel'));
    const response = await promise;
    expect(response).toEqual({ didCancel: true });
    expect(callback).toHaveBeenCalledWith(response);
  });

  test('media-library permissions resolve granted (file dialog is the consent step)', async () => {
    await expect(requestMediaLibraryPermissionsAsync()).resolves.toEqual({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
  });
});
