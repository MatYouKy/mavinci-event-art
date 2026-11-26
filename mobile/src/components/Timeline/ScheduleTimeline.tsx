import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import EmployeeAvatar from '../EmployeeAvatar';
import { Segmented } from '../Inquiries/InquiryKit';
import { useContentWidth, useTabletLayout } from '../../hooks/useTabletLayout';
import { colors, spacing } from '../../theme';
import {
  HOUR, TIMELINE_SCALES, TIMELINE_ZOOMS, WEEKDAYS_SHORT, assignLanes, formatClock, formatEntryTime, isSameDay, shiftAnchor, timelineRange,
  timelineRangeLabel, timelineScaleLabel, withOpacity,
  type TimelineEntry, type TimelineRow, type TimelineZoom,
} from '../../lib/scheduleTimeline';

/*
 * Oś czasu w aplikacji — dzień (godziny), tydzień (pn–nd) i miesiąc (dni), jak osie czasu zespołu i floty w CRM. Z wierszami
 * (pracownik, auto) — stała kolumna nazw po lewej i pozycje każdego wiersza w torach; bez wierszy (spotkania, eventy) — jeden
 * wspólny tor. Długość paska odpowiada czasowi (30 minut — połowa godziny; najkrótsze mają kilka punktów, żeby dało się je
 * dotknąć), nazwa i godziny mieszczą się w pasku, gdy jest dość szeroki; tory pilnują, żeby pozycje w tym samym czasie się nie
 * zasłaniały. „Lupka” (− / +) powiększa kolumny (1×–4×) wokół środka widoku albo zaznaczonej pozycji. Dotknięcie pozycji
 * zaznacza ją i pod osią pokazuje szczegóły (godziny, fakty ekranu, opis) z działaniami ekranu; „‹ ›” — poprzednia / następna
 * pozycja w zakresie. Dotknięcie nagłówka dnia — widok tego dnia. Przewijanie w poziomie, linia „teraz”, dziś podświetlony.
 */

type FeatherName = React.ComponentProps<typeof Feather>['name'];
/** Ikona faktu albo działania w szczegółach (Feather). */
export type TimelineIcon = FeatherName;

/** Działanie przy zaznaczonej pozycji (np. „Otwórz event”). */
export type TimelineDetailAction = { label: string; icon?: FeatherName; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean };

/** Szczegóły zaznaczonej pozycji — godziny dokłada oś; ekran podaje plakietkę, fakty, opis i działania. */
export type TimelineDetails = {
  badge?: { label: string; color: string } | null;
  facts?: ReadonlyArray<{ icon: FeatherName; text: string } | null | false | undefined>;
  description?: string | null;
  actions?: ReadonlyArray<TimelineDetailAction | null | false | undefined>;
};

type Props<E extends TimelineEntry> = {
  zoom: TimelineZoom;
  onZoomChange: (zoom: TimelineZoom) => void;
  anchor: Date;
  onAnchorChange: (anchor: Date) => void;
  /** Powiększenie (`TIMELINE_SCALES`). */
  scale: number;
  onScaleChange: (scale: number) => void;
  entries: E[];
  /** Wiersze (pracownicy, auta); bez nich — wspólny tor. */
  rows?: TimelineRow[] | null;
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  /** Szczegóły i działania zaznaczonej pozycji (pod osią). */
  details?: (entry: E) => TimelineDetails;
  refreshing?: boolean;
  onRefresh?: () => void;
  legend?: ReadonlyArray<{ label: string; color: string }>;
};

const HEADER = 40;
const LANE = 48;
const BAR = 42;
const PAD = 6;
const MIN_ROW = 60;
const MIN_SHARED = PAD * 2 + LANE * 2;
/** Najkrótszy pasek (px) i szerokości, od których mieści się nazwa i druga linia (godziny). */
const MIN_BAR = 8;
const TITLE_WIDTH = 34;
const META_WIDTH = 84;

