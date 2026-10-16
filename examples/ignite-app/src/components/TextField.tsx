import * as React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, radii, typography } from '../theme';
import { Text } from './Text';

export interface TextFieldProps {
  label?: string;
  helper?: string;
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  /** Error state: angry border + helper. */
  status?: 'error';
  secureTextEntry?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Ignite's TextField: label, bordered input, helper text. */
export function TextField({ label, helper, placeholder, value, onChangeText, status, secureTextEntry, style }: TextFieldProps) {
  const [focused, setFocused] = React.useState(false);
  const error = status === 'error';
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text preset="formLabel" text={label} /> : null}
      <View style={[styles.box, focused && styles.focused, error && styles.error]}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.palette.neutral500}
          secureTextEntry={secureTextEntry}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
        />
      </View>
      {helper ? <Text preset="formHelper" text={helper} style={error ? { color: colors.error } : null} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  box: {
    minHeight: 48,
    borderRadius: radii.field,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  focused: { borderColor: colors.tint },
  error: { borderColor: colors.error },
  input: { fontFamily: typography.family, fontSize: 15, color: colors.text, paddingVertical: 10 },
});
