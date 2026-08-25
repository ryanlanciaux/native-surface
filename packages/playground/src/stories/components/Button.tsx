import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  fullWidth?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

const PALETTE: Record<ButtonVariant, { bg: string; pressed: string; text: string; border: string }> = {
  primary: { bg: '#2563eb', pressed: '#1d4ed8', text: '#ffffff', border: 'transparent' },
  secondary: { bg: '#e5e7eb', pressed: '#d1d5db', text: '#111827', border: 'transparent' },
  ghost: { bg: 'transparent', pressed: '#eef2ff', text: '#2563eb', border: '#c7d2fe' },
  danger: { bg: '#dc2626', pressed: '#b91c1c', text: '#ffffff', border: 'transparent' },
};

const styles = StyleSheet.create({
  // No alignSelf: the parent decides whether a button shrink-wraps or fills,
  // exactly as in RN. `fullWidth` opts into stretching regardless.
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: 0.4 },
  label: { textAlign: 'center' },
  padSmall: { paddingVertical: 7, paddingHorizontal: 14 },
  padMedium: { paddingVertical: 11, paddingHorizontal: 20 },
  padLarge: { paddingVertical: 15, paddingHorizontal: 26 },
} satisfies Record<string, ViewStyle | TextStyle>);

const PADDING: Record<ButtonSize, ViewStyle> = {
  small: styles.padSmall,
  medium: styles.padMedium,
  large: styles.padLarge,
};

const FONT_SIZE: Record<ButtonSize, number> = { small: 13, medium: 15, large: 17 };

export function Button(props: ButtonProps): React.JSX.Element {
  const {
    label,
    variant = 'primary',
    size = 'medium',
    disabled = false,
    fullWidth = false,
    onPress,
    onLongPress,
  } = props;

  const colors = PALETTE[variant];
  // Read at render time (not module scope) so the playground's platform toggle
  // actually re-themes the component.
  const android = Platform.OS === 'android';
  const radius = Platform.select({ ios: 10, android: 4 }) ?? 10;

  return (
    <Pressable
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.base,
        PADDING[size],
        {
          backgroundColor: pressed && !disabled ? colors.pressed : colors.bg,
          borderColor: colors.border,
          borderRadius: radius,
        },
        fullWidth && styles.fullWidth,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: colors.text,
            fontSize: FONT_SIZE[size],
            fontWeight: android ? '700' : '600',
            letterSpacing: android ? 0.8 : 0,
          },
        ]}
      >
        {android ? label.toUpperCase() : label}
      </Text>
    </Pressable>
  );
}
