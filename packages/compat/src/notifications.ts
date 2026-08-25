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