/** Czytelny tekst na kolorze pozycji (jasne kolory — ciemny tekst). */
function textOn(color: string): string {
  const hex = (color || '').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#ffffff';
  const value = Number.parseInt(full, 16);
  const luminance = (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luminance > 0.62 ? '#14110a' : '#ffffff';
}

const pad2 = (value: number) => String(value).padStart(2, '0');

/** Druga linia paska: godziny (albo „cały dzień”, „od 14.11”) i opis pozycji. */
function barMeta(entry: TimelineEntry, rangeStart: number): string {
  const start = new Date(entry.start);
  const end = new Date(entry.end);
  let time: string;
  if (entry.start < rangeStart) time = `od ${pad2(start.getDate())}.${pad2(start.getMonth() + 1)}`;
  else if (entry.allDay) time = isSameDay(start, new Date(entry.end - 1)) ? 'cały dzień' : `do ${pad2(new Date(entry.end - 1).getDate())}.${pad2(new Date(entry.end - 1).getMonth() + 1)}`;
  else if (isSameDay(start, end) || entry.end - entry.start < 24 * HOUR) time = `${formatClock(start)}–${formatClock(end)}`;
  else time = `${formatClock(start)} → ${pad2(end.getDate())}.${pad2(end.getMonth() + 1)}`;
  return entry.subtitle ? `${time} · ${entry.subtitle}` : time;
}

type Placed<E> = { entry: E; start: number; end: number; lane: number; left: number; width: number; row: string };

export default function ScheduleTimeline<E extends TimelineEntry>({
  zoom, onZoomChange, anchor, onAnchorChange, scale, onScaleChange, entries, rows, loading, error, emptyText, details, refreshing, onRefresh, legend,
}: Props<E>) {
  const contentWidth = useContentWidth();
  const { height: windowHeight } = useWindowDimensions();
  const { tablet } = useTabletLayout();
  const horizontal = useRef<ScrollView>(null);
  const vertical = useRef<ScrollView>(null);
  const scrollX = useRef(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const labelWidth = rows ? (tablet ? 200 : 124) : 0;
  const available = Math.max(240, contentWidth - labelWidth);
  const { start, end, days } = timelineRange(zoom, anchor);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const columns = zoom === 'day' ? 24 : days.length;
  const minColumn = zoom === 'day' ? (tablet ? 40 : 52) : zoom === 'week' ? (tablet ? 90 : 92) : tablet ? 28 : 36;
  const columnWidth = Math.max(minColumn, available / columns) * scale;
  const totalWidth = columnWidth * columns;
  const pxPerMs = totalWidth / (endMs - startMs);
  /** Pasek w skali czasu; najkrótszy ma kilka punktów (da się go dotknąć, szczegóły pod osią). */
  const minBar = MIN_BAR;
  const now = Date.now();
  const nowX = now >= startMs && now < endMs ? (now - startMs) * pxPerMs : null;

  // Pozycje w zakresie, przycięte do jego granic, w torach (każda co najmniej `minBar` px — krótkie się nie zasłaniają).
  const laid = useMemo(() => {
    const visible = entries
      .filter((entry) => entry.end > startMs && entry.start < endMs)
      .map((entry) => ({ entry, start: Math.max(entry.start, startMs), end: Math.min(entry.end, endMs) }));
    const groups = new Map<string, typeof visible>();
    for (const item of visible) {
      const key = rows ? String(item.entry.rowId ?? '') : '__all';
      const group = groups.get(key);
      if (group) group.push(item); else groups.set(key, [item]);
    }
    const lanes = new Map<string, Placed<E>[]>();
    let right = 0;
    groups.forEach((group, key) => {
      lanes.set(key, assignLanes(group, (minBar + 4) / pxPerMs).map(({ item, lane }) => {
        const left = (item.start - startMs) * pxPerMs + 1;
        const width = Math.max(minBar, (item.end - item.start) * pxPerMs - 2);
        right = Math.max(right, left + width);
        return { ...item, lane, left, width, row: key };
      }));
    });
    const order = Array.from(lanes.values()).flat().sort((a, b) => a.entry.start - b.entry.start || a.entry.end - b.entry.end);
    return { lanes, order, right };
  }, [entries, startMs, endMs, pxPerMs, rows, minBar]);

  const rowList: TimelineRow[] = rows ?? [{ id: '__all', label: '' }];
  const heights = rowList.map((row) => {
    const placed = laid.lanes.get(rows ? row.id : '__all') ?? [];
    const laneCount = placed.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    return Math.max(rows ? MIN_ROW : MIN_SHARED, PAD * 2 + laneCount * LANE);
  });
  const width = Math.max(totalWidth, laid.right + 8);
  const selectedIndex = selectedId ? laid.order.findIndex((item) => item.entry.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? laid.order[selectedIndex] : null;

  const scrollToX = (x: number) => {
    const target = Math.max(0, Math.min(x, Math.max(0, width - available)));
    scrollX.current = target;
    horizontal.current?.scrollTo({ x: target, animated: true });
  };

  // Po zmianie zakresu: dzień — od 7:00 (dziś: godzinę przed „teraz”), tydzień i miesiąc — dziś na początku widoku.
  useEffect(() => {
    let x = 0;
    if (zoom === 'day') {
      const hour = nowX != null ? Math.max(0, new Date(now).getHours() - 1) : 7;
      x = hour * columnWidth;
    } else if (nowX != null) {
      x = Math.max(0, Math.floor((now - startMs) / (24 * HOUR)) * columnWidth - columnWidth);
    }
    const timer = setTimeout(() => {
      const target = Math.min(x, Math.max(0, totalWidth - available));
      scrollX.current = target;
      horizontal.current?.scrollTo({ x: target, animated: false });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, startMs]);

  // „Lupka”: po zmianie powiększenia w widoku zostaje zaznaczona pozycja albo to, co było na środku.
  const lastScale = useRef(scale);
  useEffect(() => {
    const ratio = scale / lastScale.current;
    lastScale.current = scale;
    if (ratio === 1) return;
    const center = selected ? selected.left + selected.width / 2 : (scrollX.current + available / 2) * ratio;
    const timer = setTimeout(() => scrollToX(center - available / 2), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  /** Poprzednia / następna pozycja: zaznaczenie i przewinięcie do niej (w poziomie i do wiersza). */
  const focus = (index: number) => {
    const item = laid.order[index];
    if (!item) return;
    setSelectedId(item.entry.id);
    if (item.left < scrollX.current || item.left + Math.min(item.width, available) > scrollX.current + available) scrollToX(item.left - 16);
    if (rows) {
      const rowIndex = rowList.findIndex((row) => row.id === item.row);
      const y = heights.slice(0, Math.max(0, rowIndex)).reduce((sum, value) => sum + value, 0);
      vertical.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    }
  };

  const zoomIndex = (TIMELINE_SCALES as readonly number[]).indexOf(scale);
  const changeScale = (direction: -1 | 1) => {
    const next = TIMELINE_SCALES[Math.max(0, Math.min(TIMELINE_SCALES.length - 1, (zoomIndex < 0 ? 0 : zoomIndex) + direction))];
    if (next !== scale) onScaleChange(next);
  };

  const headerCell = (index: number) => {
    if (zoom === 'day') {
      return (
        <View key={index} style={[styles.headerCell, { width: columnWidth }]}>
          <Text style={styles.headerText}>{pad2(index)}{scale >= 2 ? ':00' : ''}</Text>
        </View>
      );
    }
    const day = days[index];
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const today = isSameDay(day, now);
    return (
      <TouchableOpacity key={index} onPress={() => { onAnchorChange(day); onZoomChange('day'); }}
        style={[styles.headerCell, { width: columnWidth }, weekend && styles.weekend, today && styles.todayHeader]}
        accessibilityRole="button" accessibilityLabel={`Pokaż dzień ${day.getDate()}`}>
        {zoom === 'week' || columnWidth >= 64 ? (
          <Text style={[styles.headerText, today && styles.todayText]} numberOfLines={1}>{WEEKDAYS_SHORT[day.getDay()]} {day.getDate()}</Text>
        ) : (
          <>
            <Text style={[styles.headerText, today && styles.todayText]}>{day.getDate()}</Text>
            <Text style={[styles.headerSmall, today && styles.todayText]}>{WEEKDAYS_SHORT[day.getDay()].charAt(0)}</Text>
          </>
        )}
      </TouchableOpacity>
    );
  };

  const grid = (height: number) => (
    <View style={[StyleSheet.absoluteFill, styles.gridRow]} pointerEvents="none">
      {Array.from({ length: columns }, (_, index) => {
        const day = zoom === 'day' ? null : days[index];
        const weekend = day ? day.getDay() === 0 || day.getDay() === 6 : false;
        const today = day ? isSameDay(day, now) : false;
        return <View key={index} style={[styles.gridCell, { width: columnWidth, height }, weekend && styles.weekend, today && styles.todayColumn]} />;
      })}
    </View>
  );

  const info = selected ? (details ? details(selected.entry) : { facts: selected.entry.subtitle ? [{ icon: 'info' as FeatherName, text: selected.entry.subtitle }] : [] }) : null;
  const facts = info ? (info.facts ?? []).filter((fact): fact is { icon: FeatherName; text: string } => Boolean(fact && fact.text)) : [];
  const actions = info ? (info.actions ?? []).filter((action): action is TimelineDetailAction => Boolean(action)) : [];

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => onAnchorChange(shiftAnchor(zoom, anchor, -1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Poprzedni okres">
            <Feather name="chevron-left" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onAnchorChange(new Date())} style={styles.todayButton} accessibilityRole="button">
            <Text style={styles.todayButtonText}>Dziś</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onAnchorChange(shiftAnchor(zoom, anchor, 1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Następny okres">
            <Feather name="chevron-right" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.rangeLabel} numberOfLines={1}>{timelineRangeLabel(zoom, anchor)}</Text>
          {loading ? <ActivityIndicator size="small" color={colors.primary.gold} /> : null}
        </View>
        <View style={styles.zoomRow}>
          <View style={styles.flex}>
            <Segmented value={zoom} options={TIMELINE_ZOOMS} onChange={onZoomChange} />
          </View>
          <View style={styles.magnifier}>
            <TouchableOpacity onPress={() => changeScale(-1)} disabled={zoomIndex <= 0} style={[styles.magnifierButton, zoomIndex <= 0 && styles.disabled]}
              accessibilityRole="button" accessibilityLabel="Pomniejsz oś czasu">
              <Feather name="zoom-out" size={18} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.magnifierText}>{timelineScaleLabel(scale)}</Text>
            <TouchableOpacity onPress={() => changeScale(1)} disabled={zoomIndex >= TIMELINE_SCALES.length - 1}
              style={[styles.magnifierButton, zoomIndex >= TIMELINE_SCALES.length - 1 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Powiększ oś czasu">
              <Feather name="zoom-in" size={18} color={colors.text.primary} />
            </TouchableOpacity>
          </View>
        </View>
        {legend?.length ? (
          <View style={styles.legend}>
            {legend.map((item) => (
              <View key={item.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {!loading && !error && laid.order.length === 0 ? <Text style={styles.empty}>{emptyText || 'Brak pozycji w tym okresie.'}</Text> : null}
      </View>

      {/* Oś: tyle wysokości, ile treści (szczegóły pod nią); przy wielu wierszach przewija się, a szczegóły zostają na dole. */}
      <ScrollView ref={vertical} style={styles.verticalScroll} contentContainerStyle={styles.verticalContent}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary.gold} /> : undefined}>
        <View style={styles.body}>
          {rows ? (
            <View style={[styles.labels, { width: labelWidth }]}>
              <View style={[styles.labelHeader, { height: HEADER }]} />
              {rowList.map((row, index) => (
                <View key={row.id} style={[styles.labelCell, { height: heights[index] }, selected?.row === row.id && styles.labelSelected]}>
                  {row.icon ? (
                    <View style={styles.iconCircle}><Feather name={row.icon} size={14} color={colors.primary.gold} /></View>
                  ) : (
                    <EmployeeAvatar avatarUrl={row.avatarUrl ?? null} avatarMetadata={(row.avatarMetadata as any) ?? null} employeeName={row.label} size={28} />
                  )}
                  <View style={styles.flex}>
                    <Text style={styles.labelText} numberOfLines={2}>{row.label}</Text>
                    {row.sublabel ? <Text style={styles.labelSub} numberOfLines={1}>{row.sublabel}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          <ScrollView ref={horizontal} horizontal showsHorizontalScrollIndicator style={styles.flex} scrollEventThrottle={32}
            onScroll={(event) => { scrollX.current = event.nativeEvent.contentOffset.x; }}>
            <View style={{ width }}>
              <View style={[styles.headerRow, { height: HEADER }]}>
                {Array.from({ length: columns }, (_, index) => headerCell(index))}
              </View>
              {rowList.map((row, index) => {
                const placed = laid.lanes.get(rows ? row.id : '__all') ?? [];
                return (
                  <View key={row.id} style={[styles.track, { height: heights[index], width }]}>
                    {grid(heights[index])}
                    {placed.map((item) => {
                      const { entry } = item;
                      const active = selected?.entry.id === entry.id;
                      const foreground = entry.dimmed ? colors.text.secondary : textOn(entry.color);
                      return (
                        <TouchableOpacity key={entry.id} onPress={() => setSelectedId(active ? null : entry.id)} activeOpacity={0.8}
                          style={[styles.bar, {
                            left: item.left, width: item.width, top: PAD + item.lane * LANE,
                            backgroundColor: withOpacity(entry.color, entry.dimmed ? 0.28 : 0.94),
                            borderColor: active ? colors.text.primary : withOpacity(entry.color, 1),
                          }, active && styles.barActive, selected && !active && styles.barMuted]}
                          accessibilityRole="button" accessibilityState={{ selected: active }}
                          accessibilityLabel={`${entry.title}, ${formatEntryTime(entry)}${entry.subtitle ? `, ${entry.subtitle}` : ''}`}>
                          {item.width >= TITLE_WIDTH ? (
                            <Text style={[styles.barTitle, { color: foreground }, entry.dimmed && styles.dimmedText]} numberOfLines={1}>{entry.title}</Text>
                          ) : null}
                          {item.width >= META_WIDTH ? <Text style={[styles.barMeta, { color: foreground }]} numberOfLines={1}>{barMeta(entry, startMs)}</Text> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
              {nowX != null ? <View pointerEvents="none" style={[styles.nowLine, { left: nowX }]} /> : null}
            </View>
          </ScrollView>
        </View>
        {!selected && laid.order.length ? (
          <Text style={styles.hint}>Dotknij pozycji, żeby zobaczyć szczegóły i działania. Lupka powiększa oś.</Text>
        ) : null}
      </ScrollView>

      {selected && info ? (
        <View style={styles.panel} accessibilityLiveRegion="polite">
          <View style={[styles.panelStripe, { backgroundColor: selected.entry.color }]} />
          <View style={styles.panelBody}>
            <View style={styles.panelHead}>
              <View style={styles.flex}>
                <Text style={[styles.panelTitle, selected.entry.dimmed && styles.dimmedText]} numberOfLines={2}>{selected.entry.title}</Text>
                {info.badge ? (
                  <View style={[styles.badge, { backgroundColor: withOpacity(info.badge.color, 0.18), borderColor: withOpacity(info.badge.color, 0.5) }]}>
                    <Text style={[styles.badgeText, { color: info.badge.color }]}>{info.badge.label}</Text>
                  </View>
                ) : null}
              </View>
              <TouchableOpacity onPress={() => focus(selectedIndex - 1)} disabled={selectedIndex <= 0} style={[styles.panelIcon, selectedIndex <= 0 && styles.disabled]}
                accessibilityRole="button" accessibilityLabel="Poprzednia pozycja">
                <Feather name="chevron-left" size={18} color={colors.text.primary} />
              </TouchableOpacity>
              <Text style={styles.panelCount}>{selectedIndex + 1}/{laid.order.length}</Text>
              <TouchableOpacity onPress={() => focus(selectedIndex + 1)} disabled={selectedIndex >= laid.order.length - 1}
                style={[styles.panelIcon, selectedIndex >= laid.order.length - 1 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Następna pozycja">
                <Feather name="chevron-right" size={18} color={colors.text.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSelectedId(null)} style={styles.panelIcon} accessibilityRole="button" accessibilityLabel="Zamknij szczegóły">
                <Feather name="x" size={18} color={colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: Math.max(120, windowHeight * 0.26) }} contentContainerStyle={styles.panelFacts}>
              <View style={styles.fact}>
                <Feather name="clock" size={14} color={colors.primary.gold} />
                <Text style={styles.factText}>{formatEntryTime(selected.entry)}</Text>
              </View>
              {facts.map((fact, index) => (
                <View key={`${index}-${fact.text}`} style={styles.fact}>
                  <Feather name={fact.icon} size={14} color={colors.primary.gold} />
                  <Text style={styles.factText}>{fact.text}</Text>
                </View>
              ))}
              {info.description ? <Text style={styles.description}>{info.description}</Text> : null}
            </ScrollView>
            {actions.length ? (
              <View style={styles.actions}>
                {actions.map((action) => (
                  <TouchableOpacity key={action.label} onPress={action.onPress} disabled={action.disabled}
                    style={[styles.action, action.primary && styles.actionPrimary, action.danger && styles.actionDanger, action.disabled && styles.disabled]}
                    accessibilityRole="button">
                    {action.icon ? (
                      <Feather name={action.icon} size={15} color={action.primary ? colors.background.primary : action.danger ? colors.status.error : colors.text.primary} />
                    ) : null}
                    <Text style={[styles.actionText, action.primary && styles.actionPrimaryText, action.danger && styles.actionDangerText]} numberOfLines={1}>{action.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  disabled: { opacity: 0.35 },
  toolbar: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.secondary },
  todayButton: { height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.hover },
  todayButtonText: { color: colors.primary.gold, fontSize: 13, fontWeight: '600' },
  rangeLabel: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '600', marginLeft: 4 },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  magnifier: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, height: 40, borderRadius: 20, backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.default },
  magnifierButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  magnifierText: { minWidth: 34, textAlign: 'center', color: colors.primary.gold, fontSize: 12, fontWeight: '600' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { color: colors.text.secondary, fontSize: 11 },
  error: { color: colors.status.error, fontSize: 13 },
  empty: { color: colors.text.tertiary, fontSize: 13 },
  verticalScroll: { flexGrow: 0, flexShrink: 1 },
  verticalContent: { paddingBottom: spacing.md },
  body: { flexDirection: 'row' },
  labels: { borderRightWidth: 1, borderRightColor: colors.border.default, backgroundColor: colors.background.primary },
  labelHeader: { borderBottomWidth: 1, borderBottomColor: colors.border.default },
  labelCell: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  labelSelected: { backgroundColor: colors.primary.gold + '14' },
  labelText: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  labelSub: { color: colors.text.tertiary, fontSize: 11, marginTop: 1 },
  iconCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold + '1f' },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.default },
  headerCell: { alignItems: 'center', justifyContent: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border.default },
  headerText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  headerSmall: { color: colors.text.tertiary, fontSize: 10 },
  todayHeader: { backgroundColor: colors.primary.gold + '22' },
  todayText: { color: colors.primary.gold },
  weekend: { backgroundColor: 'rgba(255,255,255,0.025)' },
  todayColumn: { backgroundColor: colors.primary.gold + '10' },
  gridRow: { flexDirection: 'row' },
  gridCell: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border.default },
  track: { borderBottomWidth: 1, borderBottomColor: colors.border.default },
  bar: { position: 'absolute', height: BAR, borderRadius: 6, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 5, overflow: 'hidden' },
  barActive: { borderWidth: 2, shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4, zIndex: 2 },
  barMuted: { opacity: 0.5 },
  barTitle: { fontSize: 13, fontWeight: '600' },
  barMeta: { fontSize: 11, opacity: 0.85, marginTop: 1 },
  dimmedText: { textDecorationLine: 'line-through' },
  nowLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.status.error },
  hint: { color: colors.text.tertiary, fontSize: 12, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  panel: {
    flexDirection: 'row', marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm, borderRadius: 14, overflow: 'hidden',
    backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.hover,
  },
  panelStripe: { width: 5 },
  panelBody: { flex: 1, padding: spacing.md, gap: spacing.sm },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  panelTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '600' },
  panelIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  panelCount: { color: colors.text.tertiary, fontSize: 12, alignSelf: 'center', minWidth: 30, textAlign: 'center' },
  badge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  panelFacts: { gap: 6 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  factText: { flex: 1, color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
  description: { color: colors.text.secondary, fontSize: 13, lineHeight: 19, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border.hover, backgroundColor: colors.background.primary,
  },
  actionPrimary: { backgroundColor: colors.primary.gold, borderColor: colors.primary.gold },
  actionDanger: { borderColor: colors.status.error },
  actionText: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  actionPrimaryText: { color: colors.background.primary },
  actionDangerText: { color: colors.status.error },
});
