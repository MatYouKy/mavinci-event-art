import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated, FlatList, PanResponder, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, shade, tone } from '../theme';
import { INQUIRY_STAGES, formatInquiryMoney, stageOf, weightedValue, type FunnelInquiry, type InquiryStageId } from '../lib/inquiryFunnel';

/*
 * Lejek zapytań na tablecie — kolumny etapów jak w CRM i na Macu, przeciąganie karty do innego etapu (drag & drop palcem): karta
 * łapana za uchwyt ≡ (tylko zapytania, którymi pracownik zarządza), podąża za palcem, kolumna pod palcem się podświetla, przy
 * krawędzi tablica przewija się sama; po puszczeniu — `onDrop(zapytanie, etap)`. Bez dodatkowych bibliotek (PanResponder, Animated).
 */

const COLUMN_WIDTH = 304;
const EDGE = 64;
const SCROLL_STEP = 14;

type Drag = { inquiry: FunnelInquiry; width: number; height: number; grabX: number; grabY: number };

/**
 * Uchwyt ≡ karty: dotyk od razu zaczyna przeciąganie (przewijanie listy działa poza uchwytem). Wspólny dla lejka zapytań
 * i tablicy zadań (`TasksScreen`).
 */
export function BoardGrip({ onGrant, onMove, onRelease, label, hint = 'Przeciągnij kartę do innego etapu' }: {
  onGrant: (pageX: number, pageY: number) => void;
  onMove: (pageX: number, pageY: number) => void;
  onRelease: (cancelled: boolean) => void;
  label: string;
  hint?: string;
}) {
  const latest = useRef({ onGrant, onMove, onRelease });
  latest.current = { onGrant, onMove, onRelease };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => latest.current.onGrant(event.nativeEvent.pageX, event.nativeEvent.pageY),
    onPanResponderMove: (event) => latest.current.onMove(event.nativeEvent.pageX, event.nativeEvent.pageY),
    onPanResponderRelease: () => latest.current.onRelease(false),
    onPanResponderTerminate: () => latest.current.onRelease(true),
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), []);
  return (
    <View {...responder.panHandlers} style={styles.grip} accessibilityLabel={label} accessibilityHint={hint}>
      <Feather name="menu" size={16} color={colors.text.tertiary} />
    </View>
  );
}

