import React, { useMemo, useRef, type ReactNode } from 'react';
import { Animated, Modal, PanResponder, StyleSheet, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../theme';

/*
 * Szuflada szczegółów na osi czasu (telefon): wysuwa się z dołu, zamyka ją przeciągnięcie uchwytu (kreski u góry) w dół,
 * dotknięcie tła albo „wstecz” (Android). Krótkie przeciągnięcie wraca szufladę na miejsce, tło jaśnieje razem z gestem.
 * Używają jej `CalendarTimeline` (Spotkania, Kalendarz) i `TeamAvailabilityTimeline` (Spotkania → „Pracownicy”).
 */

/** Odległość (pt) przeciągnięcia w dół, która zamyka szufladę — przy niskiej szufladzie mniej (30% jej wysokości). */
const CLOSE_DISTANCE = 90;
/** Szybkie pociągnięcie w dół zamyka niezależnie od odległości. */
const CLOSE_VELOCITY = 0.9;

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Wygląd szuflady (tło, zaokrąglenie, odstęp od dołu ekranu). */
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export default function TimelineSheet({ visible, onClose, style, children }: Props) {
  const drag = useRef(new Animated.Value(0)).current;
  const height = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Ponowne otwarcie po zamknięciu gestem: szuflada od razu na swoim miejscu (gest zostawił ją poniżej ekranu).
  const shown = useRef(visible);
  if (visible && !shown.current) drag.setValue(0);
  shown.current = visible;
  // Treść z chwili zamknięcia zostaje w szufladzie, dopóki okno się chowa (rodzic czyści wybraną pozycję od razu).
  const content = useRef<ReactNode>(children);
  if (visible) content.current = children;

  const pan = useMemo(() => {
    const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => drag.stopAnimation(),
      onPanResponderMove: (_event, gesture) => drag.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        const distance = Math.min(CLOSE_DISTANCE, Math.max(48, height.current * 0.3));
        if (gesture.dy > distance || (gesture.dy > 12 && gesture.vy > CLOSE_VELOCITY)) {
          Animated.timing(drag, { toValue: Math.max(height.current, 300), duration: 160, useNativeDriver: true })
            .start(() => closeRef.current());
        } else {
          settle();
        }
      },
      onPanResponderTerminate: settle,
    });
  }, [drag]);

  const backdropOpacity = useMemo(
    () => drag.interpolate({ inputRange: [0, 400], outputRange: [1, 0], extrapolate: 'clamp' }),
    [drag],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.root}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]} />
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij szczegóły" />
        <Animated.View style={[style, { transform: [{ translateY: drag }] }]}
          onLayout={(event) => { height.current = event.nativeEvent.layout.height; }}>
          <View {...pan.panHandlers} style={styles.handle} accessible accessibilityRole="button" accessibilityLabel="Zamknij szczegóły"
            accessibilityHint="Przeciągnij uchwyt w dół, aby zamknąć" onAccessibilityTap={onClose}>
            <View style={styles.grabber} />
          </View>
          {visible ? children : content.current}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.45)' },
  // Pas na całą szerokość szuflady — łatwo trafić palcem w okolicę kreski.
  handle: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', height: 28, marginTop: -6, marginBottom: 2 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border.hover },
});
