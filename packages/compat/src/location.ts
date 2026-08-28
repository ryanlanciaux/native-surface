/**
 * expo-location compat shim — navigator.geolocation-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — position getters/watchers, the foreground/background/
 * motion-activity permission trios and their hooks, geocoding, the
 * background task + geofencing entry points, and the LocationAccuracy /
 * ActivityType / Geofencing / MotionActivity enums (plus the Accuracy,
 * ActivityType, GeofencingEventType, GeofencingRegionState aliases the
 * package's index re-exports under shorter names).
 *
 * The Geolocation API is a genuine backend: a browser position maps onto
 * Expo's LocationObject field for field (latitude, longitude, altitude,
 * accuracy, altitudeAccuracy, heading, speed + timestamp), and every value
 * the browser leaves unknown stays null exactly as it arrives. Accuracy maps
 * onto the one knob the browser exposes: enableHighAccuracy is set for
 * accuracies above Balanced.
 *
 * Honest ceilings:
 * - **No geocoding.** There is no browser API that turns an address into
 *   coordinates or back. geocodeAsync/reverseGeocodeAsync REJECT with the
 *   upstream code (E_NO_GEOCODER) rather than resolving [] — an empty list
 *   reads as "this address does not exist", which is a different and wrong
 *   answer. Apps that need it must call a geocoding service themselves.
 * - **Foreground only.** A page does not run in the background, so
 *   getBackgroundPermissionsAsync/requestBackgroundPermissionsAsync report
 *   DENIED with canAskAgain false, and startLocationUpdatesAsync /
 *   startGeofencingAsync throw. Reporting a background grant we cannot honor
 *   would leave apps waiting forever for updates that never arrive.
 * - **No compass and no motion activity.** getHeadingAsync and
 *   getMotionActivityAsync throw; the watchers warn once and return an inert
 *   subscription. (DeviceOrientation could approximate a heading, but it
 *   needs its own iOS permission prompt and reports a device attitude, not a
 *   course.)
 * - **Cadence is the browser's.** timeInterval / distanceInterval /
 *   mayShowUserSettingsDialog have no counterpart; watchPositionAsync
 *   delivers whatever the browser emits.
 * - **Permission state is coarse.** Without navigator.permissions.query
 *   (Safari, until recently) a get() cannot know the state, so it reports
 *   UNDETERMINED and only a request() — which fires the real browser prompt
 *   through getCurrentPosition — resolves it. Unlike upstream, a missing
 *   Permissions API degrades instead of throwing UnavailabilityError.
 */
import * as React from 'react';

import { EventEmitter as CoreEventEmitter, PermissionStatus, type PermissionResponse } from './expo-modules-core';

export { PermissionStatus, type PermissionResponse };

