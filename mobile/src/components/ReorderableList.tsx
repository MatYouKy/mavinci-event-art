import { useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme';

/*
 * Lista ze zmianą kolejności przez przeciąganie (drag & drop) — zasada aplikacji: każda lista z kolejnością ma przeciąganie,
 * strzałki mogą zostać jako dodatek. Bez dodatkowych bibliotek (PanResponder i Animated z React Native): przeciąga się za
 * uchwyt (`handle` w `renderItem`), pozostałe wiersze robią miejsce, po puszczeniu `onMove(from, to)` — element z pozycji
 * `from` trafia na pozycję `to` (jak `splice`). W czasie przeciągania `onDragChange(true)` — ekran wyłącza przewijanie.
 */

type Layout = { start: number; size: number };

/** Pozycja docelowa przeciąganego elementu (0…n-1) z położenia jego środka względem środków pozostałych elementów. */
export function reorderTarget(layouts: Layout[], from: number, delta: number): number {
  const active = layouts[from];
  if (!active) return from;
  const center = active.start + active.size / 2 + delta;
  let position = 0;
  layouts.forEach((layout, index) => {
    if (index === from) return;
    if (layout.start + layout.size / 2 < center) position += 1;
  });
  return position;
}

/** Przesunięcie wiersza `index`, gdy element `from` jest nad pozycją `to` (wiersze pomiędzy robią miejsce). */
export function reorderShift(index: number, from: number, to: number, distance: number): number {
  if (index === from || from === to) return 0;
  if (from < to && index > from && index <= to) return -distance;
  if (to < from && index >= to && index < from) return distance;
  return 0;
}

type Props<T> = {
  items: T[];
  keyOf: (item: T, index: number) => string;
  /** `handle` — uchwyt do przeciągania (umieść go w wierszu). */
  renderItem: (item: T, index: number, handle: ReactNode) => ReactNode;
  onMove: (from: number, to: number) => void;
  horizontal?: boolean;
  disabled?: boolean;
  gap?: number;
  onDragChange?: (active: boolean) => void;
  style?: StyleProp<ViewStyle>;
};

export default function ReorderableList<T>({ items, keyOf, renderItem, onMove, horizontal = false, disabled = false, gap = 0, onDragChange, style }: Props<T>) {
  const layouts = useRef<Record<string, Layout>>({});
  const offset = useRef(new Animated.Value(0)).current;
  const [drag, setDrag] = useState<{ key: string; from: number; to: number } | null>(null);
  const keys = items.map((item, index) => keyOf(item, index));
  // Najnowsze dane dla uchwytów (PanResponder tworzony raz na wiersz).
  const latest = useRef({ keys, drag, disabled, onMove, onDragChange, horizontal });
  latest.current = { keys, drag, disabled, onMove, onDragChange, horizontal };

  const ordered = () => latest.current.keys.map((key) => layouts.current[key] || { start: 0, size: 0 });

  const start = (key: string) => {
    const from = latest.current.keys.indexOf(key);
    if (from < 0) return;
    offset.setValue(0);
    const value = { key, from, to: from };
    latest.current.drag = value;
    setDrag(value);
    latest.current.onDragChange?.(true);
  };
  const move = (delta: number) => {
    const current = latest.current.drag;
    if (!current) return;
    offset.setValue(delta);
    const to = reorderTarget(ordered(), current.from, delta);
    if (to !== current.to) {
      const value = { ...current, to };
      latest.current.drag = value;
      setDrag(value);
    }
  };
  const finish = () => {
    const current = latest.current.drag;
    latest.current.drag = null;
    setDrag(null);
    offset.setValue(0);
    latest.current.onDragChange?.(false);
    if (current && current.to !== current.from) latest.current.onMove(current.from, current.to);
  };

  const handles = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});
  const responder = (key: string) => {
    if (!handles.current[key]) {
      handles.current[key] = PanResponder.create({
        onStartShouldSetPanResponder: () => !latest.current.disabled,
        onStartShouldSetPanResponderCapture: () => !latest.current.disabled,
        onMoveShouldSetPanResponder: () => !latest.current.disabled,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: () => start(key),
        onPanResponderMove: (_, gesture) => move(latest.current.horizontal ? gesture.dx : gesture.dy),
        onPanResponderRelease: finish,
        onPanResponderTerminate: finish,
      });
    }
    return handles.current[key];
  };

  const activeSize = drag ? layouts.current[drag.key]?.size || 0 : 0;

  return (
    <View style={[{ flexDirection: horizontal ? 'row' : 'column', gap }, style]}>
      {items.map((item, index) => {
        const key = keys[index];
        const active = drag?.key === key;
        const shift = drag ? reorderShift(index, drag.from, drag.to, activeSize + gap) : 0;
        const translate = active ? offset : shift;
        const handle = disabled ? null : (
          <View {...responder(key).panHandlers} hitSlop={8} accessibilityLabel="Przeciągnij, żeby zmienić kolejność"
            style={{ padding: 6, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="menu" size={18} color={active ? colors.primary.gold : colors.text.tertiary} />
          </View>
        );
        return (
          <Animated.View key={key}
            onLayout={(event: LayoutChangeEvent) => {
              const { x, y, width, height } = event.nativeEvent.layout;
              layouts.current[key] = horizontal ? { start: x, size: width } : { start: y, size: height };
            }}
            style={{
              zIndex: active ? 10 : 0,
              elevation: active ? 6 : 0,
              opacity: active ? 0.92 : 1,
              backgroundColor: active ? colors.background.elevated : undefined,
              borderRadius: active ? 8 : 0,
              transform: horizontal ? [{ translateX: translate }] : [{ translateY: translate }],
            }}>
            {renderItem(item, index, handle)}
          </Animated.View>
        );
      })}
    </View>
  );
}
