import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
}

export interface BadgeRowProps {
  labels: string[];
  tone?: BadgeTone;
  gap?: number;
  wrap?: boolean;
  containerWidth?: number;
}

const TONES: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: '#f1f5f9', fg: '#334155', border: '#e2e8f0' },
  info: { bg: '#e0f2fe', fg: '#0369a1', border: '#bae6fd' },
  success: { bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
  warning: { bg: '#fef3c7', fg: '#b45309', border: '#fde68a' },
  danger: { bg: '#fee2e2', fg: '#b91c1c', border: '#fecaca' },
};

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: { fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  frame: {
    margin: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
} satisfies Record<string, ViewStyle | TextStyle>);

export function Badge(props: BadgeProps): React.JSX.Element {
  const { label, tone = 'neutral' } = props;
  const colors = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <Text style={[styles.label, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

/** Wrapping row: exercises Yoga's flexWrap + gap against a constrained width. */
export function BadgeRow(props: BadgeRowProps): React.JSX.Element {
  const { labels, tone = 'info', gap = 8, wrap = true, containerWidth = 260 } = props;
  return (
    <View style={[styles.frame, { width: containerWidth }]}>
      <View style={[styles.row, { gap, flexWrap: wrap ? 'wrap' : 'nowrap' }]}>
        {labels.map((label, index) => (
          <Badge key={`${label}-${index}`} label={label} tone={tone} />
        ))}
      </View>
    </View>
  );
}
