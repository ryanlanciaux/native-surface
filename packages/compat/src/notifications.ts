/**
 * expo-notifications compat shim — honest advisory stub.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface, but unlike most shims this one reports 'denied' from both
 * getPermissionsAsync and requestPermissionsAsync. Reason: no notification
 * can ever be DELIVERED on the canvas host (no notification service, no
 * banner chrome, and we deliberately do not hijack the browser Notification
 * API for an embedded surface). Lying with 'granted' would send apps into
 * their schedule-and-wait flows and the notification would silently never
 * arrive; 'denied' with canAskAgain false routes them into their documented
 * degraded path instead. scheduleNotificationAsync still resolves a fake
 * identifier (warn-once) so fire-and-forget callers that skip the permission
 * check don't crash; cancel/dismiss are no-ops against that same void.
 *
 * Push tokens REJECT (not resolve-null): getExpoPushTokenAsync's contract is
 * "a token you can send to a push service", and a made-up token would fail
 * remotely and undebuggably later. Listeners return inert {remove()}
 * subscriptions — there is nothing to observe.
 */

export interface NotificationPermissionsStatus {
  status: 'denied';
  granted: false;
  canAskAgain: false;
  expires: 'never';
}

function deniedStatus(): NotificationPermissionsStatus {
  return { status: 'denied', granted: false, canAskAgain: false, expires: 'never' };
}

export async function getPermissionsAsync(): Promise<NotificationPermissionsStatus> {
  return deniedStatus();
}

export async function requestPermissionsAsync(_request?: unknown): Promise<NotificationPermissionsStatus> {
  return deniedStatus();
}

/** Accepted and ignored — no notification will ever be presented. */
export function setNotificationHandler(_handler: unknown): void {}

let warnedSchedule = false;
let scheduleCounter = 0;

export async function scheduleNotificationAsync(_request: unknown): Promise<string> {
  if (!warnedSchedule) {
    warnedSchedule = true;
    console.warn(
      'compat notifications: scheduleNotificationAsync is a no-op on the canvas host — nothing will be delivered.'
    );
  }
  return `native-surface-noop-${++scheduleCounter}`;
}

export async function cancelScheduledNotificationAsync(_identifier: string): Promise<void> {}
export async function cancelAllScheduledNotificationsAsync(): Promise<void> {}
export async function getAllScheduledNotificationsAsync(): Promise<unknown[]> {
  return [];
}
export async function dismissNotificationAsync(_identifier: string): Promise<void> {}
export async function dismissAllNotificationsAsync(): Promise<void> {}

export interface Subscription {
  remove: () => void;
}

export function addNotificationReceivedListener(_listener: (event: unknown) => void): Subscription {
  return { remove: () => {} };
}

export function addNotificationResponseReceivedListener(_listener: (event: unknown) => void): Subscription {
  return { remove: () => {} };
}

export function removeNotificationSubscription(subscription: Subscription): void {
  subscription.remove();
}

export async function getLastNotificationResponseAsync(): Promise<null> {
  return null;
}

export async function getExpoPushTokenAsync(_options?: unknown): Promise<never> {
  throw new Error(
    'expo-notifications compat: push tokens require a native host — there is no push service behind the canvas surface.'
  );
}

export async function getDevicePushTokenAsync(): Promise<never> {
  throw new Error(
    'expo-notifications compat: push tokens require a native host — there is no push service behind the canvas surface.'
  );
}

export async function setNotificationChannelAsync(_channelId: string, _channel: unknown): Promise<null> {
  return null;
}

export async function getNotificationChannelsAsync(): Promise<unknown[]> {
  return [];
}

export async function setBadgeCountAsync(_badgeCount: number): Promise<boolean> {
  return false;
}

export async function getBadgeCountAsync(): Promise<number> {
  return 0;
}

// ---------------------------------------------------------------------------
// Push-token listeners, the synchronous last-response pair, and the Android
// channel/enum surface.
//
// Every name below is reached through a NAMESPACE import
// (`import * as Notifications from 'expo-notifications'`), which is why their
// absence surfaced as `Notifications.addPushTokenListener is not a function`
// at the call site rather than as a link-time failure — the softer half of
// the F6 lesson, and the reason a namespace-imported package needs its
// surface covered by usage rather than by whatever the shim happened to
// implement first.
// ---------------------------------------------------------------------------

/** The shape a device push token arrives in (`{type, data}`). */
export interface DevicePushToken {
  type: 'ios' | 'android' | 'web';
  data: string;
}

export type PushTokenListener = (token: DevicePushToken) => void;

/**
 * Inert by construction, not by omission. A token listener fires when the OS
 * ISSUES or ROTATES a push token, and this host never has one to issue —
 * getPermissionsAsync reports denied, so a caller's `getDevicePushTokenAsync`
 * is never reached either. Returning a live subscription that never fires is
 * the honest shape: callers add it at mount and remove it at unmount, and
 * both halves work.
 */
export function addPushTokenListener(_listener: PushTokenListener): Subscription {
  return { remove: () => {} };
}

export function removePushTokenSubscription(subscription: Subscription): void {
  subscription.remove();
}

/**
 * The SYNCHRONOUS half of the last-response pair. Apps read it during render
 * to decide whether they were cold-started by tapping a notification, so it
 * must return a value rather than a promise. Nothing can have launched this
 * surface from a notification, so the answer is always null — which is the
 * same answer a native app gets on a normal launch.
 */
export function getLastNotificationResponse(): null {
  return null;
}

export function clearLastNotificationResponse(): void {}

export async function clearLastNotificationResponseAsync(): Promise<void> {}

/** Android notification channels have no analogue here; see setNotificationChannelAsync. */
export async function setNotificationChannelGroupAsync(
  _groupId: string,
  _group: unknown
): Promise<null> {
  return null;
}

export async function getNotificationChannelGroupsAsync(): Promise<unknown[]> {
  return [];
}

export async function deleteNotificationChannelAsync(_channelId: string): Promise<void> {}
export async function deleteNotificationChannelGroupAsync(_groupId: string): Promise<void> {}

/**
 * The identifier a response carries when the notification body itself was
 * tapped, rather than one of its action buttons. Apps compare against it, so
 * the VALUE has to match the real one exactly — a private constant here would
 * silently never equal what a real payload carries.
 */
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

/** Android channel importance levels, mirroring the real numeric values. */
export enum AndroidImportance {
  UNKNOWN = 0,
  UNSPECIFIED = 1,
  NONE = 2,
  MIN = 3,
  LOW = 4,
  DEFAULT = 5,
  HIGH = 6,
  MAX = 7,
}

/** Android lock-screen visibility levels, mirroring the real numeric values. */
export enum AndroidNotificationVisibility {
  UNKNOWN = 0,
  PUBLIC = 1,
  PRIVATE = 2,
  SECRET = 3,
}
