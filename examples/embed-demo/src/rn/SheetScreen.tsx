import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Button } from './Button';
import { colors } from './tokens';

const PLACES = [
  { name: 'Lorem ipsum', region: 'Lorem ipsum', tone: '#B45309' },
  { name: 'Lorem ipsum', region: 'Lorem ipsum', tone: '#0E7490' },
  { name: 'Lorem ipsum', region: 'Lorem ipsum', tone: '#9D174D' },
  { name: 'Lorem ipsum', region: 'Lorem ipsum', tone: '#166534' },
];

export function SheetScreen() {
  const sheetRef = useRef<BottomSheet>(null);
  const [sheetIndex, setSheetIndex] = useState(-1);
  const [picked, setPicked] = useState(PLACES[0]);
  const snapPoints = useMemo(() => ['25%', '50%', '90%'], []);

  const openFor = useCallback((place: (typeof PLACES)[number]) => {
    setPicked(place);
    sheetRef.current?.snapToIndex(1);
  }, []);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Places</Text>
        <Text style={styles.headerSub}>
          {sheetIndex >= 0 ? `sheet open · snap ${sheetIndex}` : 'sheet closed'}
        </Text>
      </View>

      <View style={styles.list}>
        {PLACES.map((place, i) => (
          <Pressable
            key={i}
            onPress={() => openFor(place)}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            <View style={[styles.dot, { backgroundColor: place.tone }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{place.name}</Text>
              <Text style={styles.rowSub}>{place.region}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.cta}>
        <Button label="Open sheet" onPress={() => sheetRef.current?.snapToIndex(0)} />
      </View>

      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        enablePanDownToClose
        onChange={setSheetIndex}
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.handle}
        backgroundStyle={styles.sheetBg}
      >
        <BottomSheetView style={styles.sheetContent}>
          <Text style={styles.sheetTitle}>{picked!.name}</Text>
          <Text style={styles.sheetRegion}>{picked!.region}</Text>
          <View style={styles.sheetRows}>
            <Text style={styles.sheetRow}>· Drag the handle between 25% / 50% / 90%</Text>
            <Text style={styles.sheetRow}>· Flick down past the last snap to close</Text>
            <Text style={styles.sheetRow}>· Tap the dimmed backdrop to dismiss</Text>
          </View>
          <Button label="Close" variant="secondary" onPress={() => sheetRef.current?.close()} />
        </BottomSheetView>
      </BottomSheet>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F4F8' } as ViewStyle,
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 } as ViewStyle,
  headerTitle: { fontSize: 26, fontWeight: '700', color: colors.ink } as TextStyle,
  headerSub: { fontSize: 13, color: '#6B7280', marginTop: 2 } as TextStyle,
  list: { paddingHorizontal: 12, gap: 8 } as ViewStyle,
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  } as ViewStyle,
  rowPressed: { backgroundColor: '#EEF0F6' } as ViewStyle,
  dot: { width: 34, height: 34, borderRadius: 17 } as ViewStyle,
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.ink } as TextStyle,
  rowSub: { fontSize: 12.5, color: '#6B7280', marginTop: 1 } as TextStyle,
  chevron: { fontSize: 22, color: '#9CA3AF' } as TextStyle,
  cta: { marginTop: 'auto' as never, padding: 16 } as ViewStyle,
  handle: { backgroundColor: '#C7CBD6', width: 44 } as ViewStyle,
  sheetBg: { backgroundColor: '#FFFFFF', borderRadius: 18 } as ViewStyle,
  sheetContent: { flex: 1, paddingHorizontal: 20, paddingTop: 6, gap: 10 } as ViewStyle,
  sheetTitle: { fontSize: 21, fontWeight: '700', color: colors.ink } as TextStyle,
  sheetRegion: { fontSize: 14, color: '#6B7280' } as TextStyle,
  sheetRows: { gap: 6, paddingVertical: 6 } as ViewStyle,
  sheetRow: { fontSize: 13.5, color: '#374151' } as TextStyle,
});
