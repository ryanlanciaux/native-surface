/**
 * The members an app CALLS on a react-native export, not just the export name.
 *
 * A missing top-level export is a link error and shows up immediately; a
 * missing MEMBER is `undefined` and throws only when a user reaches that code
 * path — `Notifications.addPushTokenListener` and `SystemBars.pushStackEntry`
 * each cost a round-trip that way, and so did `AccessibilityInfo
 * .setAccessibilityFocus` (a focus trap opening a dialog) and
 * `Linking.openSettings` (the "permission denied → Open Settings" button on
 * the notification settings screen).
 *
 * These pin the documented surface of the objects that are namespaces rather
 * than components, so the next gap is a failing test instead of a bug report.
 */
import { describe, expect, it } from 'vitest';
import { AccessibilityInfo, BackHandler, InteractionManager, Linking, UIManager } from '../src/index';

const has = (obj: object, names: string[]): string[] =>
  names.filter((n) => typeof (obj as Record<string, unknown>)[n] !== 'function');

describe('react-native namespace surfaces', () => {
  it('AccessibilityInfo implements the documented API', () => {
    expect(
      has(AccessibilityInfo, [
        'isScreenReaderEnabled',
        'isReduceMotionEnabled',
        'isReduceTransparencyEnabled',
        'isBoldTextEnabled',
        'isGrayscaleEnabled',
        'isInvertColorsEnabled',
        'prefersCrossFadeTransitions',
        'getRecommendedTimeoutMillis',
        'addEventListener',
        'setAccessibilityFocus',
        'announceForAccessibility',
        'announceForAccessibilityWithOptions',
        'sendAccessibilityEvent',
      ])
    ).toEqual([]);
  });

  it('AccessibilityInfo answers "off" and its commands are inert', async () => {
    await expect(AccessibilityInfo.isScreenReaderEnabled()).resolves.toBe(false);
    // The documented default is to hand back the caller's own timeout.
    await expect(AccessibilityInfo.getRecommendedTimeoutMillis(5000)).resolves.toBe(5000);
    expect(() => AccessibilityInfo.setAccessibilityFocus(42)).not.toThrow();
    expect(() => AccessibilityInfo.announceForAccessibility('hi')).not.toThrow();
    expect(AccessibilityInfo.addEventListener('change', () => {}).remove).toBeTypeOf('function');
  });

  it('Linking implements the documented API, openSettings included', async () => {
    expect(has(Linking, ['getInitialURL', 'addEventListener', 'openURL', 'canOpenURL', 'openSettings', 'sendIntent'])).toEqual([]);
    // A site cannot open the user's OS settings; resolving inertly beats
    // throwing out of the button's onPress.
    await expect(Linking.openSettings()).resolves.toBeUndefined();
    await expect(Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS')).resolves.toBeUndefined();
  });

  it('the other namespace stubs still answer', () => {
    expect(has(BackHandler, ['addEventListener', 'exitApp'])).toEqual([]);
    expect(has(InteractionManager, ['runAfterInteractions', 'createInteractionHandle', 'clearInteractionHandle'])).toEqual([]);
    expect(has(UIManager, ['getViewManagerConfig', 'hasViewManagerConfig'])).toEqual([]);
  });
});
