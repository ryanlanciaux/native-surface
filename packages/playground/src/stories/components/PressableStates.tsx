import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PressEvent, TextStyle, ViewStyle } from 'react-native';

export interface PressableStatesProps {
  hitSlop?: number;
  disabled?: boolean;
  activeOpacity?: number;
  onPress?: (event: PressEvent) => void;
  onPressIn?: (event: PressEvent) => void;
  onPressOut?: (event: PressEvent) => void;
  onLongPress?: (event: PressEvent) => void;
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, backgroundColor: '#ffffff' },
  caption: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: '#94a3b8' },
  note: { fontSize: 12, color: '#64748b' },
  tile: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 8,
    backgroundColor: '#f8fafc',
  },
  target: {
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  targetPressed: { backgroundColor: '#1e40af', transform: [{ scale: 0.97 }] },
  targetLabel: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  smallTarget: {
    width: 44,
    height: 28,
    borderRadius: 8,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  smallLabel: { color: '#ffffff', fontSize: 11, fontWeight: '600' },
  slopHint: {
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  touchable: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0ea5e9',
  },
  disabled: { opacity: 0.4 },
} satisfies Record<string, ViewStyle | TextStyle>);

export function PressableStates(props: PressableStatesProps): React.JSX.Element {
  const { hitSlop = 16, disabled = false, activeOpacity = 0.2, onPress, onPressIn, onPressOut, onLongPress } = props;

  return (
    <View style={styles.page}>
      <View style={styles.tile}>
        <Text style={styles.caption}>PRESSED STATE (function style + children)</Text>
        <Pressable
          disabled={disabled}
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          onLongPress={onLongPress}
          style={({ pressed }) => [styles.target, pressed && styles.targetPressed, disabled && styles.disabled]}
        >
          {({ pressed }) => (
            <Text style={styles.targetLabel}>{pressed ? 'Pressed — hold for long press' : 'Press me'}</Text>
          )}
        </Pressable>
        <Text style={styles.note}>Drag off the button before releasing: the press cancels, RN-style.</Text>
      </View>

      <View style={styles.tile}>
        <Text style={styles.caption}>HITSLOP {String(hitSlop)}PT</Text>
        <View style={styles.slopHint}>
          <Pressable disabled={disabled} hitSlop={hitSlop} onPress={onPress} style={styles.smallTarget}>
            <Text style={styles.smallLabel}>tiny</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>Taps inside the outlined frame still hit the small target.</Text>
      </View>

      <View style={styles.tile}>
        <Text style={styles.caption}>TOUCHABLEOPACITY (activeOpacity {String(activeOpacity)})</Text>
        <TouchableOpacity
          disabled={disabled}
          activeOpacity={activeOpacity}
          onPress={onPress}
          style={[styles.touchable, disabled && styles.disabled]}
        >
          <Text style={styles.targetLabel}>{disabled ? 'Disabled' : 'Fades while held'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
