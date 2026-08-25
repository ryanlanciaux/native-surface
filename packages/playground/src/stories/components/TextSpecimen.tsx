import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextSpecimenProps {
  sample: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  align?: TextAlign;
  numberOfLines?: number;
  showScale?: boolean;
  showSpans?: boolean;
}

const WEIGHTS: Array<{ label: string; weight: TextStyle['fontWeight'] }> = [
  { label: 'Regular 400', weight: '400' },
  { label: 'Medium 500', weight: '500' },
  { label: 'SemiBold 600', weight: '600' },
  { label: 'Bold 700', weight: '700' },
];

const SCALE: Array<{ label: string; size: number }> = [
  { label: 'Caption', size: 12 },
  { label: 'Body', size: 15 },
  { label: 'Title', size: 22 },
  { label: 'Display', size: 30 },
];

const styles = StyleSheet.create({
  page: { padding: 16, backgroundColor: '#ffffff', gap: 18 },
  section: { gap: 6 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#94a3b8',
  },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  meta: { fontSize: 11, color: '#94a3b8', width: 84 },
  // Shrinks inside the label rows so numberOfLines can ellipsize instead of
  // overflowing the row (RN text does not shrink by default).
  body: { color: '#0f172a', flexShrink: 1 },
  clamped: {
    borderLeftWidth: 3,
    borderColor: '#c7d2fe',
    paddingLeft: 10,
  },
  link: { color: '#2563eb', textDecorationLine: 'underline' },
  strike: { color: '#94a3b8', textDecorationLine: 'line-through' },
  italic: { fontStyle: 'italic' },
  highlight: { color: '#b45309', fontWeight: '700' },
} satisfies Record<string, ViewStyle | TextStyle>);

export function TextSpecimen(props: TextSpecimenProps): React.JSX.Element {
  const {
    sample,
    fontSize = 15,
    lineHeight = 22,
    letterSpacing = 0,
    align = 'left',
    numberOfLines = 2,
    showScale = true,
    showSpans = true,
  } = props;

  const base: TextStyle = { fontSize, lineHeight, letterSpacing, textAlign: align };

  return (
    <View style={styles.page}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>WEIGHTS</Text>
        {WEIGHTS.map((entry) => (
          <View key={entry.label} style={styles.row}>
            <Text style={styles.meta}>{entry.label}</Text>
            <Text style={[styles.body, base, { fontWeight: entry.weight }]} numberOfLines={1}>
              {sample}
            </Text>
          </View>
        ))}
      </View>

      {showScale ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SCALE</Text>
          {SCALE.map((entry) => (
            <View key={entry.label} style={styles.row}>
              <Text style={styles.meta}>
                {entry.label} {entry.size}
              </Text>
              <Text style={[styles.body, { fontSize: entry.size, textAlign: align }]} numberOfLines={1}>
                {sample}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>NUMBEROFLINES = {String(numberOfLines)}</Text>
        <Text style={[styles.body, styles.clamped, base]} numberOfLines={numberOfLines}>
          {sample} {sample} {sample} {sample} {sample}
        </Text>
      </View>

      {showSpans ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>NESTED SPANS</Text>
          <Text style={[styles.body, base]}>
            Inheritance flows down: <Text style={styles.highlight}>bold amber</Text>, an{' '}
            <Text style={styles.italic}>italic aside</Text>, a <Text style={styles.link}>link</Text>, and{' '}
            <Text style={styles.strike}>struck-through</Text> text — all one paragraph, one measure pass.
          </Text>
        </View>
      ) : null}
    </View>
  );
}
