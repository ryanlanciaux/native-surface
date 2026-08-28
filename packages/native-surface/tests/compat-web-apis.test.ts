/**
 * Expo browser-API compat pack, node-env half: the seven shims that map onto
 * real browser APIs (web-browser, sharing, location, device, keep-awake,
 * screen-orientation, updates). This half proves the property the whole pack
 * depends on — every module IMPORTS with no DOM present and every entry point
 * degrades instead of throwing — plus the pure logic that needs no document:
 * the geolocation -> LocationObject mapping, the user-agent matrix behind
 * expo-device's constants, and the exact types expo-updates' consumers parse.
 * DOM-dependent behavior (popups, wake locks, screen.orientation) lives in
 * compat-web-apis-dom.test.ts.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as WebBrowser from '../../compat/src/web-browser';
import * as Sharing from '../../compat/src/sharing';
import * as Location from '../../compat/src/location';
import * as Device from '../../compat/src/device';
import * as KeepAwake from '../../compat/src/keep-awake';
import * as ScreenOrientation from '../../compat/src/screen-orientation';
import * as Updates from '../../compat/src/updates';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  KeepAwake.__resetKeepAwake();
});

/** GeolocationPosition is a host object; tests hand the shim a plain stand-in. */
function fakePosition(overrides: Partial<GeolocationCoordinates> = {}, timestamp = 1_700_000_000_000): GeolocationPosition {
  return {
    coords: {
      latitude: 37.7749,
      longitude: -122.4194,
      altitude: null,
      accuracy: 12.5,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...overrides,
    },
    timestamp,
  } as GeolocationPosition;
}

function fakePositionError(code: 1 | 2 | 3, message = 'nope'): GeolocationPositionError {
  return { code, message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;
}

describe('the pack is import-safe without a DOM', () => {
  test('no window/document/localStorage in this realm', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
  });

  test('each module exposes its documented named exports and a namespace default', () => {
    for (const [name, mod, entry] of [
      ['expo-web-browser', WebBrowser, 'openBrowserAsync'],
      ['expo-sharing', Sharing, 'shareAsync'],
      ['expo-location', Location, 'getCurrentPositionAsync'],
      ['expo-device', Device, 'getDeviceTypeAsync'],
      ['expo-keep-awake', KeepAwake, 'activateKeepAwakeAsync'],
      ['expo-screen-orientation', ScreenOrientation, 'getOrientationAsync'],
      ['expo-updates', Updates, 'checkForUpdateAsync'],
    ] as const) {
      expect(typeof (mod as Record<string, unknown>)[entry], name).toBe('function');
      expect(typeof mod.default, name).toBe('object');
    }
  });
});

describe('web-browser compat shim (no window)', () => {
  test('open calls resolve cancel instead of throwing, and warn once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(WebBrowser.openBrowserAsync('https://example.com')).resolves.toEqual({ type: 'cancel' });
    await expect(WebBrowser.openAuthSessionAsync('https://example.com/auth')).resolves.toEqual({ type: 'cancel' });
    const before = warn.mock.calls.length;
    await WebBrowser.openBrowserAsync('https://example.com');
    await WebBrowser.openAuthSessionAsync('https://example.com/auth');
    expect(warn.mock.calls.length).toBe(before);
  });

  test('maybeCompleteAuthSession reports the documented non-browser failure', () => {
    expect(WebBrowser.maybeCompleteAuthSession()).toEqual({
      type: 'failed',
      message: 'Cannot use expo-web-browser in a non-browser environment',
    });
  });

  test('dismiss calls are inert; Custom Tabs service calls resolve empty results', async () => {
    expect(() => WebBrowser.dismissAuthSession()).not.toThrow();
    await expect(WebBrowser.dismissBrowser()).resolves.toEqual({ type: 'dismiss' });
    await expect(WebBrowser.warmUpAsync()).resolves.toEqual({});
    await expect(WebBrowser.coolDownAsync()).resolves.toEqual({});
    await expect(WebBrowser.mayInitWithUrlAsync('https://example.com')).resolves.toEqual({});
    await expect(WebBrowser.getCustomTabsSupportingBrowsersAsync()).resolves.toEqual({
      browserPackages: [],
      servicePackages: [],
    });
  });

  test('result-type and presentation-style enums carry the real values', () => {
    expect(WebBrowser.WebBrowserResultType.CANCEL).toBe('cancel');
    expect(WebBrowser.WebBrowserResultType.DISMISS).toBe('dismiss');
    expect(WebBrowser.WebBrowserResultType.OPENED).toBe('opened');
    expect(WebBrowser.WebBrowserResultType.LOCKED).toBe('locked');
    expect(WebBrowser.WebBrowserPresentationStyle.OVER_FULL_SCREEN).toBe('overFullScreen');
    expect(WebBrowser.WebBrowserPresentationStyle.AUTOMATIC).toBe('automatic');
  });
});

