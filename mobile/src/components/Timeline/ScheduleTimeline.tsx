import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import EmployeeAvatar from '../EmployeeAvatar';
import { Segmented } from '../Inquiries/InquiryKit';
import { useContentWidth, useTabletLayout } from '../../hooks/useTabletLayout';
import { colors, spacing } from '../../theme';
import {
  HOUR, TIMELINE_ZOOMS, WEEKDAYS_SHORT, assignLanes, formatClock, isSameDay, shiftAnchor, timelineRange, timelineRangeLabel, withOpacity,
  type TimelineEntry, type TimelineRow, type TimelineZoom,
} from '../../lib/scheduleTimeline';

/*
 * Oś czasu w aplikacji — dzień (godziny), tydzień (pn–nd) i miesiąc (dni), jak osie czasu zespołu i floty w CRM. Z wierszami
 * (pracownik, auto) — stała kolumna nazw po lewej i pozycje każdego wiersza w torach; bez wierszy (spotkania, eventy) — jeden
 * wspólny tor z pozycjami rozłożonymi tak, żeby się nie zasłaniały. Przewijanie w poziomie, linia „teraz”, dziś podświetlony,
 * dotknięcie nagłówka dnia — widok tego dnia, dotknięcie pozycji — `onPressEntry`. Na tablecie kolumny wypełniają szerokość.
 */

type Props<E extends TimelineEntry> = {
  zoom: TimelineZoom;
  onZoomChange: (zoom: TimelineZoom) => void;
  anchor: Date;
  onAnchorChange: (anchor: Date) => void;
  entries: E[];
  /** Wiersze (pracownicy, auta); bez nich — wspólny tor. */
  rows?: TimelineRow[] | null;
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  onPressEntry?: (entry: E) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  legend?: ReadonlyArray<{ label: string; color: string }>;
};

const HEADER = 40;
const LANE = 34;
const BAR = 30;
const PAD = 6;
const MIN_ROW = 50;
const MIN_SHARED = 180;
const MIN_BAR = 22;

