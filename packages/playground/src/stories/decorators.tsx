import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import type { Decorator } from '../story-types';

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#ffffff' },
  padded: { flex: 1, padding: 16, backgroundColor: '#f8fafc' },
  screen: { flex: 1, backgroundColor: '#f8fafc' },
} satisfies Record<string, ViewStyle>);

/** Centers the story in the viewport — the default frame for single components. */
export const centered: Decorator = (Story) => <View style={styles.center}>{Story()}</View>;

/** Neutral page background with breathing room. */
export const padded: Decorator = (Story) => <View style={styles.padded}>{Story()}</View>;

/**
 * Platform-shaped safe-area insets applied as Yoga padding, driven by the
 * playground's theme toggle.
 */
export const safeArea: Decorator = (Story, context) => (
  <View style={[styles.screen, { paddingTop: context.theme === 'ios' ? 47 : 24 }]}>{Story()}</View>
);
