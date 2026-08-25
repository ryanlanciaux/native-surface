/**
 * expo-haptics compat shim — navigator.vibrate-backed.
 *
 * Boundary-general (docs/compat-strategy.md): implements the documented
 * surface — impactAsync/notificationAsync/selectionAsync/
 * performAndroidHapticsAsync plus the ImpactFeedbackStyle/
 * NotificationFeedbackType/AndroidHaptics enums.
 *
 * Feedback maps to short navigator.vibrate patterns. vibrate is best-effort
 * by contract here: it may be undefined (desktop browsers, node) or throw /
 * return false without a user activation, so every call is guarded and every
 * function ALWAYS resolves — haptics are advisory and must never break an
 * interaction flow. performAndroidHapticsAsync collapses to a single short
 * pulse for all constants (the Android haptic-constant vocabulary has no
 * browser equivalent).
 */

export const ImpactFeedbackStyle = {
  Light: 'light',
  Medium: 'medium',
  Heavy: 'heavy',
  Rigid: 'rigid',
  Soft: 'soft',
} as const;
export type ImpactFeedbackStyle = (typeof ImpactFeedbackStyle)[keyof typeof ImpactFeedbackStyle];

export const NotificationFeedbackType = {
  Success: 'success',
  Warning: 'warning',
  Error: 'error',
} as const;
export type NotificationFeedbackType = (typeof NotificationFeedbackType)[keyof typeof NotificationFeedbackType];

export const AndroidHaptics = {
  Clock_Tick: 'clock-tick',
  Confirm: 'confirm',
  Context_Click: 'context-click',
  Drag_Start: 'drag-start',
  Gesture_End: 'gesture-end',
  Gesture_Start: 'gesture-start',
  Keyboard_Press: 'keyboard-press',
  Keyboard_Release: 'keyboard-release',
  Keyboard_Tap: 'keyboard-tap',
  Long_Press: 'long-press',
  No_Haptics: 'no-haptics',
  Reject: 'reject',
  Segment_Frequent_Tick: 'segment-frequent-tick',
  Segment_Tick: 'segment-tick',
  Text_Handle_Move: 'text-handle-move',
  Toggle_Off: 'toggle-off',
  Toggle_On: 'toggle-on',
  Virtual_Key: 'virtual-key',
  Virtual_Key_Release: 'virtual-key-release',
} as const;
export type AndroidHaptics = (typeof AndroidHaptics)[keyof typeof AndroidHaptics];

function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    /* no user activation / feature disabled — haptics are best-effort */
  }
}

const IMPACT_PATTERNS: Record<ImpactFeedbackStyle, number> = {
  light: 10,
  medium: 20,
  heavy: 30,
  rigid: 15,
  soft: 8,
};

const NOTIFICATION_PATTERNS: Record<NotificationFeedbackType, number[]> = {
  success: [10, 40, 10],
  warning: [20, 60, 20],
  error: [30, 60, 30, 60, 30],
};

export async function impactAsync(style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium): Promise<void> {
  vibrate(IMPACT_PATTERNS[style] ?? IMPACT_PATTERNS.medium);
}

export async function notificationAsync(
  type: NotificationFeedbackType = NotificationFeedbackType.Success
): Promise<void> {
  vibrate(NOTIFICATION_PATTERNS[type] ?? NOTIFICATION_PATTERNS.success);
}

export async function selectionAsync(): Promise<void> {
  vibrate(5);
}

export async function performAndroidHapticsAsync(_type: AndroidHaptics): Promise<void> {
  vibrate(10);
}