describe('sharing compat shim', () => {
  test('isAvailableAsync is false when navigator.share is absent, and shareAsync says why', async () => {
    await expect(Sharing.isAvailableAsync()).resolves.toBe(false);
    await expect(Sharing.shareAsync('https://example.com/x.png')).rejects.toThrow(/navigator\.share is not available/);
  });

  test('shareAsync maps url + dialogTitle onto the Web Share payload', async () => {
    const share = vi.fn(async () => {});
    vi.stubGlobal('navigator', { share });
    await expect(Sharing.isAvailableAsync()).resolves.toBe(true);
    await Sharing.shareAsync('blob:https://app/1', { dialogTitle: 'Share QR code', mimeType: 'image/png' });
    expect(share).toHaveBeenCalledWith({ url: 'blob:https://app/1', title: 'Share QR code' });
  });

  test('a rejected share (cancel / no gesture) propagates unchanged', async () => {
    const abort = Object.assign(new Error('Share canceled'), { name: 'AbortError' });
    vi.stubGlobal('navigator', {
      share: vi.fn(async () => {
        throw abort;
      }),
    });
    await expect(Sharing.shareAsync('https://example.com')).rejects.toBe(abort);
  });

  test('nothing is ever shared INTO the host', async () => {
    expect(Sharing.getSharedPayloads()).toEqual([]);
    await expect(Sharing.getResolvedSharedPayloadsAsync()).resolves.toEqual([]);
    expect(() => Sharing.clearSharedPayloads()).not.toThrow();
    expect(typeof Sharing.useIncomingShare).toBe('function');
  });
});

