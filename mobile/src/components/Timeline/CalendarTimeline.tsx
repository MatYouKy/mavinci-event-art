import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, PanResponder, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Segmented, afterModal } from '../Inquiries/InquiryKit';
import { useTabletLayout } from '../../hooks/useTabletLayout';
import { layoutTimeline } from '../../lib/meetingStatus';
import {
  DAY, MINUTE, TIMELINE_SCALES, WEEKDAYS_SHORT, addDays, formatClock, formatEntryTime, isSameDay, shiftAnchor, startOfDay, startOfMonth,
  startOfWeek, timelineRange, timelineRangeLabel, timelineScaleLabel, withOpacity,
  type TimelineEntry, type TimelineZoom,
} from '../../lib/scheduleTimeline';
import { colors, spacing } from '../../theme';
import type { TimelineDetailAction, TimelineDetails, TimelineIcon } from './ScheduleTimeline';

/*
 * Kalendarz spotkań w aplikacji — jak w Teams i jak kalendarz spotkań w CRM (`MeetingsTimeline`) i na Macu: godziny w pionie
 * (przewijanie w górę i w dół), dni w kolumnach, nakładające się spotkania obok siebie, czerwona linia „teraz”, godziny pracy
 * jaśniejsze. Wysokość spotkania odpowiada czasowi (30 minut — połowa godziny), „lupka” powiększa godzinę (1×–4×).
 * Telefon: Dzień, Tydzień (7 kolumn), Miesiąc; tablet w poziomie — jak komputer: Dzień, Tydzień roboczy, Tydzień, Miesiąc
 * i szczegóły w panelu z prawej. Przesunięcie palcem w bok — poprzedni / następny okres. Dotknięcie spotkania — szczegóły
 * (telefon: okno od dołu). Przytrzymanie pustej godziny — nowe spotkanie na tę godzinę (tablet w poziomie — także dotknięcie).
 * Przytrzymanie spotkania, które można zmienić, i przeciągnięcie — nowy termin (co 15 minut; w tygodniu także inny dzień).
 */

/** Pozycja kalendarza: spotkanie z oznaczeniami (prywatne, czeka na odpowiedź, cykliczne). */
export type CalendarEntry = TimelineEntry & { locked?: boolean; pending?: boolean; repeat?: boolean };

type Props<E extends CalendarEntry> = {
  zoom: TimelineZoom;
  onZoomChange: (zoom: TimelineZoom) => void;
  anchor: Date;
  onAnchorChange: (anchor: Date) => void;
  /** Powiększenie godziny (`TIMELINE_SCALES`). */
  scale: number;
  onScaleChange: (scale: number) => void;
  entries: E[];
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  details?: (entry: E) => TimelineDetails;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Czy pozycję można przeciągnąć (organizator, nie cały dzień). */
  canMove?: (entry: E) => boolean;
  onMove?: (entry: E, start: Date, end: Date) => void;
  /** Nowa pozycja w wybranym miejscu (początek zaokrąglony do 30 minut, godzina trwania). */
  onCreate?: (start: Date, end: Date) => void;
  /** Pozycje w trakcie zapisu (np. po przeniesieniu). */
  savingIds?: ReadonlySet<string>;
};

const BASE_HOUR = 52;
const LABEL = 48;
const SNAP = 15;
const WORK_START = 8;
const WORK_END = 18;
const MIN_BLOCK = 12;
const PANEL = 340;

const PHONE_ZOOMS: ReadonlyArray<{ id: TimelineZoom; label: string }> = [
  { id: 'day', label: 'Dzień' },
  { id: 'week', label: 'Tydzień' },
  { id: 'month', label: 'Miesiąc' },
];
const WIDE_ZOOMS: ReadonlyArray<{ id: TimelineZoom; label: string }> = [
  { id: 'day', label: 'Dzień' },
  { id: 'workweek', label: 'Tydzień roboczy' },
  { id: 'week', label: 'Tydzień' },
  { id: 'month', label: 'Miesiąc' },
];

const pad2 = (value: number) => String(value).padStart(2, '0');

type Segment<E> = { id: string; entry: E; start: number; end: number; realStart: number; realEnd: number };
type DragState<E> = { entry: E; start: number; end: number; minutes: number; days: number; moved: boolean; granted: boolean };