export type PermissionExpiration = 'never' | number;
/** Mirrors expo-modules-core's hook options: get on mount, or request on mount. */
export type PermissionHookOptions<TOptions extends object = object> = TOptions & {
  get?: boolean;
  request?: boolean;
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum LocationAccuracy {
  Lowest = 1,
  Low = 2,
  Balanced = 3,
  High = 4,
  Highest = 5,
  BestForNavigation = 6,
}

export enum LocationActivityType {
  Other = 1,
  AutomotiveNavigation = 2,
  Fitness = 3,
  OtherNavigation = 4,
  Airborne = 5,
}

export enum LocationGeofencingEventType {
  Enter = 1,
  Exit = 2,
}

export enum LocationGeofencingRegionState {
  Unknown = 0,
  Inside = 1,
  Outside = 2,
}

export enum MotionActivityConfidence {
  Low = 0,
  Medium = 1,
  High = 2,
}

export enum MotionActivityType {
  Automotive = 'automotive',
  Cycling = 'cycling',
  Running = 'running',
  Walking = 'walking',
  Stationary = 'stationary',
  Unknown = 'unknown',
}

/** The index re-exports the enums under these shorter names too. */
export {
  LocationAccuracy as Accuracy,
  LocationActivityType as ActivityType,
  LocationGeofencingEventType as GeofencingEventType,
  LocationGeofencingRegionState as GeofencingRegionState,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocationOptions = {
  accuracy?: LocationAccuracy;
  mayShowUserSettingsDialog?: boolean;
  timeInterval?: number;
  distanceInterval?: number;
};

export type LocationLastKnownOptions = {
  maxAge?: number;
  requiredAccuracy?: number;
};

export type LocationTaskServiceOptions = {
  notificationTitle: string;
  notificationBody: string;
  notificationColor?: string;
  killServiceOnDestroy?: boolean;
};

export type LocationTaskOptions = LocationOptions & {
  showsBackgroundLocationIndicator?: boolean;
  deferredUpdatesDistance?: number;
  deferredUpdatesTimeout?: number;
  deferredUpdatesInterval?: number;
  activityType?: LocationActivityType;
  pausesUpdatesAutomatically?: boolean;
  foregroundService?: LocationTaskServiceOptions;
};

export type LocationRegion = {
  identifier?: string;
  latitude: number;
  longitude: number;
  radius: number;
  notifyOnEnter?: boolean;
  notifyOnExit?: boolean;
  state?: LocationGeofencingRegionState;
};

export type LocationObjectCoords = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
};

export type LocationObject = {
  coords: LocationObjectCoords;
  timestamp: number;
  mocked?: boolean;
};

export type LocationCallback = (location: LocationObject) => unknown;
export type LocationErrorCallback = (reason: string) => void;

export type LocationProviderStatus = {
  locationServicesEnabled: boolean;
  backgroundModeEnabled: boolean;
  gpsAvailable?: boolean;
  networkAvailable?: boolean;
  passiveAvailable?: boolean;
};

export type LocationHeadingObject = {
  trueHeading: number;
  magHeading: number;
  accuracy: number;
};

export type LocationHeadingCallback = (location: LocationHeadingObject) => unknown;

export type LocationGeocodedLocation = {
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
};

export type LocationGeocodedAddress = {
  city: string | null;
  district: string | null;
  streetNumber: string | null;
  street: string | null;
  region: string | null;
  subregion: string | null;
  country: string | null;
  postalCode: string | null;
  name: string | null;
  isoCountryCode: string | null;
  timezone: string | null;
  formattedAddress: string | null;
};

export type LocationSubscription = { remove: () => void };

export type PermissionDetailsLocationIOS = {
  scope: 'whenInUse' | 'always' | 'none';
  accuracy: 'full' | 'reduced';
};

export type PermissionDetailsLocationAndroid = {
  accuracy: 'fine' | 'coarse' | 'none';
};

export type LocationPermissionResponse = PermissionResponse & {
  ios?: PermissionDetailsLocationIOS;
  android?: PermissionDetailsLocationAndroid;
};

export type MotionActivityState = {
  detected: boolean;
  confidence: MotionActivityConfidence;
};

export type MotionActivityObject = {
  activities: Record<MotionActivityType, MotionActivityState>;
  timestamp: number;
};

export type MotionActivityCallback = (activity: MotionActivityObject) => unknown;

// ---------------------------------------------------------------------------
// Backend access
// ---------------------------------------------------------------------------

/** Carries the browser's numeric PositionError code so callers can branch. */
class LocationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'LocationError';
  }
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function geolocation(): Geolocation | null {
  if (typeof navigator === 'undefined') return null;
  return navigator.geolocation ?? null;
}

function positionOptions(options: LocationOptions = {}): PositionOptions {
  return {
    // Upstream's default: a cached fix is acceptable for a one-shot read.
    maximumAge: Infinity,
    enableHighAccuracy: (options.accuracy ?? LocationAccuracy.Balanced) > LocationAccuracy.Balanced,
  };
}

/** The one mapping this shim exists for. Unknown fields stay null, as they arrive. */
function toLocationObject(position: GeolocationPosition): LocationObject {
  const { coords, timestamp } = position;
  return {
    coords: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      altitude: coords.altitude,
      accuracy: coords.accuracy,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
    },
    timestamp,
  };
}

function toLocationError(error: GeolocationPositionError): LocationError {
  const code =
    error.code === error.PERMISSION_DENIED
      ? 'E_LOCATION_UNAUTHORIZED'
      : error.code === error.TIMEOUT
        ? 'E_LOCATION_TIMEOUT'
        : 'E_LOCATION_UNAVAILABLE';
  return new LocationError(code, error.message || 'Location request failed.');
}

let lastKnownPosition: LocationObject | null = null;

