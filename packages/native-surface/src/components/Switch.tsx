/**
 * Switch — the iOS UISwitch, painted by the engine (no DOM control involved).
 *
 * CONTROLLED, exactly like RN's: a press never flips internal state, it only
 * reports the intended value through onValueChange; the switch moves when the
 * owner passes a new `value`. An owner that ignores onValueChange gets a
 * switch that doesn't move — the RN behavior, and the reason paper's Switch
 * works unchanged.
 *
 * Geometry is UISwitch's fixed 51x31 track / 27x27 thumb (RN's Switch has no
 * size prop on iOS), so thumb travel is a constant — a `style` that resizes
 * the track resizes the track only. The track color cross-fades and the thumb
 * slides through the engine's own Animated, so the transition is painted on
 * the canvas rather than snapped on the next React commit.
 */
import * as React from 'react';
import { Animated, Easing, useAnimatedValue } from '../api/Animated';
import { Pressable } from './primitives';
import type { ColorValue, StyleProp, ViewProps, ViewStyle } from '../types';

const TRACK_WIDTH = 51;
const TRACK_HEIGHT = 31;
const THUMB_SIZE = 27;
const THUMB_INSET = 2;
/** Left inset to right inset: the thumb's full slide. */
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - THUMB_INSET * 2;
const TOGGLE_MS = 180;

const TRACK_OFF = '#e9e9ea';
const TRACK_ON = '#34c759';
const THUMB = '#ffffff';

export interface SwitchProps extends Omit<ViewProps, 'children' | 'ref'> {
  /** Controlled position. */
  value?: boolean;
  /** Called with the value the press ASKS for; the owner decides. */
  onValueChange?: (value: boolean) => void;
  /** Dims to 0.5 and stops responding to presses (RN semantics). */
  disabled?: boolean;
  trackColor?: { false?: ColorValue | null; true?: ColorValue | null };
  thumbColor?: ColorValue;
  /** iOS-only track color behind the false state. `trackColor.false` wins
   *  when both are given — it is the more specific of the two. */
  ios_backgroundColor?: ColorValue;
  style?: StyleProp<ViewStyle>;
}

export function Switch(props: SwitchProps): React.JSX.Element {
  const {
    value = false,
    onValueChange,
    disabled = false,
    trackColor,
    thumbColor,
    ios_backgroundColor,
    style,
    ...rest
  } = props;

  const progress = useAnimatedValue(value ? 1 : 0);
  React.useEffect(() => {
    const to = value ? 1 : 0;
    if (progress.__getValue() === to) return; // includes the mount pass
    const animation = Animated.timing(progress, {
      toValue: to,
      duration: TOGGLE_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [value, progress]);

  const off = trackColor?.false ?? ios_backgroundColor ?? TRACK_OFF;
  const on = trackColor?.true ?? TRACK_ON;

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      style={[{ width: TRACK_WIDTH, height: TRACK_HEIGHT, opacity: disabled ? 0.5 : 1 }, style]}
    >
      {/* Track: absolute-filling so a style-resized track still gets painted
          edge to edge, and so the thumb sits ON it rather than beside it. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
          borderRadius: TRACK_HEIGHT / 2,
          backgroundColor: progress.interpolate({ inputRange: [0, 1], outputRange: [off, on] }),
        }}
      />
      <Animated.View
        style={{
          position: 'absolute',
          left: THUMB_INSET,
          top: THUMB_INSET,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          borderRadius: THUMB_SIZE / 2,
          backgroundColor: thumbColor ?? THUMB,
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.24,
          shadowRadius: 2,
          transform: [
            { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, THUMB_TRAVEL] }) },
          ],
        }}
      />
    </Pressable>
  );
}
