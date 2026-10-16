import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import { Button } from './Button';
import { colors } from './tokens';

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>Counter</Text>

      <View style={styles.row}>
        <Button
          label="−"
          variant="secondary"
          onPress={() => setCount((n) => n - 1)}
          style={styles.step}
        />
        <View style={styles.readout}>
          <Text style={styles.value}>{count}</Text>
        </View>
        <Button label="+" onPress={() => setCount((n) => n + 1)} style={styles.step} />
      </View>

    </View>
  );
}

const styles = StyleSheet.create<{
  root: ViewStyle;
  eyebrow: TextStyle;
  row: ViewStyle;
  step: ViewStyle;
  readout: ViewStyle;
  value: TextStyle;
  hint: TextStyle;
}>({
  root: {
    flex: 1,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    color: colors.muted,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 16,
  },
  step: { width: 52, paddingHorizontal: 0 },
  readout: { minWidth: 96, alignItems: 'center', justifyContent: 'center' },
  value: {
    fontSize: 42,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -1,
    textAlign: 'center',
  },
  hint: { marginTop: 8, fontSize: 11, color: colors.muted, textAlign: 'center' },
});