/**
 * The engine's event bus for location, exported as `EventEmitter` the way the
 * package's index does. Nothing on this host emits through it — the watchers
 * call their callbacks directly — but libraries construct subscriptions
 * against it at import time.
 */
export const EventEmitter = new CoreEventEmitter();

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

export async function getCurrentPositionAsync(options: LocationOptions = {}): Promise<LocationObject> {
  const geo = geolocation();
  if (!geo) {
    throw new LocationError(
      'E_LOCATION_UNAVAILABLE',
      'compat location: navigator.geolocation is unavailable in this environment.'
    );
  }
  return new Promise<LocationObject>((resolve, reject) => {
    geo.getCurrentPosition(
      (position) => {
        lastKnownPosition = toLocationObject(position);
        resolve(lastKnownPosition);
      },
      (error) => reject(toLocationError(error)),
      positionOptions(options)
    );
  });
}

export async function getLastKnownPositionAsync(
  options: LocationLastKnownOptions = {}
): Promise<LocationObject | null> {
  if (!lastKnownPosition) return null;
  const maxAge = typeof options.maxAge === 'number' ? options.maxAge : Infinity;
  const requiredAccuracy = typeof options.requiredAccuracy === 'number' ? options.requiredAccuracy : Infinity;
  const accuracy = lastKnownPosition.coords.accuracy ?? Infinity;
  const fresh = Date.now() - lastKnownPosition.timestamp <= maxAge;
  return fresh && accuracy <= requiredAccuracy ? lastKnownPosition : null;
}

/**
 * Watch ids are the browser's, so `_getCurrentWatchId` reports the id of the
 * most recent watch (upstream exports it for the same debugging purpose).
 */
let currentWatchId = 0;
export function _getCurrentWatchId(): number {
  return currentWatchId;
}

export async function watchPositionAsync(
  options: LocationOptions,
  callback: LocationCallback,
  errorHandler?: LocationErrorCallback
): Promise<LocationSubscription> {
  const geo = geolocation();
  if (!geo) {
    warnOnce(
      'watch-unavailable',
      'compat location: navigator.geolocation is unavailable; watchPositionAsync returns an inert subscription.'
    );
    return { remove: () => {} };
  }
  const watchId = geo.watchPosition(
    (position) => {
      lastKnownPosition = toLocationObject(position);
      callback(lastKnownPosition);
    },
    (error) => errorHandler?.(toLocationError(error).message),
    positionOptions(options)
  );
  currentWatchId = watchId;
  let removed = false;
  return {
    remove: () => {
      if (removed) return;
      removed = true;
      geo.clearWatch(watchId);
    },
  };
}

export async function hasServicesEnabledAsync(): Promise<boolean> {
  return geolocation() !== null;
}

export async function getProviderStatusAsync(): Promise<LocationProviderStatus> {
  const enabled = geolocation() !== null;
  return {
    locationServicesEnabled: enabled,
    // A page is never a background location provider.
    backgroundModeEnabled: false,
    // The browser does not say which provider answered a fix.
    networkAvailable: enabled,
  };
}

/** Android-only prompt to switch on the network provider; nothing to enable here. */
export async function enableNetworkProviderAsync(): Promise<void> {}

// ---------------------------------------------------------------------------
// Heading + motion activity — no browser backend
// ---------------------------------------------------------------------------

export async function getHeadingAsync(): Promise<LocationHeadingObject> {
  throw new LocationError(
    'E_HEADING_UNAVAILABLE',
    'compat location: the browser has no compass API. DeviceOrientation reports device attitude, not a course, and needs its own iOS permission prompt.'
  );
}

export async function watchHeadingAsync(
  _callback: LocationHeadingCallback,
  _errorHandler?: LocationErrorCallback
): Promise<LocationSubscription> {
  warnOnce('heading', 'compat location: watchHeadingAsync is not supported in the browser; returning an inert subscription.');
  return { remove: () => {} };
}

export async function getMotionActivityAsync(): Promise<MotionActivityObject> {
  throw new LocationError(
    'E_MOTION_ACTIVITY_UNAVAILABLE',
    'compat location: the browser has no motion-activity classifier (CMMotionActivity / ActivityRecognition).'
  );
}