describe('location compat shim', () => {
  function stubGeolocation(geolocation: Partial<Geolocation>): void {
    vi.stubGlobal('navigator', { geolocation });
  }

  test('a browser position maps onto LocationObject field for field', async () => {
    const position = fakePosition({ altitude: 30, altitudeAccuracy: 5, heading: 180, speed: 1.5 }, 1_700_000_123_456);
    stubGeolocation({
      getCurrentPosition: (success) => success(position),
    });
    await expect(Location.getCurrentPositionAsync()).resolves.toEqual({
      coords: {
        latitude: 37.7749,
        longitude: -122.4194,
        altitude: 30,
        accuracy: 12.5,
        altitudeAccuracy: 5,
        heading: 180,
        speed: 1.5,
      },
      timestamp: 1_700_000_123_456,
    });
  });

  test('unknown coordinate fields stay null rather than becoming 0', async () => {
    stubGeolocation({ getCurrentPosition: (success) => success(fakePosition()) });
    const location = await Location.getCurrentPositionAsync();
    expect(location.coords.altitude).toBeNull();
    expect(location.coords.altitudeAccuracy).toBeNull();
    expect(location.coords.heading).toBeNull();
    expect(location.coords.speed).toBeNull();
  });

  test('accuracy above Balanced asks the browser for a high-accuracy fix', async () => {
    const getCurrentPosition = vi.fn(
      (success: PositionCallback, _error?: PositionErrorCallback | null, _options?: PositionOptions) =>
        success(fakePosition())
    );
    stubGeolocation({ getCurrentPosition });
    await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    expect(getCurrentPosition.mock.calls[0]![2]).toMatchObject({ enableHighAccuracy: true });
    await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    expect(getCurrentPosition.mock.calls[1]![2]).toMatchObject({ enableHighAccuracy: false });
  });

  test('getLastKnownPositionAsync honors maxAge and requiredAccuracy', async () => {
    const stale = fakePosition({ accuracy: 500 }, Date.now() - 60_000);
    stubGeolocation({ getCurrentPosition: (success) => success(stale) });
    await Location.getCurrentPositionAsync();
    await expect(Location.getLastKnownPositionAsync()).resolves.not.toBeNull();
    await expect(Location.getLastKnownPositionAsync({ maxAge: 1_000 })).resolves.toBeNull();
    await expect(Location.getLastKnownPositionAsync({ requiredAccuracy: 10 })).resolves.toBeNull();
  });

  test('watchPositionAsync delivers mapped positions and remove() clears the watch', async () => {
    const clearWatch = vi.fn();
    let emit: PositionCallback | null = null;
    stubGeolocation({
      watchPosition: (success) => {
        emit = success;
        return 42;
      },
      clearWatch,
    });
    const received: Location.LocationObject[] = [];
    const subscription = await Location.watchPositionAsync({}, (location) => received.push(location));
    expect(Location._getCurrentWatchId()).toBe(42);
    emit!(fakePosition({}, 1_700_000_000_001));
    expect(received).toHaveLength(1);
    expect(received[0]!.timestamp).toBe(1_700_000_000_001);
    subscription.remove();
    subscription.remove(); // idempotent
    expect(clearWatch).toHaveBeenCalledTimes(1);
    expect(clearWatch).toHaveBeenCalledWith(42);
  });

  test('position errors surface as coded errors', async () => {
    stubGeolocation({ getCurrentPosition: (_s, error) => error?.(fakePositionError(1, 'User denied')) });
    await expect(Location.getCurrentPositionAsync()).rejects.toMatchObject({
      code: 'E_LOCATION_UNAUTHORIZED',
      message: 'User denied',
    });
  });

  test('without navigator.geolocation everything degrades rather than throwing', async () => {
    vi.stubGlobal('navigator', {});
    await expect(Location.hasServicesEnabledAsync()).resolves.toBe(false);
    await expect(Location.getProviderStatusAsync()).resolves.toMatchObject({
      locationServicesEnabled: false,
      backgroundModeEnabled: false,
    });
    await expect(Location.getCurrentPositionAsync()).rejects.toMatchObject({ code: 'E_LOCATION_UNAVAILABLE' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const subscription = await Location.watchPositionAsync({}, () => {});
    expect(() => subscription.remove()).not.toThrow();
  });

  test('geocoding rejects with the upstream code instead of returning an empty list', async () => {
    await expect(Location.geocodeAsync('1 Infinite Loop')).rejects.toMatchObject({ code: 'E_NO_GEOCODER' });
    await expect(Location.reverseGeocodeAsync({ latitude: 0, longitude: 0 })).rejects.toMatchObject({
      code: 'E_NO_GEOCODER',
    });
  });

  test('foreground permission reads the Permissions API when there is one', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {},
      permissions: { query: vi.fn(async () => ({ state: 'granted' })) },
    });
    await expect(Location.getForegroundPermissionsAsync()).resolves.toEqual({
      status: 'granted',
      granted: true,
      canAskAgain: true,
      expires: 'never',
    });
    vi.stubGlobal('navigator', {
      geolocation: {},
      permissions: { query: vi.fn(async () => ({ state: 'denied' })) },
    });
    await expect(Location.getForegroundPermissionsAsync()).resolves.toMatchObject({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    });
  });

  test('no Permissions API is undetermined, and the request falls back to the position prompt', async () => {
    stubGeolocation({ getCurrentPosition: (success) => success(fakePosition()) });
    await expect(Location.getForegroundPermissionsAsync()).resolves.toMatchObject({
      status: 'undetermined',
      granted: false,
      canAskAgain: true,
    });
    await expect(Location.requestForegroundPermissionsAsync()).resolves.toMatchObject({ status: 'granted' });

    stubGeolocation({ getCurrentPosition: (_s, error) => error?.(fakePositionError(1)) });
    await expect(Location.requestForegroundPermissionsAsync()).resolves.toMatchObject({
      status: 'denied',
      canAskAgain: false,
    });
  });

  test('background location and geofencing report their honest ceiling', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(Location.getBackgroundPermissionsAsync()).resolves.toMatchObject({
      status: 'denied',
      granted: false,
      canAskAgain: false,
    });
    await expect(Location.requestBackgroundPermissionsAsync()).resolves.toMatchObject({ granted: false });
    await expect(Location.isBackgroundLocationAvailableAsync()).resolves.toBe(false);
    await expect(Location.startLocationUpdatesAsync('task')).rejects.toMatchObject({
      code: 'E_BACKGROUND_LOCATION_UNAVAILABLE',
    });
    await expect(Location.startGeofencingAsync('task', [])).rejects.toMatchObject({
      code: 'E_BACKGROUND_LOCATION_UNAVAILABLE',
    });
    await expect(Location.stopLocationUpdatesAsync('task')).resolves.toBeUndefined();
    await expect(Location.hasStartedGeofencingAsync('task')).resolves.toBe(false);
  });

  test('heading and motion activity throw, their watchers stay inert', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(Location.getHeadingAsync()).rejects.toThrow(/compass/);
    await expect(Location.getMotionActivityAsync()).rejects.toThrow(/motion-activity/);
    expect((await Location.watchHeadingAsync(() => {})).remove).toBeTypeOf('function');
    expect((await Location.watchMotionActivityAsync(() => {})).remove).toBeTypeOf('function');
  });

  test('enums and their short aliases carry the real values', () => {
    expect(Location.Accuracy).toBe(Location.LocationAccuracy);
    expect(Location.Accuracy.Balanced).toBe(3);
    expect(Location.Accuracy.BestForNavigation).toBe(6);
    expect(Location.GeofencingEventType.Enter).toBe(1);
    expect(Location.GeofencingRegionState.Outside).toBe(2);
    expect(Location.ActivityType.Fitness).toBe(3);
    expect(Location.MotionActivityType.Walking).toBe('walking');
    expect(Location.PermissionStatus.GRANTED).toBe('granted');
    expect(typeof Location.useForegroundPermissions).toBe('function');
    expect(() => Location.installWebGeolocationPolyfill()).not.toThrow();
  });
});

