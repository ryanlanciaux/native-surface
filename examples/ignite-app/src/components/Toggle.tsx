import * as React from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { Icon } from './Icon';
import { Text } from './Text';

export type ToggleVariant = 'switch' | 'checkbox' | 'radio';

export interface ToggleProps {
  variant?: ToggleVariant;
  label?: string;
  /** Controlled value. Leave undefined for an uncontrolled toggle. */
  value?: boolean;
  /** Initial value when uncontrolled. */
  defaultValue?: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const TRACK_W = 52;
const TRACK_H = 30;
const KNOB = 24;
const PAD = 3;
const TRAVEL = TRACK_W - KNOB - PAD * 2;

/**
 * Ignite/Toggle: label left, control right (272 wide in the design).
 * The switch knob animates; checkbox and radio cross-fade their mark.
 */
export function Toggle({
  variant = 'switch',
  label,
  value,
  defaultValue = false,
  onValueChange,
  disabled = false,
  style,
}: ToggleProps) {
  const [inner, setInner] = React.useState(defaultValue);
  const on = value ?? inner;
  const anim = React.useRef(new Animated.Value(on ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(anim, {
      toValue: on ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [on, anim]);

  const toggle = () => {
    if (disabled) return;
    const next = !on;
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };

  return (
    <Pressable
      onPress={toggle}
      disabled={disabled}
      accessibilityRole={variant === 'radio' ? 'radio' : variant === 'checkbox' ? 'checkbox' : 'switch'}
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={label}
      style={[styles.row, disabled && styles.disabled, style]}
    >
      {label ? <Text weight="medium" style={styles.label} text={label} /> : <View />}
      {variant === 'switch' ? (
        <Animated.View
          style={[
            styles.track,
            {
              backgroundColor: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [colors.border, colors.tint],
              }),
            },
          ]}
        >
          <Animated.View
            style={[
              styles.knob,
              { transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) }] },
            ]}
          />
        </Animated.View>
      ) : (
        <Animated.View
          style={[
            variant === 'radio' ? styles.radio : styles.checkbox,
            {
              borderColor: anim.interpolate({ inputRange: [0, 1], outputRange: [colors.palette.neutral400, colors.tint] }),
              backgroundColor: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [colors.surface, variant === 'radio' ? colors.surface : colors.tint],
              }),
            },
          ]}
        >
          <Animated.View style={{ opacity: anim }}>
            {variant === 'radio' ? (
              <View style={styles.radioDot} />
            ) : (
              <Icon icon="check" size={16} strokeWidth={3} color={colors.surface} />
            )}
          </Animated.View>
        </Animated.View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  disabled: { opacity: 0.5 },
  // marginBottom shifts the centered label up 1pt onto the design's baseline.
  label: { flexShrink: 1, fontSize: 15, lineHeight: 19, marginBottom: 2 },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    padding: PAD,
    flexDirection: 'row',
    alignItems: 'center',
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    shadowOffset: { width: 0, height: 1 },
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.tint },
});