export async function watchMotionActivityAsync(
  _callback: MotionActivityCallback,
  _errorHandler?: LocationErrorCallback
): Promise<LocationSubscription> {
  warnOnce(
    'motion-activity',
    'compat location: watchMotionActivityAsync is not supported in the browser; returning an inert subscription.'
  );
  return { remove: () => {} };
}

// ---------------------------------------------------------------------------
// Geocoding — deliberately rejects (see the header)
// ---------------------------------------------------------------------------

function geocoderError(): LocationError {
  return new LocationError(
    'E_NO_GEOCODER',
    'compat location: the browser has no geocoder. Call a geocoding service from your app instead.'
  );
}

export async function geocodeAsync(_address: string): Promise<LocationGeocodedLocation[]> {
  throw geocoderError();
}

export async function reverseGeocodeAsync(
  _location: Pick<LocationGeocodedLocation, 'latitude' | 'longitude'>
): Promise<LocationGeocodedAddress[]> {
  throw geocoderError();
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

function permissionResponse(status: PermissionStatus, canAskAgain: boolean): LocationPermissionResponse {
  return {
    status,
    granted: status === PermissionStatus.GRANTED,
    canAskAgain,
    // Browser geolocation grants do not expire on a schedule.
    expires: 'never',
  };
}

async function queryGeolocationPermission(): Promise<PermissionState | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
    const result = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return result.state;
  } catch {
    // Some browsers reject an unsupported descriptor name outright.
    return null;
  }
}

export async function getForegroundPermissionsAsync(): Promise<LocationPermissionResponse> {
  const state = await queryGeolocationPermission();
  if (state === 'granted') return permissionResponse(PermissionStatus.GRANTED, true);
  if (state === 'denied') return permissionResponse(PermissionStatus.DENIED, false);
  // 'prompt', or no Permissions API to ask: undetermined until a request.
  return permissionResponse(PermissionStatus.UNDETERMINED, true);
}

export async function requestForegroundPermissionsAsync(): Promise<LocationPermissionResponse> {
  const state = await queryGeolocationPermission();
  if (state === 'granted') return permissionResponse(PermissionStatus.GRANTED, true);
  if (state === 'denied') return permissionResponse(PermissionStatus.DENIED, false);

  const geo = geolocation();
  if (!geo) return permissionResponse(PermissionStatus.DENIED, false);

  // The prompt IS the request: a one-shot position fires the browser's
  // permission dialog and its outcome is the answer.
  return new Promise<LocationPermissionResponse>((resolve) => {
    geo.getCurrentPosition(
      (position) => {
        lastKnownPosition = toLocationObject(position);
        resolve(permissionResponse(PermissionStatus.GRANTED, true));
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          resolve(permissionResponse(PermissionStatus.DENIED, false));
          return;
        }
        // Position unavailable / timed out: permission was not the problem.
        resolve(permissionResponse(PermissionStatus.GRANTED, true));
      },
      { maximumAge: Infinity }
    );
  });
}

/** A page has no background execution, so this is denied and stays denied. */
export async function getBackgroundPermissionsAsync(): Promise<PermissionResponse> {
  return permissionResponse(PermissionStatus.DENIED, false);
}

export async function requestBackgroundPermissionsAsync(): Promise<PermissionResponse> {
  warnOnce(
    'background-permission',
    'compat location: background location does not exist in a browser; the request reports denied.'
  );
  return permissionResponse(PermissionStatus.DENIED, false);
}

export async function getMotionActivityPermissionsAsync(): Promise<PermissionResponse> {
  return permissionResponse(PermissionStatus.DENIED, false);
}

export async function requestMotionActivityPermissionsAsync(): Promise<PermissionResponse> {
  return permissionResponse(PermissionStatus.DENIED, false);
}

/**
 * expo-modules-core's permission-hook contract: [response, request, get],
 * with `get` run on mount unless disabled (or `request` when asked for).
 */