export default function InquiryBoard({ inquiries, canDrag, renderCard, onDrop, onDragChange, header }: {
  inquiries: FunnelInquiry[];
  canDrag: (inquiry: FunnelInquiry) => boolean;
  /** Karta zapytania; `grip` — uchwyt do przeciągania (tylko gdy wolno przenosić), `ref` — pomiar karty na starcie przeciągania. */
  renderCard: (inquiry: FunnelInquiry, grip: ReactNode | null) => ReactNode;
  onDrop: (inquiry: FunnelInquiry, stage: InquiryStageId) => void;
  onDragChange?: (active: boolean) => void;
  header?: ReactNode;
}) {
  const root = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const cards = useRef<Record<string, View | null>>({});
  const rootFrame = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const columns = useRef<Record<string, { x: number; width: number }>>({});
  const scrollX = useRef(0);
  const contentWidth = useRef(0);
  const lastPoint = useRef({ x: 0, y: 0 });
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  const pan = useRef(new Animated.ValueXY()).current;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [target, setTarget] = useState<InquiryStageId | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const targetRef = useRef<InquiryStageId | null>(null);

  const byStage = useMemo(() => {
    const map = new Map<string, FunnelInquiry[]>();
    INQUIRY_STAGES.forEach((stage) => map.set(stage.id, []));
    inquiries.forEach((inquiry) => map.get(stageOf(inquiry.stage).id)?.push(inquiry));
    return map;
  }, [inquiries]);

  useEffect(() => () => { if (autoScroll.current) clearInterval(autoScroll.current); }, []);

  const measureRoot = useCallback(() => {
    root.current?.measureInWindow((x, y, width, height) => { rootFrame.current = { x, y, width, height }; });
  }, []);

  /** Etap pod palcem (położenie w treści tablicy = punkt na ekranie − ramka tablicy + przewinięcie). */
  const stageAt = (pageX: number): InquiryStageId | null => {
    const x = pageX - rootFrame.current.x + scrollX.current;
    const found = INQUIRY_STAGES.find((stage) => {
      const column = columns.current[stage.id];
      return column && x >= column.x && x < column.x + column.width;
    });
    return found?.id ?? null;
  };

  const updateTarget = (pageX: number) => {
    const next = stageAt(pageX);
    if (next !== targetRef.current) { targetRef.current = next; setTarget(next); }
  };

  const stopAutoScroll = () => { if (autoScroll.current) { clearInterval(autoScroll.current); autoScroll.current = null; } };
  const ensureAutoScroll = (pageX: number) => {
    const local = pageX - rootFrame.current.x;
    const speed = local < EDGE ? -SCROLL_STEP : local > rootFrame.current.width - EDGE ? SCROLL_STEP : 0;
    if (!speed) { stopAutoScroll(); return; }
    if (autoScroll.current) return;
    autoScroll.current = setInterval(() => {
      const point = lastPoint.current.x - rootFrame.current.x;
      const step = point < EDGE ? -SCROLL_STEP : point > rootFrame.current.width - EDGE ? SCROLL_STEP : 0;
      if (!step) { stopAutoScroll(); return; }
      const max = Math.max(0, contentWidth.current - rootFrame.current.width);
      const next = Math.max(0, Math.min(max, scrollX.current + step));
      if (next === scrollX.current) return;
      scrollX.current = next;
      scroll.current?.scrollTo({ x: next, animated: false });
      updateTarget(lastPoint.current.x);
    }, 16);
  };

  const start = (inquiry: FunnelInquiry, pageX: number, pageY: number) => {
    measureRoot();
    const card = cards.current[inquiry.id];
    const begin = (x: number, y: number, width: number, height: number) => {
      const next: Drag = { inquiry, width, height, grabX: pageX - x, grabY: pageY - y };
      dragRef.current = next;
      setDrag(next);
      lastPoint.current = { x: pageX, y: pageY };
      pan.setValue({ x: pageX - rootFrame.current.x - next.grabX, y: pageY - rootFrame.current.y - next.grabY });
      targetRef.current = stageOf(inquiry.stage).id;
      setTarget(targetRef.current);
      onDragChange?.(true);
    };
    if (card) card.measureInWindow((x, y, width, height) => begin(x, y, width || COLUMN_WIDTH - 24, height || 120));
    else begin(pageX - 20, pageY - 20, COLUMN_WIDTH - 24, 120);
  };

  const move = (pageX: number, pageY: number) => {
    const current = dragRef.current;
    if (!current) return;
    lastPoint.current = { x: pageX, y: pageY };
    pan.setValue({ x: pageX - rootFrame.current.x - current.grabX, y: pageY - rootFrame.current.y - current.grabY });
    updateTarget(pageX);
    ensureAutoScroll(pageX);
  };

  const finish = (cancelled: boolean) => {
    stopAutoScroll();
    const current = dragRef.current;
    const stage = targetRef.current;
    dragRef.current = null;
    targetRef.current = null;
    setDrag(null);
    setTarget(null);
    onDragChange?.(false);
    if (!cancelled && current && stage && stage !== stageOf(current.inquiry.stage).id) onDrop(current.inquiry, stage);
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => { scrollX.current = event.nativeEvent.contentOffset.x; };

  return (
    <View ref={root} style={styles.root} onLayout={measureRoot}>
      {header}
      <ScrollView ref={scroll} horizontal scrollEnabled={!drag} onScroll={onScroll} scrollEventThrottle={16}
        onContentSizeChange={(width) => { contentWidth.current = width; }} contentContainerStyle={styles.board} showsHorizontalScrollIndicator>
        {INQUIRY_STAGES.map((stage) => {
          const items = byStage.get(stage.id) || [];
          const value = items.reduce((sum, inquiry) => sum + (inquiry.estimatedValue || 0), 0);
          const weighted = items.reduce((sum, inquiry) => sum + weightedValue(inquiry), 0);
          const active = Boolean(drag) && target === stage.id;
          return (
            <View key={stage.id} style={[styles.column, active && { borderColor: tone(stage.color), backgroundColor: shade(0.3) }]}
              onLayout={(event: LayoutChangeEvent) => { columns.current[stage.id] = { x: event.nativeEvent.layout.x, width: event.nativeEvent.layout.width }; }}
              accessibilityLabel={`${stage.label}: ${items.length}`}>
              <View style={styles.columnHead}>
                <View style={[styles.dot, { backgroundColor: tone(stage.color) }]} />
                <Text style={styles.columnTitle} numberOfLines={1}>{stage.label}</Text>
                <Text style={styles.count}>{items.length}</Text>
              </View>
              {value > 0 ? (
                <Text style={styles.columnValue}>{formatInquiryMoney(value)}{weighted > 0 && weighted !== value ? ` · ważona ${formatInquiryMoney(weighted)}` : ''}</Text>
              ) : null}
              <FlatList
                data={items}
                keyExtractor={(inquiry) => inquiry.id}
                scrollEnabled={!drag}
                contentContainerStyle={styles.cards}
                ListEmptyComponent={<Text style={styles.empty}>{drag ? 'Upuść tutaj' : 'Brak zapytań'}</Text>}
                renderItem={({ item }) => (
                  <View ref={(view) => { cards.current[item.id] = view; }} collapsable={false}
                    style={drag?.inquiry.id === item.id ? styles.lifted : undefined}>
                    {renderCard(item, canDrag(item) ? (
                      <BoardGrip label={`Przenieś: ${item.titleLabel}`} onGrant={(x, y) => start(item, x, y)} onMove={move} onRelease={finish} />
                    ) : null)}
                  </View>
                )}
              />
            </View>
          );
        })}
      </ScrollView>
      {drag ? (
        <Animated.View pointerEvents="none" style={[styles.ghost, { width: drag.width, transform: [...pan.getTranslateTransform(), { scale: 1.03 }] }]}>
          <Text style={styles.ghostTitle} numberOfLines={2}>{drag.inquiry.titleLabel}</Text>
          <Text style={styles.ghostDetail} numberOfLines={1}>
            {target ? `→ ${stageOf(target).label}` : stageOf(drag.inquiry.stage).label}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  board: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  column: {
    width: COLUMN_WIDTH, flex: 1, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.08), backgroundColor: shade(0.18),
    paddingTop: spacing.sm,
  },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  count: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  columnValue: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, paddingHorizontal: spacing.sm, marginTop: 2 },
  cards: { gap: spacing.sm, padding: spacing.sm, paddingBottom: spacing.xl },
  empty: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm, textAlign: 'center', paddingVertical: spacing.lg },
  grip: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: glow(0.06) },
  lifted: { opacity: 0.35 },
  ghost: {
    position: 'absolute', left: 0, top: 0, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated,
    borderWidth: 1, borderColor: colors.primary.gold, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  ghostTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  ghostDetail: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, marginTop: 4 },
});
