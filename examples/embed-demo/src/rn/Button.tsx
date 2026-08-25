import { Pressable, StyleSheet, Text } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { colors, radii, type ButtonVariant } from './tokens';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

interface Skin {
  base: ViewStyle;
  pressed: ViewStyle;
  labelColor: string;
}

const skins: Record<ButtonVariant, Skin> = {
  primary: {
    base: { backgroundColor: colors.brand },
    pressed: { backgroundColor: colors.brandPressed },
    labelColor: colors.onBrand,
  },
  secondary: {
    base: { backgroundColor: colors.subtle, borderWidth: 1, borderColor: colors.line },
    pressed: { backgroundColor: colors.subtlePressed },
    labelColor: colors.ink,
  },
  destructive: {
    base: { backgroundColor: colors.danger },
    pressed: { backgroundColor: colors.dangerPressed },
    labelColor: colors.onBrand,
  },
};

export function Button({
  label,
  onPress,
  onLongPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  style,
}: ButtonProps) {
  const skin = skins[variant];

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sizeSm : styles.sizeMd,
        skin.base,
        pressed && !disabled ? skin.pressed : null,
        pressed && !disabled ? styles.pressedLift : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {({ pressed }) => (
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            size === 'sm' ? styles.labelSm : styles.labelMd,
            { color: disabled ? colors.disabledText : skin.labelColor },
            pressed && !disabled ? styles.labelPressed : null,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create<{
  base: ViewStyle;
  sizeMd: ViewStyle;
  sizeSm: ViewStyle;
  pressedLift: ViewStyle;
  disabled: ViewStyle;
  label: TextStyle;
  labelMd: TextStyle;
  labelSm: TextStyle;
  labelPressed: TextStyle;
}>({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  sizeMd: { height: 42, paddingHorizontal: 18 },
  sizeSm: { height: 32, paddingHorizontal: 14, borderRadius: radii.sm },
  pressedLift: { transform: [{ translateY: 1 }] },
  disabled: { backgroundColor: colors.disabledBg, borderWidth: 0 },
  label: { fontWeight: '600', letterSpacing: 0.1 },
  labelMd: { fontSize: 15 },
  labelSm: { fontSize: 13 },
  labelPressed: { opacity: 0.88 },
});
