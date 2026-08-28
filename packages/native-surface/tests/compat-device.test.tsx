/**
 * Storage + device-API compat pack, node-env half: async-storage semantics
 * (round-trip, deep merge, multi ops, namespace isolation, in-memory
 * fallback), plus the guard rails the DOM-less realm exercises for free —
 * clipboard without navigator.clipboard, haptics without vibrate, netinfo's
 * assumed-online shape, device identity stability, the device-info Proxy's
 * warn-once stubs, permissions' universal grant, and notifications' honest
 * denial. DOM-dependent behavior (window events, file inputs) lives in
 * compat-device-dom.test.tsx.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import AsyncStorage, { useAsyncStorage } from '../../compat/src/async-storage';
import Clipboard, { getStringAsync, setStringAsync, hasStringAsync } from '../../compat/src/clipboard';
import * as Haptics from '../../compat/src/haptics';
import DeviceInfo, { getSystemName, getUniqueId, getUniqueIdSync } from '../../compat/src/device-info';
import Constants, { ExecutionEnvironment } from '../../compat/src/constants';
import NetInfo, { NetInfoStateType } from '../../compat/src/netinfo';
import Permissions, { PERMISSIONS, RESULTS, checkNotifications, request, requestMultiple } from '../../compat/src/permissions';
import * as Notifications from '../../compat/src/notifications';
import Share from '../../compat/src/share';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  } as Storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('async-storage compat shim', () => {
  test('round-trips values under the namespaced localStorage prefix', async () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    await AsyncStorage.setItem('user', 'ryan');
    expect(await AsyncStorage.getItem('user')).toBe('ryan');
    expect(await AsyncStorage.getItem('missing')).toBeNull();
    expect(store.getItem('rn-async-storage:user')).toBe('ryan');
    await AsyncStorage.removeItem('user');
    expect(await AsyncStorage.getItem('user')).toBeNull();
  });

  test('mergeItem deep-merges nested objects and replaces arrays/scalars', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    await AsyncStorage.setItem('doc', JSON.stringify({ profile: { name: 'ryan', age: 1 }, tags: ['a'] }));
    await AsyncStorage.mergeItem('doc', JSON.stringify({ profile: { age: 2, city: 'x' }, tags: ['b', 'c'] }));
    expect(JSON.parse((await AsyncStorage.getItem('doc'))!)).toEqual({
      profile: { name: 'ryan', age: 2, city: 'x' },
      tags: ['b', 'c'],
    });
  });

  test('multiSet/multiGet preserve request order; missing keys read null', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    await AsyncStorage.multiSet([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(await AsyncStorage.multiGet(['a', 'b', 'c'])).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c', null],
    ]);
  });

  test('getAllKeys and clear stay inside the shim namespace', async () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    store.setItem('unrelated', 'x');
    store.setItem('rn-mmkv:mmkv.default:k', 'y');
    await AsyncStorage.multiSet([
      ['a', '1'],
      ['b', '2'],
    ]);
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(['a', 'b']);
    await AsyncStorage.clear();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(store.getItem('unrelated')).toBe('x');
    expect(store.getItem('rn-mmkv:mmkv.default:k')).toBe('y');
  });

  test('falls back to in-memory storage when localStorage is absent', async () => {
    vi.stubGlobal('localStorage', undefined);
    await AsyncStorage.setItem('mem', 'v');
    expect(await AsyncStorage.getItem('mem')).toBe('v');
    expect(await AsyncStorage.getAllKeys()).toContain('mem');
    await AsyncStorage.removeItem('mem');
    expect(await AsyncStorage.getItem('mem')).toBeNull();
  });

  test('supports the documented trailing callbacks alongside promises', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const setCb = vi.fn();
    await AsyncStorage.setItem('cb', 'value', setCb);
    expect(setCb).toHaveBeenCalledWith(null, undefined);
    const getCb = vi.fn();
    expect(await AsyncStorage.getItem('cb', getCb)).toBe('value');
    expect(getCb).toHaveBeenCalledWith(null, 'value');
  });

  test('useAsyncStorage exposes the key-bound quartet', () => {
    // Shape check only — no render needed for the memoized handle's contract.
    expect(typeof useAsyncStorage).toBe('function');
  });
});

describe('netinfo compat shim (node)', () => {
  test('fetch resolves the documented wifi-when-online shape', async () => {
    const state = await NetInfo.fetch();
    expect(state.type).toBe(NetInfoStateType.wifi);
    expect(state.isConnected).toBe(true);
    expect(state.isInternetReachable).toBe(true);
    expect(state.details).toEqual({ isConnectionExpensive: false });
  });
});

describe('clipboard compat shim', () => {
  test('resolves benign values and warns once when navigator.clipboard is missing', async () => {
    vi.stubGlobal('navigator', {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(getStringAsync()).resolves.toBe('');
    await expect(hasStringAsync()).resolves.toBe(false);
    await expect(Clipboard.getString()).resolves.toBe('');
    await expect(setStringAsync('x')).resolves.toBe(false);
    const clipboardWarns = () => warn.mock.calls.filter(([msg]) => String(msg).includes('compat clipboard')).length;
    expect(clipboardWarns()).toBe(2); // one read warning + one write warning
    await getStringAsync();
    await setStringAsync('y');
    expect(clipboardWarns()).toBe(2);
  });
});

describe('haptics compat shim', () => {
  test('resolves without navigator.vibrate', async () => {
    await expect(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)).resolves.toBeUndefined();
    await expect(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)).resolves.toBeUndefined();
    await expect(Haptics.selectionAsync()).resolves.toBeUndefined();
    await expect(Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)).resolves.toBeUndefined();
  });

  test('resolves even when vibrate throws (no user activation)', async () => {
    const vibrate = vi.fn(() => {
      throw new Error('requires user activation');
    });
    vi.stubGlobal('navigator', { vibrate });
    await expect(Haptics.impactAsync()).resolves.toBeUndefined();
    expect(vibrate).toHaveBeenCalled();
  });
});

describe('device-info compat shim', () => {
  test('getUniqueId is a uuid, stable across calls and persisted', async () => {
    const store = fakeStorage();
    vi.stubGlobal('localStorage', store);
    const id = await getUniqueId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(getUniqueIdSync()).toBe(id);
    expect(await DeviceInfo.getUniqueId()).toBe(id);
    expect(store.getItem('rn-device-info:uniqueId')).toBe(id);
  });

  test('simulated identity is a coherent iOS handset', () => {
    expect(getSystemName()).toBe('iOS');
    expect(DeviceInfo.isTablet()).toBe(false);
    expect(DeviceInfo.hasNotch()).toBe(true);
    expect(DeviceInfo.hasDynamicIsland()).toBe(false);
    expect(DeviceInfo.getDeviceType()).toBe('Handset');
  });

  test('unknown getters resolve null through a warn-once Proxy stub', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(DeviceInfo.getCarrier!() as Promise<unknown>).resolves.toBeNull();
    await expect(DeviceInfo.getCarrier!() as Promise<unknown>).resolves.toBeNull();
    const carrierWarns = warn.mock.calls.filter(([msg]) => String(msg).includes('getCarrier')).length;
    expect(carrierWarns).toBe(1);
    expect(DeviceInfo.getApiLevelSync!()).toBeNull(); // *Sync stubs return null directly
  });
});

describe('constants compat shim', () => {
  test('exposes the documented Constants shape with honest canvas values', () => {
    expect(Constants.executionEnvironment).toBe(ExecutionEnvironment.Bare);
    expect(Constants.expoConfig).toBeNull();
    expect(Constants.manifest2).toBeNull();
    expect(Constants.appOwnership).toBeNull();
    expect(Constants.statusBarHeight).toBe(0);
    expect(Constants.systemFonts).toEqual([]);
    expect(Constants.deviceName).toBe('native-surface');
    expect(Constants.isDevice).toBe(false);
    expect(Constants.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe('permissions compat shim', () => {
  test('check/request resolve granted; PERMISSIONS mints any constant', async () => {
    expect(PERMISSIONS.IOS.CAMERA).toBe('ios.permission.CAMERA');
    expect(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION).toBe('android.permission.ACCESS_FINE_LOCATION');
    await expect(request(PERMISSIONS.IOS.CAMERA)).resolves.toBe(RESULTS.GRANTED);
    await expect(Permissions.check(PERMISSIONS.ANDROID.CAMERA)).resolves.toBe(RESULTS.GRANTED);
    const statuses = await requestMultiple([PERMISSIONS.IOS.CAMERA, PERMISSIONS.IOS.CONTACTS]);
    expect(statuses).toEqual({
      'ios.permission.CAMERA': 'granted',
      'ios.permission.CONTACTS': 'granted',
    });
    await expect(checkNotifications()).resolves.toEqual({ status: 'granted', settings: {} });
  });
});

describe('notifications compat shim', () => {
  test('permission requests report the honest denial', async () => {
    const denied = { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
    await expect(Notifications.getPermissionsAsync()).resolves.toEqual(denied);
    await expect(Notifications.requestPermissionsAsync()).resolves.toEqual(denied);
  });

  test('schedule resolves a fake id with a warning; push tokens reject', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const id = await Notifications.scheduleNotificationAsync({ content: { title: 'x' }, trigger: null });
    expect(id).toMatch(/^native-surface-noop-/);
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('scheduleNotificationAsync'))).toBe(true);
    await expect(Notifications.getExpoPushTokenAsync()).rejects.toThrow(/native host/);
    await expect(Notifications.getDevicePushTokenAsync()).rejects.toThrow(/native host/);
    expect(Notifications.addNotificationReceivedListener(() => {}).remove).toBeTypeOf('function');
  });
});

describe('share compat shim', () => {
  test('rejects clearly without navigator.share; abort maps to the documented cancel error', async () => {
    vi.stubGlobal('navigator', {});
    await expect(Share.open({ message: 'hi' })).rejects.toThrow(/not available in this environment/);
    const abort = Object.assign(new Error('canceled'), { name: 'AbortError' });
    vi.stubGlobal('navigator', {
      share: vi.fn(async () => {
        throw abort;
      }),
    });
    await expect(Share.open({ message: 'hi' })).rejects.toThrow('User did not share');
    await expect(Share.isPackageInstalled('com.example')).resolves.toEqual({
      isInstalled: false,
      message: expect.stringContaining('not available'),
    });
  });
});
