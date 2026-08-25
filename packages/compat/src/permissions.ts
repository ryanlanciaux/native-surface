/**
 * react-native-permissions compat shim — everything is granted.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — check/request/checkMultiple/requestMultiple, RESULTS, the
 * PERMISSIONS platform maps, openSettings, checkNotifications/
 * requestNotifications. Design choice, stated: the canvas host has no OS
 * permission broker, and browser capabilities gate themselves at the point
 * of use (each shim guards its own API), so a permission GATE here would only
 * block UI flows behind dialogs that cannot exist. Every check/request
 * resolves 'granted'; the capability may still be a no-op at use time — the
 * relevant shim warns there.
 *
 * PERMISSIONS.IOS/ANDROID/WINDOWS are Proxies that mint the platform-shaped
 * permission string for ANY key (PERMISSIONS.IOS.CAMERA →
 * 'ios.permission.CAMERA'), so no app ever hits undefined on a constant this
 * file did not enumerate. openSettings resolves as a warn-once no-op — there
 * is no settings screen to open.
 */

export const RESULTS = {
  UNAVAILABLE: 'unavailable',
  DENIED: 'denied',
  LIMITED: 'limited',
  GRANTED: 'granted',
  BLOCKED: 'blocked',
} as const;
export type PermissionStatus = (typeof RESULTS)[keyof typeof RESULTS];

/**
 * The documented constants are typed explicitly so lookups stay `string`
 * under noUncheckedIndexedAccess; the runtime Proxy additionally mints a
 * platform-shaped string for ANY other key.
 */
type KnownIOSPermission =
  | 'APP_TRACKING_TRANSPARENCY'
  | 'BLUETOOTH'
  | 'CALENDARS'
  | 'CALENDARS_WRITE_ONLY'
  | 'CAMERA'
  | 'CONTACTS'
  | 'FACE_ID'
  | 'LOCATION_ALWAYS'
  | 'LOCATION_WHEN_IN_USE'
  | 'MEDIA_LIBRARY'
  | 'MICROPHONE'
  | 'MOTION'
  | 'PHOTO_LIBRARY'
  | 'PHOTO_LIBRARY_ADD_ONLY'
  | 'REMINDERS'
  | 'SIRI'
  | 'SPEECH_RECOGNITION'
  | 'STOREKIT';

type KnownAndroidPermission =
  | 'ACCEPT_HANDOVER'
  | 'ACCESS_BACKGROUND_LOCATION'
  | 'ACCESS_COARSE_LOCATION'
  | 'ACCESS_FINE_LOCATION'
  | 'ACTIVITY_RECOGNITION'
  | 'ANSWER_PHONE_CALLS'
  | 'BLUETOOTH_ADVERTISE'
  | 'BLUETOOTH_CONNECT'
  | 'BLUETOOTH_SCAN'
  | 'BODY_SENSORS'
  | 'CALL_PHONE'
  | 'CAMERA'
  | 'GET_ACCOUNTS'
  | 'NEARBY_WIFI_DEVICES'
  | 'POST_NOTIFICATIONS'
  | 'READ_CALENDAR'
  | 'READ_CALL_LOG'
  | 'READ_CONTACTS'
  | 'READ_EXTERNAL_STORAGE'
  | 'READ_MEDIA_AUDIO'
  | 'READ_MEDIA_IMAGES'
  | 'READ_MEDIA_VIDEO'
  | 'READ_PHONE_NUMBERS'
  | 'READ_PHONE_STATE'
  | 'READ_SMS'
  | 'RECEIVE_MMS'
  | 'RECEIVE_SMS'
  | 'RECORD_AUDIO'
  | 'SEND_SMS'
  | 'UWB_RANGING'
  | 'WRITE_CALENDAR'
  | 'WRITE_CALL_LOG'
  | 'WRITE_CONTACTS'
  | 'WRITE_EXTERNAL_STORAGE';

type PermissionMap<K extends string> = { readonly [P in K]: string } & Record<string, string>;

function platformPermissionMap<K extends string>(prefix: string): PermissionMap<K> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return typeof prop === 'string' ? `${prefix}.permission.${prop}` : undefined;
      },
    }
  ) as PermissionMap<K>;
}

export const PERMISSIONS = {
  IOS: platformPermissionMap<KnownIOSPermission>('ios'),
  ANDROID: platformPermissionMap<KnownAndroidPermission>('android'),
  WINDOWS: platformPermissionMap('windows'),
} as const;

export async function check(_permission: string): Promise<PermissionStatus> {
  return RESULTS.GRANTED;
}

export async function request(_permission: string, _rationale?: unknown): Promise<PermissionStatus> {
  return RESULTS.GRANTED;
}

export async function checkMultiple<P extends string>(permissions: readonly P[]): Promise<Record<P, PermissionStatus>> {
  const statuses = {} as Record<P, PermissionStatus>;
  for (const permission of permissions) statuses[permission] = RESULTS.GRANTED;
  return statuses;
}

export async function requestMultiple<P extends string>(
  permissions: readonly P[]
): Promise<Record<P, PermissionStatus>> {
  return checkMultiple(permissions);
}

let warnedOpenSettings = false;

export async function openSettings(): Promise<void> {
  if (!warnedOpenSettings) {
    warnedOpenSettings = true;
    console.warn('compat permissions: openSettings is a no-op — the canvas host has no settings screen.');
  }
}

export interface NotificationsResponse {
  status: PermissionStatus;
  settings: Record<string, unknown>;
}

export async function checkNotifications(): Promise<NotificationsResponse> {
  return { status: RESULTS.GRANTED, settings: {} };
}

export async function requestNotifications(_options?: readonly string[]): Promise<NotificationsResponse> {
  return { status: RESULTS.GRANTED, settings: {} };
}

const RNPermissions = {
  check,
  request,
  checkMultiple,
  requestMultiple,
  openSettings,
  checkNotifications,
  requestNotifications,
  RESULTS,
  PERMISSIONS,
};

export default RNPermissions;