describe('device compat shim', () => {
  async function deviceFor(userAgent: string | null, extras: Record<string, unknown> = {}) {
    vi.resetModules();
    if (userAgent === null) vi.stubGlobal('navigator', undefined);
    else vi.stubGlobal('navigator', { userAgent, ...extras });
    return import('../../compat/src/device');
  }

  test('an iPhone user agent resolves a coherent phone identity', async () => {
    const D = await deviceFor(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
    );
    expect(D.osName).toBe('iOS');
    expect(D.osVersion).toBe('17.4.1');
    expect(D.modelName).toBe('iPhone');
    expect(D.manufacturer).toBe('Apple');
    expect(D.deviceType).toBe(D.DeviceType.PHONE);
    await expect(D.getDeviceTypeAsync()).resolves.toBe(D.DeviceType.PHONE);
  });

  test('iPadOS masquerading as a Mac is separated by touch points', async () => {
    const macUa =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
    const ipad = await deviceFor(macUa, { maxTouchPoints: 5 });
    expect(ipad.osName).toBe('iPadOS');
    expect(ipad.modelName).toBe('iPad');
    expect(ipad.deviceType).toBe(ipad.DeviceType.TABLET);

    const mac = await deviceFor(macUa, { maxTouchPoints: 0 });
    expect(mac.osName).toBe('macOS');
    expect(mac.osVersion).toBe('10.15.7');
    expect(mac.modelName).toBe('Mac');
    expect(mac.deviceType).toBe(mac.DeviceType.DESKTOP);
  });

  test('an Android user agent yields model, manufacturer and form factor', async () => {
    const D = await deviceFor(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ2A.230505.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Mobile Safari/537.36',
      { deviceMemory: 8 }
    );
    expect(D.osName).toBe('Android');
    expect(D.osVersion).toBe('13');
    expect(D.modelName).toBe('Pixel 7');
    expect(D.manufacturer).toBe('Google');
    expect(D.deviceType).toBe(D.DeviceType.PHONE);
    expect(D.totalMemory).toBe(8 * 1024 ** 3);
  });

  test('an Android tablet (no "Mobile" token) reads as a tablet', async () => {
    const D = await deviceFor(
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    expect(D.deviceType).toBe(D.DeviceType.TABLET);
    expect(D.manufacturer).toBe('Samsung');
  });

  test('a Windows desktop reports x86_64 and DESKTOP', async () => {
    const D = await deviceFor(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    expect(D.osName).toBe('Windows');
    expect(D.osVersion).toBe('10.0');
    expect(D.deviceType).toBe(D.DeviceType.DESKTOP);
    expect(D.supportedCpuArchitectures).toEqual(['x86_64']);
  });

  test('with no navigator at all every derived constant is null and the type is UNKNOWN', async () => {
    const D = await deviceFor(null);
    expect(D.osName).toBeNull();
    expect(D.osVersion).toBeNull();
    expect(D.modelName).toBeNull();
    expect(D.manufacturer).toBeNull();
    expect(D.totalMemory).toBeNull();
    expect(D.supportedCpuArchitectures).toBeNull();
    expect(D.deviceType).toBe(D.DeviceType.UNKNOWN);
  });

  test('fields with no browser source are null, and the async getters answer honestly', async () => {
    expect(Device.isDevice).toBe(true);
    for (const value of [
      Device.brand,
      Device.modelId,
      Device.designName,
      Device.productName,
      Device.deviceYearClass,
      Device.osBuildId,
      Device.osInternalBuildId,
      Device.osBuildFingerprint,
      Device.platformApiLevel,
      Device.deviceName,
    ]) {
      expect(value).toBeNull();
    }
    await expect(Device.isRootedExperimentalAsync()).resolves.toBe(false);
    await expect(Device.isSideLoadingEnabledAsync()).resolves.toBe(false);
    await expect(Device.getPlatformFeaturesAsync()).resolves.toEqual([]);
    await expect(Device.hasPlatformFeatureAsync('android.hardware.camera')).resolves.toBe(false);
    await expect(Device.getMaxMemoryAsync()).resolves.toBe(Number.MAX_SAFE_INTEGER);
    await expect(Device.getUptimeAsync()).resolves.toBeGreaterThanOrEqual(0);
    expect(Device.DeviceType.TV).toBe(4);
  });
});

describe('keep-awake compat shim (no wake lock)', () => {
  test('isAvailableAsync is false and the activate/deactivate pair stays quiet', async () => {
    await expect(KeepAwake.isAvailableAsync()).resolves.toBe(false);
    await expect(KeepAwake.activateKeepAwakeAsync('tag')).resolves.toBeUndefined();
    await expect(KeepAwake.deactivateKeepAwake('tag')).resolves.toBeUndefined();
    // Deactivating an unknown tag must not reject when there was never a lock
    // to take — a hook unmount would turn that into an unhandled rejection.
    await expect(KeepAwake.deactivateKeepAwake('never-activated')).resolves.toBeUndefined();
  });

  test('the default tag and listener subscription match the documented shapes', () => {
    expect(KeepAwake.ExpoKeepAwakeTag).toBe('ExpoKeepAwakeDefaultTag');
    expect(KeepAwake.KeepAwakeEventState.RELEASE).toBe('release');
    const subscription = KeepAwake.addListener(() => {});
    expect(subscription.remove).toBeTypeOf('function');
    expect(() => subscription.remove()).not.toThrow();
    expect(typeof KeepAwake.useKeepAwake).toBe('function');
  });
});

describe('screen-orientation compat shim (no screen)', () => {
  test('reads report UNKNOWN and lock rejects with a reason', async () => {
    await expect(ScreenOrientation.getOrientationAsync()).resolves.toBe(ScreenOrientation.Orientation.UNKNOWN);
    await expect(ScreenOrientation.getOrientationLockAsync()).resolves.toBe(ScreenOrientation.OrientationLock.UNKNOWN);
    await expect(ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)).rejects.toThrow(
      /doesn't support locking screen orientation/
    );
    await expect(ScreenOrientation.supportsOrientationLockAsync(ScreenOrientation.OrientationLock.PORTRAIT)).resolves.toBe(
      false
    );
  });

  test('an invalid lock is a TypeError, as upstream', async () => {
    await expect(ScreenOrientation.lockAsync(99 as ScreenOrientation.OrientationLock)).rejects.toBeInstanceOf(TypeError);
    await expect(
      ScreenOrientation.supportsOrientationLockAsync(99 as ScreenOrientation.OrientationLock)
    ).rejects.toBeInstanceOf(TypeError);
    expect(() => ScreenOrientation.addOrientationChangeListener(null as never)).toThrow(TypeError);
  });

  test('unlockAsync resolves (nothing is locked) and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(ScreenOrientation.unlockAsync()).resolves.toBeUndefined();
    const after = warn.mock.calls.length;
    await ScreenOrientation.unlockAsync();
    expect(warn.mock.calls.length).toBe(after);
    await expect(ScreenOrientation.getOrientationLockAsync()).resolves.toBe(ScreenOrientation.OrientationLock.DEFAULT);
    await expect(ScreenOrientation.getPlatformOrientationLockAsync()).resolves.toEqual({
      screenOrientationLockWeb: ScreenOrientation.WebOrientationLock.NATURAL,
    });
  });

  test('listeners can be added and removed with no screen present', () => {
    const subscription = ScreenOrientation.addOrientationChangeListener(() => {});
    expect(subscription.remove).toBeTypeOf('function');
    ScreenOrientation.removeOrientationChangeListener(subscription);
    expect(() => ScreenOrientation.removeOrientationChangeListeners()).not.toThrow();
  });

  test('enums carry the real values', () => {
    expect(ScreenOrientation.Orientation.PORTRAIT_UP).toBe(1);
    expect(ScreenOrientation.Orientation.LANDSCAPE_RIGHT).toBe(4);
    expect(ScreenOrientation.OrientationLock.LANDSCAPE).toBe(5);
    expect(ScreenOrientation.OrientationLock.UNKNOWN).toBe(9);
    expect(ScreenOrientation.SizeClassIOS.REGULAR).toBe(2);
    expect(ScreenOrientation.WebOrientationLock.NATURAL).toBe('natural');
    expect(ScreenOrientation.WebOrientation.LANDSCAPE_PRIMARY).toBe('landscape-primary');
  });
});