/** Czytelny tekst na kolorze pozycji (jasne kolory — ciemny tekst). */
function textOn(color: string): string {
  const hex = (color || '').replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return '#ffffff';
  const value = Number.parseInt(full, 16);
  const luminance = (0.299 * ((value >> 16) & 255) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
  return luminance > 0.62 ? '#14110a' : '#ffffff';
}

export default function ScheduleTimeline<E extends TimelineEntry>({
  zoom, onZoomChange, anchor, onAnchorChange, entries, rows, loading, error, emptyText, onPressEntry, refreshing, onRefresh, legend,
}: Props<E>) {
  const contentWidth = useContentWidth();
  const { tablet } = useTabletLayout();
  const scroll = useRef<ScrollView>(null);
  const labelWidth = rows ? (tablet ? 190 : 116) : 0;
  const available = Math.max(240, contentWidth - labelWidth);
  const { start, end, days } = timelineRange(zoom, anchor);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const columns = zoom === 'day' ? 24 : days.length;
  const minColumn = zoom === 'day' ? (tablet ? 40 : 52) : zoom === 'week' ? (tablet ? 90 : 92) : tablet ? 28 : 36;
  const columnWidth = Math.max(minColumn, available / columns);
  const totalWidth = columnWidth * columns;
  const pxPerMs = totalWidth / (endMs - startMs);
  const now = Date.now();
  const nowX = now >= startMs && now < endMs ? (now - startMs) * pxPerMs : null;

  // Pozycje w zakresie, przycięte do jego granic, w torach (najkrótsza pozycja ma co najmniej MIN_BAR px).
  const laidOut = useMemo(() => {
    const visible = entries
      .filter((entry) => entry.end > startMs && entry.start < endMs)
      .map((entry) => ({ entry, start: Math.max(entry.start, startMs), end: Math.min(entry.end, endMs) }));
    const groups = new Map<string, typeof visible>();
    for (const item of visible) {
      const key = rows ? String(item.entry.rowId ?? '') : '__all';
      const group = groups.get(key);
      if (group) group.push(item); else groups.set(key, [item]);
    }
    const lanes = new Map<string, { entry: E; start: number; end: number; lane: number }[]>();
    groups.forEach((group, key) => {
      lanes.set(key, assignLanes(group, MIN_BAR / pxPerMs).map(({ item, lane }) => ({ ...item, lane })));
    });
    return { lanes, count: visible.length };
  }, [entries, startMs, endMs, pxPerMs, rows]);

  const rowList: TimelineRow[] = rows ?? [{ id: '__all', label: '' }];
  const heights = rowList.map((row) => {
    const placed = laidOut.lanes.get(rows ? row.id : '__all') ?? [];
    const laneCount = placed.reduce((max, item) => Math.max(max, item.lane + 1), 0);
    return Math.max(rows ? MIN_ROW : MIN_SHARED, PAD * 2 + laneCount * LANE);
  });

  // Po zmianie zakresu: dzień — od 7:00 (dziś: godzinę przed „teraz”), tydzień i miesiąc — dziś na początku widoku.
  useEffect(() => {
    let x = 0;
    if (zoom === 'day') {
      const hour = nowX != null ? Math.max(0, new Date(now).getHours() - 1) : 7;
      x = hour * columnWidth;
    } else if (nowX != null) {
      x = Math.max(0, Math.floor((now - startMs) / (24 * HOUR)) * columnWidth - columnWidth);
    }
    const timer = setTimeout(() => scroll.current?.scrollTo({ x: Math.min(x, Math.max(0, totalWidth - available)), animated: false }), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, startMs, columnWidth]);

  const headerCell = (index: number) => {
    if (zoom === 'day') {
      return (
        <View key={index} style={[styles.headerCell, { width: columnWidth }]}>
          <Text style={styles.headerText}>{String(index).padStart(2, '0')}</Text>
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
        {zoom === 'week' ? (
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
        <Segmented value={zoom} options={TIMELINE_ZOOMS} onChange={onZoomChange} />
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
        {!loading && !error && laidOut.count === 0 ? <Text style={styles.empty}>{emptyText || 'Brak pozycji w tym okresie.'}</Text> : null}
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.verticalContent}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary.gold} /> : undefined}>
        <View style={styles.body}>
          {rows ? (
            <View style={[styles.labels, { width: labelWidth }]}>
              <View style={[styles.labelHeader, { height: HEADER }]} />
              {rowList.map((row, index) => (
                <View key={row.id} style={[styles.labelCell, { height: heights[index] }]}>
                  {row.icon ? (
                    <View style={styles.iconCircle}><Feather name={row.icon} size={14} color={colors.primary.gold} /></View>
                  ) : (
                    <EmployeeAvatar avatarUrl={row.avatarUrl ?? null} avatarMetadata={(row.avatarMetadata as any) ?? null} employeeName={row.label} size={28} />
                  )}
                  <View style={styles.flex}>
                    <Text style={styles.labelText} numberOfLines={1}>{row.label}</Text>
                    {row.sublabel ? <Text style={styles.labelSub} numberOfLines={1}>{row.sublabel}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator style={styles.flex}>
            <View style={{ width: totalWidth }}>
              <View style={[styles.headerRow, { height: HEADER }]}>
                {Array.from({ length: columns }, (_, index) => headerCell(index))}
              </View>
              {rowList.map((row, index) => {
                const placed = laidOut.lanes.get(rows ? row.id : '__all') ?? [];
                return (
                  <View key={row.id} style={[styles.track, { height: heights[index] }]}>
                    {grid(heights[index])}
                    {placed.map(({ entry, start: from, end: to, lane }) => {
                      const left = (from - startMs) * pxPerMs;
                      const width = Math.max(MIN_BAR, (to - from) * pxPerMs - 2);
                      const label = zoom !== 'month' && !entry.allDay && entry.start >= startMs ? `${formatClock(entry.start)} ${entry.title}` : entry.title;
                      const foreground = entry.dimmed ? colors.text.secondary : textOn(entry.color);
                      return (
                        <TouchableOpacity key={entry.id} onPress={onPressEntry ? () => onPressEntry(entry) : undefined} disabled={!onPressEntry}
                          style={[styles.bar, {
                            left: left + 1, width, top: PAD + lane * LANE,
                            backgroundColor: withOpacity(entry.color, entry.dimmed ? 0.28 : 0.92),
                            borderColor: withOpacity(entry.color, 1),
                          }]}
                          accessibilityRole="button" accessibilityLabel={`${entry.title}${entry.subtitle ? `, ${entry.subtitle}` : ''}`}>
                          {width >= 34 ? (
                            <Text style={[styles.barText, { color: foreground }, entry.dimmed && styles.dimmedText]} numberOfLines={1}>{label}</Text>
                          ) : null}
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  toolbar: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.secondary },
  todayButton: { height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.hover },
  todayButtonText: { color: colors.primary.gold, fontSize: 13, fontWeight: '600' },
  rangeLabel: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '600', marginLeft: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendText: { color: colors.text.secondary, fontSize: 11 },
  error: { color: colors.status.error, fontSize: 13 },
  empty: { color: colors.text.tertiary, fontSize: 13 },
  verticalContent: { paddingBottom: 40 },
  body: { flexDirection: 'row' },
  labels: { borderRightWidth: 1, borderRightColor: colors.border.default, backgroundColor: colors.background.primary },
  labelHeader: { borderBottomWidth: 1, borderBottomColor: colors.border.default },
  labelCell: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border.default },
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
  bar: { position: 'absolute', height: BAR, borderRadius: 7, borderWidth: 1, justifyContent: 'center', paddingHorizontal: 7, overflow: 'hidden' },
  barText: { fontSize: 12, fontWeight: '600' },
  dimmedText: { textDecorationLine: 'line-through' },
  nowLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.status.error },
});
