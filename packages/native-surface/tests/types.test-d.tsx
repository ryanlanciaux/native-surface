/**
 * Type-level regressions (compiled by `tsc --noEmit`, not executed).
 * Pins demo #1 / playground A1 (StyleSheet.create literal inference) and
 * playground C1 (Platform.select totality) — written as PLAIN RN-style source:
 * no explicit generics, no `satisfies`, exactly what copy-pasted RN code does.
 */
import * as React from 'react';
import { Platform, StyleSheet, Text, View } from '../src/index';

// StyleSheet.create must keep string literals narrow with no annotations.
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  label: { fontWeight: '700', textAlign: 'center', color: '#111' },
  abs: { position: 'absolute', overflow: 'hidden' },
});

export function TypeFixture(): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View style={[styles.abs, { top: 0 }]} />
      <Text style={styles.label}>ok</Text>
    </View>
  );
}

// Platform.select is total when both platforms (or a default) are covered…
const radius1: number = Platform.select({ ios: 10, android: 4 });
const radius2: number = Platform.select({ ios: 10, default: 4 });
// …and remains optional when it is not.
// @ts-expect-error — a partial spec can produce undefined
const radius3: number = Platform.select({ ios: 10 });

export const radii = [radius1, radius2, radius3];
