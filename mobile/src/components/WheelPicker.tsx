import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { colors, typography, glow } from '../theme';

/*
 * Kółko wyboru wartości (jak wybór godziny w iOS) — przewijanie palcem z zatrzaskiem na wartości, dotknięcie wartości ją
 * wybiera, VoiceOver: przesunięcie w górę / w dół. `onChange` — po zatrzymaniu kółka (nie w trakcie przewijania).
 */

const ROW = 44;

const nearest = (values: readonly number[], value: number) => {
  let best = 0;
  values.forEach((entry, index) => { if (Math.abs(entry - value) < Math.abs(values[best] - value)) best = index; });
  return best;
};

export default function WheelPicker({ values, value, onChange, format, accent, rows = 5, width = 160, label }: {
  values: readonly number[];
  value: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
  accent: string;
  /** Liczba widocznych wierszy (nieparzysta). */
  rows?: number;
  width?: number;
  label: string;
}) {
  const half = Math.floor(rows / 2);
  const scroll = useRef<ScrollView>(null);
  const settled = useRef(nearest(values, value));
  const [current, setCurrent] = useState(settled.current);
  const dragEnd = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = values.length - 1;

  // Zmiana z zewnątrz (np. „Bez rabatu”) — kółko przeskakuje na wartość.
  useEffect(() => {
    const index = nearest(values, value);
    if (index === settled.current) return;
    settled.current = index;
    setCurrent(index);
    scroll.current?.scrollTo({ y: index * ROW, animated: false });
  }, [value, values]);

  useEffect(() => () => { if (dragEnd.current) clearTimeout(dragEnd.current); }, []);

  const indexAt = (offset: number) => Math.min(last, Math.max(0, Math.round(offset / ROW)));
  const settle = (index: number) => {
    setCurrent(index);
    if (index === settled.current) return;
    settled.current = index;
    onChange(values[index]);
  };
  const jump = (index: number) => {
    const target = Math.min(last, Math.max(0, index));
    scroll.current?.scrollTo({ y: target * ROW, animated: true });
    settle(target);
  };
  const offsetOf = (event: NativeSyntheticEvent<NativeScrollEvent>) => event.nativeEvent.contentOffset.y;

  return (
    <View style={{ height: ROW * rows, width }}>
      <View pointerEvents="none" style={[styles.band, { top: ROW * half, borderColor: accent, backgroundColor: glow(0.06) }]} />
      <ScrollView
        ref={scroll}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        nestedScrollEnabled
        contentOffset={{ x: 0, y: settled.current * ROW }}
        onLayout={() => scroll.current?.scrollTo({ y: settled.current * ROW, animated: false })}
        contentContainerStyle={{ paddingVertical: ROW * half }}
        scrollEventThrottle={16}
        onScroll={(event) => { const index = indexAt(offsetOf(event)); if (index !== current) setCurrent(index); }}
        onScrollEndDrag={(event) => {
          const offset = offsetOf(event);
          if (dragEnd.current) clearTimeout(dragEnd.current);
          // Bez rozpędu kółko się nie dosuwa — wybór po krótkiej chwili (rozpęd go anuluje i wybiera na końcu).
          dragEnd.current = setTimeout(() => jump(indexAt(offset)), 140);
        }}
        onMomentumScrollBegin={() => { if (dragEnd.current) clearTimeout(dragEnd.current); }}
        onMomentumScrollEnd={(event) => settle(indexAt(offsetOf(event)))}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: format(values[current]) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => jump(current + (event.nativeEvent.actionName === 'increment' ? 1 : -1))}
      >
        {values.map((entry, index) => {
          const distance = Math.abs(index - current);
          return (
            <TouchableOpacity key={entry} style={styles.row} onPress={() => jump(index)} accessible={false}>
              <Text style={[styles.text, { opacity: distance === 0 ? 1 : distance === 1 ? 0.6 : 0.3 }, distance === 0 && [styles.selected, { color: accent }]]}>
                {format(entry)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 0, right: 0, height: ROW, borderTopWidth: 1, borderBottomWidth: 1, borderRadius: 10 },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  selected: { fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold },
});