export default function CalendarTimeline<E extends CalendarEntry>({
  zoom, onZoomChange, anchor, onAnchorChange, scale, onScaleChange, entries, loading, error, emptyText, details, refreshing, onRefresh,
  canMove, onMove, onCreate, savingIds,
}: Props<E>) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { tablet, landscape } = useTabletLayout();
  /** Tablet w poziomie — układ jak na komputerze (tydzień roboczy, panel szczegółów z prawej, dotknięcie godziny dodaje). */
  const wide = tablet && landscape;
  const view: TimelineZoom = !wide && zoom === 'workweek' ? 'week' : zoom;
  const month = view === 'month';
  const { start: rangeStart, end: rangeEnd, days: rangeDays } = timelineRange(view, anchor);
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const days = month ? [] : rangeDays;
  const hour = BASE_HOUR * scale;

  const [bodyWidth, setBodyWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; start: number; end: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const vertical = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const viewport = useRef(0);
  const dragRef = useRef<DragState<E> | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), MINUTE);
    return () => clearInterval(timer);
  }, []);

  const panelOpen = wide && selectedId !== null;
  const gridWidth = Math.max(0, bodyWidth);
  const dayWidth = days.length ? Math.max(24, (gridWidth - LABEL) / days.length) : 0;

  // Pozycje w zakresie (podgląd przeciąganego spotkania — w nowym miejscu).
  const shown = useMemo(() => entries.map((entry) => (drag && drag.id === entry.id ? { ...entry, start: drag.start, end: drag.end } : entry))
    .filter((entry) => entry.end > startMs && entry.start < endMs), [entries, drag, startMs, endMs]);
  const isAllDay = (entry: E) => entry.allDay === true || entry.end - entry.start >= DAY;
  const order = useMemo(() => [...shown].sort((a, b) => a.start - b.start || a.end - b.end), [shown]);

  const columns = useMemo(() => days.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = addDays(day, 1).getTime();
    const segments: Segment<E>[] = shown
      .filter((entry) => !isAllDay(entry) && entry.start < dayEnd && entry.end > dayStart)
      .map((entry) => {
        const start = entry.start <= dayStart ? 0 : (entry.start - dayStart) / MINUTE;
        const end = Math.min(24 * 60, Math.max(start + 1, (entry.end - dayStart) / MINUTE));
        return { id: entry.id, entry, start, end, realStart: entry.start, realEnd: entry.end };
      });
    return layoutTimeline(segments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shown, startMs, days.length]);

  const allDayByDay = useMemo(() => days.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = addDays(day, 1).getTime();
    return shown.filter((entry) => isAllDay(entry) && entry.start < dayEnd && entry.end > dayStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shown, startMs, days.length]);
  const hasAllDay = allDayByDay.some((list) => list.length > 0);

  const selectedIndex = selectedId ? order.findIndex((entry) => entry.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? order[selectedIndex] : null;
  // Zaznaczona pozycja wypadła z zakresu (zmiana okresu) — szczegóły się zamykają.
  useEffect(() => {
    if (selectedId && selectedIndex < 0) setSelectedId(null);
  }, [selectedId, selectedIndex]);

  const showsToday = days.some((day) => isSameDay(day, now));

  // Po zmianie zakresu: dziś — półtorej godziny przed „teraz”, inaczej od 7:00.
  useEffect(() => {
    if (month) return undefined;
    const current = new Date();
    const from = showsToday ? Math.max(0, current.getHours() + current.getMinutes() / 60 - 1.5) : WORK_START - 1;
    const timer = setTimeout(() => {
      scrollY.current = from * hour;
      vertical.current?.scrollTo({ y: from * hour, animated: false });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, startMs]);

  // „Lupka”: po zmianie powiększenia w widoku zostaje ta sama godzina na środku.
  const lastHour = useRef(hour);
  useEffect(() => {
    const ratio = hour / lastHour.current;
    lastHour.current = hour;
    if (ratio === 1 || month) return undefined;
    const center = (scrollY.current + viewport.current / 2) * ratio;
    const timer = setTimeout(() => {
      const y = Math.max(0, center - viewport.current / 2);
      scrollY.current = y;
      vertical.current?.scrollTo({ y, animated: false });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hour]);

  const zoomIndex = (TIMELINE_SCALES as readonly number[]).indexOf(scale);
  const changeScale = (direction: -1 | 1) => {
    const next = TIMELINE_SCALES[Math.max(0, Math.min(TIMELINE_SCALES.length - 1, (zoomIndex < 0 ? 0 : zoomIndex) + direction))];
    if (next !== scale) onScaleChange(next);
  };

  // ── Przeciąganie spotkania (po przytrzymaniu) i przesunięcie palcem w bok (okres) ─────────────────────
  const startDrag = (segment: Segment<E>) => {
    // Bez prawa zmiany (albo w trakcie zapisu) przytrzymanie pokazuje szczegóły.
    if (!onMove || !canMove?.(segment.entry) || savingIds?.has(segment.entry.id)) { setSelectedId(segment.entry.id); return; }
    dragRef.current = { entry: segment.entry, start: segment.realStart, end: segment.realEnd, minutes: 0, days: 0, moved: false, granted: false };
    setSelectedId(null);
    setDrag({ id: segment.entry.id, start: segment.realStart, end: segment.realEnd });
  };
  const draggedStart = (state: DragState<E>) => {
    const start = new Date(state.start);
    start.setDate(start.getDate() + state.days);
    start.setMinutes(start.getMinutes() + state.minutes);
    return start;
  };
  const updateDrag = (dx: number, dy: number) => {
    const state = dragRef.current;
    if (!state) return;
    const minutes = Math.round(((dy / hour) * 60) / SNAP) * SNAP;
    const dayShift = days.length > 1 && dayWidth > 0 ? Math.round(dx / dayWidth) : 0;
    if (minutes === state.minutes && dayShift === state.days) return;
    state.minutes = minutes;
    state.days = dayShift;
    state.moved = true;
    const start = draggedStart(state).getTime();
    setDrag({ id: state.entry.id, start, end: start + (state.end - state.start) });
  };
  const finishDrag = () => {
    const state = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!state) return;
    if (!state.moved || (state.minutes === 0 && state.days === 0)) {
      setSelectedId(state.entry.id);
      return;
    }
    const start = draggedStart(state);
    onMove?.(state.entry, start, new Date(start.getTime() + (state.end - state.start)));
  };
  const cancelDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const latest = useRef({ view, anchor, onAnchorChange, updateDrag, finishDrag, cancelDrag });
  latest.current = { view, anchor, onAnchorChange, updateDrag, finishDrag, cancelDrag };

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) => {
      if (dragRef.current) return true;
      return Math.abs(gesture.dx) > 28 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2;
    },
    onPanResponderGrant: () => {
      if (dragRef.current) dragRef.current.granted = true;
    },
    onPanResponderMove: (_event, gesture) => {
      if (dragRef.current) latest.current.updateDrag(gesture.dx, gesture.dy);
    },
    onPanResponderRelease: (_event, gesture) => {
      if (dragRef.current) { latest.current.finishDrag(); return; }
      if (Math.abs(gesture.dx) > 60) {
        const { view: current, anchor: from, onAnchorChange: change } = latest.current;
        change(shiftAnchor(current, from, gesture.dx < 0 ? 1 : -1));
      }
    },
    onPanResponderTerminate: () => {
      if (dragRef.current) latest.current.cancelDrag();
    },
    onPanResponderTerminationRequest: () => !dragRef.current,
  })).current;

  /** Koniec przytrzymania bez przeciągania — szczegóły spotkania (przeciąganie kończy się w `onPanResponderRelease`). */
  const releaseHold = () => {
    setTimeout(() => {
      const state = dragRef.current;
      if (state && !state.granted) latest.current.finishDrag();
    }, 60);
  };

  /** Nowa pozycja w miejscu dotknięcia (początek zaokrąglony do 30 minut). */
  const createAt = (day: Date, y: number) => {
    if (!onCreate) return;
    const minute = Math.max(0, Math.min(24 * 60 - 30, Math.floor(((y / hour) * 60) / 30) * 30));
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute);
    onCreate(start, new Date(start.getTime() + 60 * MINUTE));
  };

  // ── Szczegóły ────────────────────────────────────────────────────────────────────────
  const info = selected ? (details ? details(selected) : { facts: selected.subtitle ? [{ icon: 'info' as TimelineIcon, text: selected.subtitle }] : [] }) : null;

  const detailsCard = (modal: boolean) => (selected && info ? (
    <DetailsCard entry={selected} info={info} index={selectedIndex} count={order.length} maxHeight={modal ? windowHeight * 0.45 : undefined}
      onPrev={() => setSelectedId(order[selectedIndex - 1]?.id ?? selectedId)}
      onNext={() => setSelectedId(order[selectedIndex + 1]?.id ?? selectedId)}
      onClose={() => setSelectedId(null)}
      onAction={(action) => {
        if (!modal) { action.onPress(); return; }
        // Okno od dołu zamyka się przed działaniem (np. okno spotkania) — iOS nie pokaże dwóch okien naraz.
        setSelectedId(null);
        afterModal(action.onPress);
      }} />
  ) : null);

  // ── Widok miesiąca ──────────────────────────────────────────────────────────────────
  const monthGrid = () => {
    const first = startOfMonth(anchor);
    const gridStart = startOfWeek(first);
    const nextMonth = new Date(first.getFullYear(), first.getMonth() + 1, 1);
    const weeks = Math.ceil(Math.round((nextMonth.getTime() - gridStart.getTime()) / DAY) / 7);
    const limit = wide ? 4 : 2;
    return (
      <View style={styles.month}>
        <View style={styles.monthHeader}>
          {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
            <Text key={weekday} style={[styles.monthWeekday, (weekday === 0 || weekday === 6) && styles.mutedText]}>{WEEKDAYS_SHORT[weekday]}</Text>
          ))}
        </View>
        {Array.from({ length: weeks }, (_, week) => (
          <View key={week} style={styles.monthRow}>
            {Array.from({ length: 7 }, (_, index) => {
              const day = addDays(gridStart, week * 7 + index);
              const dayStart = day.getTime();
              const dayEnd = addDays(day, 1).getTime();
              const items = entries.filter((entry) => entry.start < dayEnd && entry.end > dayStart).sort((a, b) => a.start - b.start);
              const inMonth = day.getMonth() === first.getMonth();
              const today = isSameDay(day, now);
              return (
                <TouchableOpacity key={index} style={[styles.monthCell, !inMonth && styles.monthOutside]} activeOpacity={0.7}
                  onPress={() => { onAnchorChange(day); onZoomChange('day'); }} accessibilityRole="button"
                  accessibilityLabel={`${day.getDate()}, ${items.length ? `spotkania: ${items.length}` : 'bez spotkań'}`}>
                  <View style={[styles.monthDay, today && styles.monthToday]}>
                    <Text style={[styles.monthDayText, today && styles.monthTodayText, !inMonth && styles.mutedText]}>{day.getDate()}</Text>
                  </View>
                  {items.slice(0, limit).map((entry) => (
                    <View key={entry.id} style={[styles.monthChip, { backgroundColor: withOpacity(entry.color, 0.26), borderLeftColor: entry.color }, entry.dimmed && styles.dimmed]}>
                      <Text style={[styles.monthChipText, entry.dimmed && styles.struck]} numberOfLines={1}>
                        {!entry.allDay && wide ? `${formatClock(Math.max(entry.start, dayStart))} ` : ''}{entry.title}
                      </Text>
                    </View>
                  ))}
                  {items.length > limit ? <Text style={styles.monthMore}>+{items.length - limit}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  // ── Dzień / tydzień ─────────────────────────────────────────────────────────────────
  const nowMinute = (now - startOfDay(now).getTime()) / MINUTE;
  const compactHeader = !wide && days.length > 1;

  const dayGrid = () => (
    <>
      {days.length > 1 ? (
        <View style={styles.dayHeader}>
          <View style={{ width: LABEL }} />
          {days.map((day) => {
            const today = isSameDay(day, now);
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <TouchableOpacity key={day.getTime()} style={[styles.dayHeaderCell, { width: dayWidth }, compactHeader && styles.dayHeaderStacked]}
                onPress={() => { onAnchorChange(day); onZoomChange('day'); }} accessibilityRole="button" accessibilityLabel={`Pokaż dzień ${day.getDate()}`}>
                <View style={[styles.dateBadge, today && styles.dateBadgeToday]}>
                  <Text style={[styles.dateText, today && styles.dateTextToday]}>{day.getDate()}</Text>
                </View>
                <Text style={[styles.weekdayText, today && styles.goldText, weekend && !today && styles.mutedText]}>{WEEKDAYS_SHORT[day.getDay()]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
      {hasAllDay ? (
        <View style={styles.allDayRow}>
          <Text style={[styles.allDayLabel, { width: LABEL }]}>Cały dzień</Text>
          {days.map((day, index) => {
            const list = allDayByDay[index];
            const limit = days.length === 1 ? 6 : wide ? 3 : 2;
            return (
              <View key={day.getTime()} style={[styles.allDayCell, { width: dayWidth }]}>
                {list.slice(0, limit).map((entry) => (
                  <TouchableOpacity key={entry.id} onPress={() => setSelectedId(entry.id)} activeOpacity={0.75}
                    style={[styles.allDayChip, { backgroundColor: withOpacity(entry.color, 0.28), borderLeftColor: entry.color }, entry.dimmed && styles.dimmed]}
                    accessibilityRole="button" accessibilityLabel={`${entry.title}, ${formatEntryTime(entry)}`}>
                    <Text style={[styles.allDayText, entry.dimmed && styles.struck]} numberOfLines={1}>{entry.title}</Text>
                  </TouchableOpacity>
                ))}
                {list.length > limit ? (
                  <TouchableOpacity onPress={() => { onAnchorChange(day); onZoomChange('day'); }} accessibilityRole="button">
                    <Text style={styles.allDayMore}>+{list.length - limit}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      <ScrollView ref={vertical} style={styles.flex} scrollEnabled={!drag} scrollEventThrottle={32}
        onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; }}
        onLayout={(event) => { viewport.current = event.nativeEvent.layout.height; }}
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary.gold} /> : undefined}>
        <View style={{ height: 24 * hour, width: gridWidth }}>
          {/* Linie godzin i półgodzin na całą szerokość. */}
          {Array.from({ length: 24 }, (_, index) => (
            <React.Fragment key={index}>
              <View pointerEvents="none" style={[styles.hourLine, { top: index * hour, left: LABEL }]} />
              <View pointerEvents="none" style={[styles.halfLine, { top: index * hour + hour / 2, left: LABEL }]} />
            </React.Fragment>
          ))}
          <View style={styles.dayRow}>
            <View style={{ width: LABEL, height: 24 * hour }}>
              {Array.from({ length: 24 }, (_, index) => (index === 0 ? null : (
                <Text key={index} style={[styles.hourLabel, { top: index * hour - 7 }]}>{pad2(index)}:00</Text>
              )))}
            </View>
            {days.map((day, dayIndex) => {
              const today = isSameDay(day, now);
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <View key={day.getTime()} style={[styles.dayColumn, { width: dayWidth, height: 24 * hour }, today && styles.todayColumn, weekend && !today && styles.weekendColumn]}>
                  <View pointerEvents="none" style={[styles.offHours, { top: 0, height: WORK_START * hour }]} />
                  <View pointerEvents="none" style={[styles.offHours, { top: WORK_END * hour, height: (24 - WORK_END) * hour }]} />
                  <Pressable style={StyleSheet.absoluteFill} delayLongPress={400}
                    onLongPress={onCreate ? (event) => createAt(day, event.nativeEvent.locationY) : undefined}
                    onPress={wide && onCreate ? (event) => createAt(day, event.nativeEvent.locationY) : undefined}
                    accessibilityLabel={onCreate ? 'Przytrzymaj, żeby dodać spotkanie o tej godzinie' : undefined} />
                  {columns[dayIndex].map((item) => {
                    const { entry } = item;
                    const top = (item.start / 60) * hour;
                    const height = Math.max(MIN_BLOCK, ((item.end - item.start) / 60) * hour - 2);
                    const width = dayWidth / item.columns;
                    const active = selected?.id === entry.id;
                    const dragging = drag?.id === entry.id;
                    const saving = savingIds?.has(entry.id) ?? false;
                    const narrow = width < 64;
                    const lines = height >= 34 ? (days.length === 1 && height >= 50 && entry.subtitle ? 3 : 2) : 1;
                    const timeText = `${formatClock(item.realStart)}–${formatClock(item.realEnd)}`;
                    return (
                      <Pressable key={`${entry.id}-${dayIndex}`} delayLongPress={350}
                        onPress={() => setSelectedId(active ? null : entry.id)}
                        onLongPress={() => startDrag(item)}
                        onPressOut={releaseHold}
                        style={[styles.block, {
                          top, height, left: item.column * width + 1, width: width - 2,
                          backgroundColor: withOpacity(entry.color, entry.pending ? 0.12 : entry.dimmed ? 0.12 : 0.3),
                          borderLeftColor: entry.color,
                          borderColor: active || dragging ? colors.text.primary : withOpacity(entry.color, 0.55),
                        }, (active || dragging) && styles.blockActive, entry.dimmed && styles.dimmed]}
                        accessibilityRole="button" accessibilityState={{ selected: active }}
                        accessibilityLabel={`${entry.title}, ${formatEntryTime(entry)}${entry.subtitle ? `, ${entry.subtitle}` : ''}`}>
                        <View style={styles.blockTitleRow}>
                          {entry.locked ? <Feather name="lock" size={10} color={colors.text.secondary} /> : null}
                          {entry.pending ? <Feather name="help-circle" size={10} color={colors.primary.gold} /> : null}
                          <Text style={[styles.blockTitle, narrow && styles.blockTitleNarrow, entry.dimmed && styles.struck]} numberOfLines={lines === 1 ? 1 : narrow ? 2 : 1}>
                            {lines === 1 && !narrow ? `${formatClock(item.realStart)} ` : ''}{entry.title}
                          </Text>
                          {saving ? <ActivityIndicator size="small" color={colors.primary.gold} style={styles.blockSpinner} /> : null}
                        </View>
                        {lines >= 2 && !narrow ? <Text style={styles.blockMeta} numberOfLines={1}>{timeText}</Text> : null}
                        {lines >= 2 && narrow && height >= 48 ? <Text style={styles.blockMeta} numberOfLines={1}>{formatClock(item.realStart)}</Text> : null}
                        {lines >= 3 ? <Text style={styles.blockMeta} numberOfLines={1}>{entry.subtitle}</Text> : null}
                      </Pressable>
                    );
                  })}
                  {dragTime(drag, day)}
                  {today ? (
                    <View pointerEvents="none" style={[styles.nowLine, { top: (nowMinute / 60) * hour }]}>
                      <View style={styles.nowDot} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </>
  );

  /** Godzina przeciąganego spotkania nad nim (nowy termin). */
  function dragTime(state: { id: string; start: number; end: number } | null, day: Date) {
    if (!state || !isSameDay(state.start, day)) return null;
    const top = Math.max(0, ((state.start - startOfDay(day).getTime()) / MINUTE / 60) * hour - 20);
    return (
      <View pointerEvents="none" style={[styles.dragLabel, { top }]}>
        <Text style={styles.dragLabelText}>{formatClock(state.start)}–{formatClock(state.end)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => onAnchorChange(shiftAnchor(view, anchor, -1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Poprzedni okres">
            <Feather name="chevron-left" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onAnchorChange(new Date())} style={styles.todayButton} accessibilityRole="button">
            <Text style={styles.todayButtonText}>Dziś</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onAnchorChange(shiftAnchor(view, anchor, 1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Następny okres">
            <Feather name="chevron-right" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.rangeLabel} numberOfLines={1}>{timelineRangeLabel(view, anchor)}</Text>
          {loading ? <ActivityIndicator size="small" color={colors.primary.gold} /> : null}
        </View>
        <View style={styles.zoomRow}>
          <View style={styles.flex}>
            <Segmented value={view} options={wide ? WIDE_ZOOMS : PHONE_ZOOMS} onChange={onZoomChange} />
          </View>
          {!month ? (
            <View style={styles.magnifier}>
              <TouchableOpacity onPress={() => changeScale(-1)} disabled={zoomIndex <= 0} style={[styles.magnifierButton, zoomIndex <= 0 && styles.disabled]}
                accessibilityRole="button" accessibilityLabel="Zmniejsz godzinę">
                <Feather name="zoom-out" size={18} color={colors.text.primary} />
              </TouchableOpacity>
              <Text style={styles.magnifierText}>{timelineScaleLabel(scale)}</Text>
              <TouchableOpacity onPress={() => changeScale(1)} disabled={zoomIndex >= TIMELINE_SCALES.length - 1}
                style={[styles.magnifierButton, zoomIndex >= TIMELINE_SCALES.length - 1 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Powiększ godzinę">
                <Feather name="zoom-in" size={18} color={colors.text.primary} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        {!loading && !error && order.length === 0 ? (
          <Text style={styles.empty}>{emptyText || 'Brak pozycji w tym okresie.'}{onCreate && !month ? ` ${wide ? 'Dotknij' : 'Przytrzymaj'} godzinę, żeby dodać.` : ''}</Text>
        ) : null}
      </View>

      <View style={styles.bodyRow}>
        <View style={styles.flex} {...pan.panHandlers}
          onLayout={(event) => setBodyWidth(event.nativeEvent.layout.width)}>
          {bodyWidth > 0 ? (month ? monthGrid() : dayGrid()) : null}
        </View>
        {panelOpen ? <View style={styles.sidePanel}>{detailsCard(false)}</View> : null}
      </View>

      {!wide ? (
        <Modal visible={selected !== null} transparent animationType="slide" onRequestClose={() => setSelectedId(null)} supportedOrientations={['portrait', 'landscape']}>
          <View style={styles.sheetBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setSelectedId(null)} accessibilityLabel="Zamknij szczegóły" />
            <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
              <View style={styles.grabber} />
              {detailsCard(true)}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

/** Szczegóły pozycji: tytuł, plakietka, godziny, fakty, opis i działania; „‹ ›” — poprzednia / następna w zakresie. */
function DetailsCard<E extends CalendarEntry>({ entry, info, index, count, maxHeight, onPrev, onNext, onClose, onAction }: {
  entry: E; info: TimelineDetails; index: number; count: number; maxHeight?: number;
  onPrev: () => void; onNext: () => void; onClose: () => void; onAction: (action: TimelineDetailAction) => void;
}) {
  const facts = (info.facts ?? []).filter((fact): fact is { icon: TimelineIcon; text: string } => Boolean(fact && fact.text));
  const actions = (info.actions ?? []).filter((action): action is TimelineDetailAction => Boolean(action));
  return (
    <View style={styles.card}>
      <View style={[styles.cardStripe, { backgroundColor: entry.color }]} />
      <View style={styles.cardBody}>
        <View style={styles.cardHead}>
          <View style={styles.flex}>
            <Text style={[styles.cardTitle, entry.dimmed && styles.struck]} numberOfLines={3}>{entry.title}</Text>
            {info.badge ? (
              <View style={[styles.badge, { backgroundColor: withOpacity(info.badge.color, 0.18), borderColor: withOpacity(info.badge.color, 0.5) }]}>
                <Text style={[styles.badgeText, { color: info.badge.color }]}>{info.badge.label}</Text>
              </View>
            ) : null}
          </View>
          <TouchableOpacity onPress={onPrev} disabled={index <= 0} style={[styles.cardIcon, index <= 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Poprzednia pozycja">
            <Feather name="chevron-left" size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.cardCount}>{index + 1}/{count}</Text>
          <TouchableOpacity onPress={onNext} disabled={index >= count - 1} style={[styles.cardIcon, index >= count - 1 && styles.disabled]} accessibilityRole="button"
            accessibilityLabel="Następna pozycja">
            <Feather name="chevron-right" size={18} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.cardIcon} accessibilityRole="button" accessibilityLabel="Zamknij szczegóły">
            <Feather name="x" size={18} color={colors.text.secondary} />
          </TouchableOpacity>
        </View>
        <ScrollView style={maxHeight ? { maxHeight } : styles.flexShrink} contentContainerStyle={styles.cardFacts}>
          <View style={styles.fact}>
            <Feather name="clock" size={14} color={colors.primary.gold} />
            <Text style={styles.factText}>{formatEntryTime(entry)}</Text>
          </View>
          {facts.map((fact, factIndex) => (
            <View key={`${factIndex}-${fact.text}`} style={styles.fact}>
              <Feather name={fact.icon} size={14} color={colors.primary.gold} />
              <Text style={styles.factText}>{fact.text}</Text>
            </View>
          ))}
          {info.description ? <Text style={styles.description}>{info.description}</Text> : null}
        </ScrollView>
        {actions.length ? (
          <View style={styles.actions}>
            {actions.map((action) => (
              <TouchableOpacity key={action.label} onPress={() => onAction(action)} disabled={action.disabled}
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
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  container: { flex: 1 },
  disabled: { opacity: 0.35 },
  mutedText: { color: colors.text.tertiary },
  goldText: { color: colors.primary.gold },
  struck: { textDecorationLine: 'line-through' },
  dimmed: { opacity: 0.6 },
  toolbar: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.secondary },
  todayButton: {
    height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.hover,
  },
  todayButtonText: { color: colors.primary.gold, fontSize: 13, fontWeight: '600' },
  rangeLabel: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '600', marginLeft: 4 },
  zoomRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  magnifier: {
    flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 4, height: 40, borderRadius: 20, backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.default,
  },
  magnifierButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  magnifierText: { minWidth: 34, textAlign: 'center', color: colors.primary.gold, fontSize: 12, fontWeight: '600' },
  error: { color: colors.status.error, fontSize: 13 },
  empty: { color: colors.text.tertiary, fontSize: 13 },
  bodyRow: { flex: 1, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border.default },
  sidePanel: { width: PANEL, borderLeftWidth: 1, borderLeftColor: colors.border.default, padding: spacing.sm },
  dayHeader: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.default },
  dayHeaderCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  dayHeaderStacked: { flexDirection: 'column', gap: 2 },
  dateBadge: { minWidth: 28, height: 28, paddingHorizontal: 4, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dateBadgeToday: { backgroundColor: colors.primary.gold },
  dateText: { color: colors.text.primary, fontSize: 15, fontWeight: '600' },
  dateTextToday: { color: colors.background.primary },
  weekdayText: { color: colors.text.secondary, fontSize: 11, textTransform: 'uppercase' },
  allDayRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.default, paddingVertical: 3 },
  allDayLabel: { color: colors.text.tertiary, fontSize: 9, textTransform: 'uppercase', textAlign: 'right', paddingRight: 6, paddingTop: 4 },
  allDayCell: { gap: 2, paddingHorizontal: 1 },
  allDayChip: { borderLeftWidth: 3, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 3 },
  allDayText: { color: colors.text.primary, fontSize: 11, fontWeight: '600' },
  allDayMore: { color: colors.primary.gold, fontSize: 11, paddingHorizontal: 4 },
  dayRow: { flexDirection: 'row' },
  hourLine: { position: 'absolute', right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border.default },
  halfLine: { position: 'absolute', right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(127,127,127,0.12)' },
  hourLabel: { position: 'absolute', right: 6, color: colors.text.tertiary, fontSize: 10, fontVariant: ['tabular-nums'] },
  dayColumn: { position: 'relative', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border.default },
  todayColumn: { backgroundColor: colors.primary.gold + '0d' },
  weekendColumn: { backgroundColor: 'rgba(127,127,127,0.04)' },
  offHours: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.14)' },
  block: {
    position: 'absolute', borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, paddingHorizontal: 4, paddingVertical: 2,
    overflow: 'hidden',
  },
  blockActive: { borderWidth: 1.5, borderLeftWidth: 3, zIndex: 3, elevation: 4, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  blockTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  blockTitle: { flex: 1, color: colors.text.primary, fontSize: 12, fontWeight: '600' },
  blockTitleNarrow: { fontSize: 10.5 },
  blockMeta: { color: colors.text.secondary, fontSize: 10.5, fontVariant: ['tabular-nums'] },
  blockSpinner: { transform: [{ scale: 0.6 }] },
  dragLabel: {
    position: 'absolute', left: 2, right: 2, alignItems: 'center', zIndex: 4,
  },
  dragLabelText: {
    color: colors.background.primary, backgroundColor: colors.primary.gold, fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8, overflow: 'hidden', fontVariant: ['tabular-nums'],
  },
  nowLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: colors.status.error, zIndex: 5 },
  nowDot: { position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.status.error },
  month: { flex: 1, paddingHorizontal: 2 },
  monthHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  monthWeekday: { flex: 1, textAlign: 'center', color: colors.text.secondary, fontSize: 11, textTransform: 'uppercase' },
  monthRow: { flex: 1, flexDirection: 'row', minHeight: 64, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default },
  monthCell: { flex: 1, padding: 2, gap: 2, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border.default },
  monthOutside: { opacity: 0.45 },
  monthDay: { alignSelf: 'center', minWidth: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  monthToday: { backgroundColor: colors.primary.gold },
  monthDayText: { color: colors.text.primary, fontSize: 12, fontWeight: '600' },
  monthTodayText: { color: colors.background.primary },
  monthChip: { borderLeftWidth: 2, borderRadius: 3, paddingHorizontal: 2, paddingVertical: 1 },
  monthChipText: { color: colors.text.primary, fontSize: 9.5 },
  monthMore: { color: colors.primary.gold, fontSize: 10, textAlign: 'center' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.background.secondary, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 6, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderColor: colors.border.default, width: '100%', maxWidth: 680, alignSelf: 'center',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border.hover, marginBottom: 6 },
  card: { flexDirection: 'row', borderRadius: 14, overflow: 'hidden', backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.hover, flexShrink: 1 },
  cardStripe: { width: 5 },
  cardBody: { flex: 1, padding: spacing.md, gap: spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  cardTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '600' },
  cardIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  cardCount: { color: colors.text.tertiary, fontSize: 12, alignSelf: 'center', minWidth: 30, textAlign: 'center' },
  badge: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  cardFacts: { gap: 6 },
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