function createLocationPermissionHook<T extends PermissionResponse>(
  getMethod: () => Promise<T>,
  requestMethod: () => Promise<T>
): (options?: PermissionHookOptions) => [T | null, () => Promise<T>, () => Promise<T>] {
  return function usePermissions(options?: PermissionHookOptions) {
    const [response, setResponse] = React.useState<T | null>(null);
    const mounted = React.useRef(true);
    React.useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
      };
    }, []);

    const get = React.useCallback(async (): Promise<T> => {
      const result = await getMethod();
      if (mounted.current) setResponse(result);
      return result;
    }, []);

    const request = React.useCallback(async (): Promise<T> => {
      const result = await requestMethod();
      if (mounted.current) setResponse(result);
      return result;
    }, []);

    const shouldRequest = options?.request === true;
    const shouldGet = options?.get !== false && !shouldRequest;
    React.useEffect(() => {
      if (shouldRequest) void request();
      else if (shouldGet) void get();
    }, [shouldRequest, shouldGet, request, get]);

    return [response, request, get];
  };
}

export const useForegroundPermissions = createLocationPermissionHook<LocationPermissionResponse>(
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync
);

export const useBackgroundPermissions = createLocationPermissionHook<PermissionResponse>(
  getBackgroundPermissionsAsync,
  requestBackgroundPermissionsAsync
);

export const useMotionActivityPermissions = createLocationPermissionHook<PermissionResponse>(
  getMotionActivityPermissionsAsync,
  requestMotionActivityPermissionsAsync
);

// ---------------------------------------------------------------------------
// Background updates + geofencing — start throws, stop/has are inert
// ---------------------------------------------------------------------------

export async function isBackgroundLocationAvailableAsync(): Promise<boolean> {
  return false;
}

function backgroundUnavailable(api: string): LocationError {
  return new LocationError(
    'E_BACKGROUND_LOCATION_UNAVAILABLE',
    `compat location: ${api} needs a background task runtime, which a browser page does not have.`
  );
}

export async function startLocationUpdatesAsync(
  _taskName: string,
  _options?: LocationTaskOptions
): Promise<void> {
  throw backgroundUnavailable('startLocationUpdatesAsync');
}

/** Nothing is running, so stopping is a satisfied postcondition, not a failure. */
export async function stopLocationUpdatesAsync(_taskName: string): Promise<void> {}

export async function hasStartedLocationUpdatesAsync(_taskName: string): Promise<boolean> {
  return false;
}

export async function startGeofencingAsync(_taskName: string, _regions?: LocationRegion[]): Promise<void> {
  throw backgroundUnavailable('startGeofencingAsync');
}

export async function stopGeofencingAsync(_taskName: string): Promise<void> {}

export async function hasStartedGeofencingAsync(_taskName: string): Promise<boolean> {
  return false;
}

/**
 * On native this installs Expo's implementation over navigator.geolocation.
 * Here navigator.geolocation IS the implementation, so there is nothing to
 * install.
 */
export function installWebGeolocationPolyfill(): void {}

/**
 * `import * as Location from 'expo-location'` is the documented form and is
 * served by the named exports above; the namespace default is here so a
 * default import of the same module also works under ESM/CJS interop.
 */
const Location = {
  PermissionStatus,
  Accuracy: LocationAccuracy,
  LocationAccuracy,
  ActivityType: LocationActivityType,
  LocationActivityType,
  GeofencingEventType: LocationGeofencingEventType,
  LocationGeofencingEventType,
  GeofencingRegionState: LocationGeofencingRegionState,
  LocationGeofencingRegionState,
  MotionActivityConfidence,
  MotionActivityType,
  EventEmitter,
  getCurrentPositionAsync,
  getLastKnownPositionAsync,
  watchPositionAsync,
  hasServicesEnabledAsync,
  getProviderStatusAsync,
  enableNetworkProviderAsync,
  getHeadingAsync,
  watchHeadingAsync,
  getMotionActivityAsync,
  watchMotionActivityAsync,
  geocodeAsync,
  reverseGeocodeAsync,
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync,
  getBackgroundPermissionsAsync,
  requestBackgroundPermissionsAsync,
  getMotionActivityPermissionsAsync,
  requestMotionActivityPermissionsAsync,
  useForegroundPermissions,
  useBackgroundPermissions,
  useMotionActivityPermissions,
  isBackgroundLocationAvailableAsync,
  startLocationUpdatesAsync,
  stopLocationUpdatesAsync,
  hasStartedLocationUpdatesAsync,
  startGeofencingAsync,
  stopGeofencingAsync,
  hasStartedGeofencingAsync,
  installWebGeolocationPolyfill,
  _getCurrentWatchId,
};

export default Location;
