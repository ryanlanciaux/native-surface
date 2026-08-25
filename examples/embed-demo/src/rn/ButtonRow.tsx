import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import { Button } from './Button';
import { colors } from './tokens';

/** Every variant and state of the design-system Button, on one surface. */
export function ButtonRow() {
  const [message, setMessage] = useState<string | null>(null);
  const setLastPressed = (label: string) =>
    setMessage(`Pressed “${label}” — that state change repainted this text.`);

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>VARIANTS</Text>

      <View style={styles.row}>
        <Button label="Save" size="sm" onPress={() => setLastPressed('Save')} style={styles.cell} />
        <Button
          label="Cancel"
          variant="secondary"
          size="sm"
          onPress={() => setLastPressed('Cancel')}
          style={styles.cell}
        />
        <Button
          label="Delete"
          variant="destructive"
          size="sm"
          onPress={() => setLastPressed('Delete')}
          style={styles.cell}
        />
      </View>

      <View style={styles.row}>
        <Button label="Disabled" size="sm" disabled style={styles.cell} />
        <Button
          label="Press and hold"
          variant="secondary"
          size="sm"
          onPress={() => setLastPressed('Press and hold')}
          onLongPress={() => setMessage('Long press fired at 500ms — the React Native threshold.')}
          style={styles.wideCell}
        />
      </View>

      <Text style={styles.caption} numberOfLines={2}>
        {message ?? 'Press one. The pressed state is a Skia repaint, not a CSS :active rule.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create<{
  root: ViewStyle;
  eyebrow: TextStyle;
  row: ViewStyle;
  cell: ViewStyle;
  wideCell: ViewStyle;
  caption: TextStyle;
}>({
  root: { flex: 1, backgroundColor: colors.card, paddingHorizontal: 16, paddingVertical: 14 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: colors.muted },
  row: { flexDirection: 'row', marginTop: 10, gap: 10 },
  cell: { flex: 1, paddingHorizontal: 0 },
  wideCell: { flex: 2, paddingHorizontal: 0 },
  caption: { marginTop: 12, fontSize: 12, lineHeight: 17, color: colors.body },
});