describe('updates compat shim', () => {
  test('constants have exactly the types the real module\'s consumers parse', () => {
    expect(Updates.isEnabled).toBe(false);
    expect(Updates.isEmbeddedLaunch).toBe(true);
    expect(Updates.isUsingEmbeddedAssets).toBe(true);
    expect(Updates.isEmergencyLaunch).toBe(false);
    expect(Updates.emergencyLaunchReason).toBeNull();
    expect(Updates.launchDuration).toBeNull();
    expect(Updates.channel).toBeNull();
    expect(Updates.runtimeVersion).toBeNull();
    expect(Updates.updateId).toBeNull();
    expect(Updates.createdAt).toBeNull();
    expect(Updates.checkAutomatically).toBeNull();
    expect(Updates.localAssets).toEqual({});

    // manifest is the landmine: the real module assigns
    // JSON.parse(manifestString) at module scope, so anything but a plain
    // object here is fatal at import for its consumers.
    expect(typeof Updates.manifest).toBe('object');
    expect(Updates.manifest).not.toBeNull();
    expect(Array.isArray(Updates.manifest)).toBe(false);
    expect(Updates.manifest).toEqual({});
    expect(JSON.parse(JSON.stringify(Updates.manifest))).toEqual({});
    expect('manifestString' in Updates).toBe(false);
  });

  test('check and fetch report no update, with the documented result shapes', async () => {
    await expect(Updates.checkForUpdateAsync()).resolves.toEqual({
      isAvailable: false,
      manifest: undefined,
      isRollBackToEmbedded: false,
      reason: Updates.UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER,
    });
    await expect(Updates.fetchUpdateAsync()).resolves.toEqual({
      isNew: false,
      manifest: undefined,
      isRollBackToEmbedded: false,
    });
  });

  test('reloadAsync is a no-op without a document', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(Updates.reloadAsync()).resolves.toBeUndefined();
    expect(warn.mock.calls.some(([msg]) => String(msg).includes('compat updates'))).toBe(true);
  });

  test('extra params round-trip and null deletes; logs are empty', async () => {
    await Updates.setExtraParamAsync('build', '42');
    await expect(Updates.getExtraParamsAsync()).resolves.toEqual({ build: '42' });
    await Updates.setExtraParamAsync('build', null);
    await expect(Updates.getExtraParamsAsync()).resolves.toEqual({});
    await expect(Updates.readLogEntriesAsync()).resolves.toEqual([]);
    await expect(Updates.clearLogEntriesAsync()).resolves.toBeUndefined();
  });

  test('the state-change emitter feeds latestContext and its listeners', () => {
    const events: Updates.UpdatesNativeStateChangeEvent[] = [];
    const subscription = Updates.addUpdatesStateChangeListener((event) => events.push(event));
    const context = { ...Updates.latestContext, isChecking: true, sequenceNumber: 1 };
    Updates.emitTestStateChangeEvent({ context });
    expect(events).toHaveLength(1);
    expect(Updates.latestContext.isChecking).toBe(true);
    subscription.remove();
    Updates.emitTestStateChangeEvent({ context: { ...context, isChecking: false } });
    expect(events).toHaveLength(1);
    Updates.resetLatestContext();
    expect(Updates.latestContext.isChecking).toBe(false);
  });

  test('useUpdates and the enums are exported the way consumers import them', () => {
    expect(typeof Updates.useUpdates).toBe('function');
    expect(Updates.currentlyRunning.isEmbeddedLaunch).toBe(true);
    expect(Updates.currentlyRunning.manifest).toEqual({});
    expect(Updates.UpdatesLogEntryLevel.ERROR).toBe('error');
    expect(Updates.UpdatesLogEntryCode.NO_UPDATES_AVAILABLE).toBe('NoUpdatesAvailable');
    expect(Updates.UpdatesCheckAutomaticallyValue.ON_LOAD).toBe('ON_LOAD');
    expect(Updates.UpdateInfoType.ROLLBACK).toBe('rollback');
    // Legacy: removed upstream in SDK 51, kept so older imports still link.
    expect(Updates.UpdateEventType.UPDATE_AVAILABLE).toBe('updateAvailable');
  });
});
