import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, Sheet, SelectList, SheetActions, afterModal, kit } from '../Inquiries/InquiryKit';
import { useTabletLayout } from '../../hooks/useTabletLayout';
import { layoutTimeline } from '../../lib/meetingStatus';
import { addDays, isSameDay, startOfDay, withOpacity } from '../../lib/scheduleTimeline';
import {
  DEPARTMENTS,
  availabilityColor,
  availabilityKindLabel,
  availabilityTime,
  availabilityTitle,
  departmentLabel,
  schedulePersonName,
  type AvailabilityBlock,
  type Department,
  type SchedulePerson,
} from '../../lib/teamAvailability';
import { fetchAvailability, fetchSchedulePeople, peopleSelectionMemory } from '../../lib/teamAvailabilityApi';
import TimelineSheet from './TimelineSheet';
import { colors, spacing } from '../../theme';

/*
 * Spotkania → „Pracownicy” w telefonie i na tablecie — jak w CRM i na Macu (docs/team-availability.md): wybrany dzień, godziny
 * w pionie, kolumna dla każdej wybranej osoby z zakresu planu (przy wielu osobach — przewijanie w bok). Spotkania, eventy, fazy
 * i nieobecności; spotkania prywatne innych osób i osoby spoza zakresu — „Zajęty”. Dotknięcie pozycji — szczegóły w oknie
 * (spotkanie / event — „Otwórz”), przytrzymanie wolnej godziny w kolumnie osoby — nowe spotkanie z tą osobą.
 */

const HOUR = 52;
const LABEL = 44;
const SNAP = 15;
const WORK_START = 8;
const WORK_END = 18;
const MAX_PEOPLE = 20;
const WEEKDAY = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });

const pad2 = (value: number) => String(value).padStart(2, '0');
/** Cały dzień albo co najmniej doba — wiersz „Cały dzień”. */
const wholeDay = (block: AvailabilityBlock) => block.allDay || Date.parse(block.end) - Date.parse(block.start) >= 24 * 60 * 60 * 1000;

type Placed = { id: string; block: AvailabilityBlock; start: number; end: number; column: number; columns: number };

export default function TeamAvailabilityTimeline({ day, onDayChange, refreshKey, onOpenMeeting, onOpenEvent, onCreate }: {
  day: Date;
  onDayChange: (day: Date) => void;
  /** Zmienia się po zapisie spotkania — odświeża zajętość. */
  refreshKey: number;
  onOpenMeeting: (id: string) => void;
  onOpenEvent: (id: string) => void;
  /** Nowe spotkanie w wybranej godzinie z osobą z kolumny (bez siebie). */
  onCreate: (start: Date, end: Date, employeeIds: string[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const { tablet } = useTabletLayout();
  const verticalRef = useRef<ScrollView>(null);
  const [people, setPeople] = useState<SchedulePerson[]>([]);
  const [selected, setSelected] = useState<string[]>(() => peopleSelectionMemory.get() ?? []);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detail, setDetail] = useState<AvailabilityBlock | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const updateSelected = useCallback((ids: string[]) => {
    const next = Array.from(new Set(ids)).slice(0, MAX_PEOPLE);
    peopleSelectionMemory.set(next);
    setSelected(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSchedulePeople()
      .then((list) => {
        if (cancelled) return;
        setPeople(list);
        const known = new Set(list.map((person) => person.id));
        const remembered = (peopleSelectionMemory.get() ?? []).filter((id) => known.has(id));
        if (remembered.length) {
          updateSelected(remembered);
          return;
        }
        // Domyślnie: ja i mój dział (najwyżej 8 osób).
        const self = list.find((person) => person.isSelf);
        const mine = self ? list.filter((person) => !person.isSelf && person.department === self.department).slice(0, 7) : [];
        updateSelected([...(self ? [self.id] : []), ...mine.map((person) => person.id)]);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać pracowników.');
      });
    return () => {
      cancelled = true;
    };
  }, [updateSelected]);

  const byId = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const columns = useMemo(() => selected.map((id) => byId.get(id)).filter((person): person is SchedulePerson => Boolean(person)), [selected, byId]);
  const dayStart = useMemo(() => startOfDay(day), [day]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);
  const columnKey = columns.map((person) => person.id).join(',');

  useEffect(() => {
    if (!columnKey) {
      setBlocks([]);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    fetchAvailability(columnKey.split(','), dayStart, dayEnd)
      .then((next) => {
        if (cancelled) return;
        setBlocks(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać zajętości.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [columnKey, dayStart, dayEnd, refreshKey]);

  // Początek dnia pracy albo „teraz” (dziś) — po zmianie dnia i po pierwszym ułożeniu siatki.
  const bodyHeight = size?.height ?? 0;
  useEffect(() => {
    const today = isSameDay(dayStart, new Date());
    const hour = today ? Math.max(0, new Date().getHours() - 1.5) : WORK_START - 1;
    const timer = setTimeout(() => verticalRef.current?.scrollTo({ y: hour * HOUR, animated: false }), 50);
    return () => clearTimeout(timer);
  }, [dayStart, bodyHeight]);

  const allDayBlocks = useMemo(() => blocks.filter(wholeDay), [blocks]);
  const placed = useMemo(() => columns.map((person) => layoutTimeline(
    blocks
      .filter((block) => block.employeeId === person.id && !wholeDay(block))
      .map((block, index): Omit<Placed, 'column' | 'columns'> => {
        const start = new Date(block.start);
        const end = new Date(block.end);
        const from = start < dayStart ? 0 : start.getHours() * 60 + start.getMinutes();
        const to = end >= dayEnd ? 24 * 60 : Math.max(from + SNAP, (end.getTime() - dayStart.getTime()) / 60000);
        return { id: `${block.kind}-${block.itemId ?? index}-${block.start}`, block, start: from, end: Math.min(24 * 60, to) };
      }),
  ) as Placed[]), [blocks, columns, dayStart, dayEnd]);

  const columnWidth = size && columns.length
    ? Math.max(tablet ? 160 : 118, (size.width - LABEL) / columns.length)
    : 0;
  const total = LABEL + columnWidth * Math.max(1, columns.length);
  const today = isSameDay(dayStart, now);
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  const createAt = (person: SchedulePerson, y: number) => {
    const minute = Math.max(0, Math.min(24 * 60 - 60, Math.floor(((y / HOUR) * 60) / 30) * 30));
    const start = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, minute);
    onCreate(start, new Date(start.getTime() + 60 * 60 * 1000), person.isSelf ? [] : [person.id]);
  };

  const open = (block: AvailabilityBlock) => {
    setDetail(null);
    if (!block.detailed || !block.itemId) return;
    const id = block.itemId;
    afterModal(() => {
      if (block.kind === 'meeting') onOpenMeeting(id);
      else if (block.kind === 'event' || block.kind === 'phase') onOpenEvent(id);
    });
  };

  const options = useMemo(() => [...people]
    .sort((a, b) => DEPARTMENTS.findIndex((d) => d.value === a.department) - DEPARTMENTS.findIndex((d) => d.value === b.department)
      || schedulePersonName(a).localeCompare(schedulePersonName(b), 'pl'))
    .map((person) => ({
      id: person.id,
      label: `${schedulePersonName(person)}${person.isSelf ? ' (Ty)' : ''}`,
      detail: `${departmentLabel(person.department)}${person.isSubordinate ? ' · podwładny' : ''}${person.occupation ? ` · ${person.occupation}` : ''}`,
    })), [people]);
  const departments = DEPARTMENTS.filter((option) => people.some((person) => person.department === option.value));
  const addDepartment = (department: Department) =>
    updateSelected([...selected, ...people.filter((person) => person.department === department).map((person) => person.id)]);

  const detailPerson = detail ? byId.get(detail.employeeId) : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => onDayChange(addDays(dayStart, -1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Poprzedni dzień">
            <Feather name="chevron-left" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDayChange(new Date())} style={styles.todayButton} accessibilityRole="button">
            <Text style={styles.todayButtonText}>Dziś</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDayChange(addDays(dayStart, 1))} style={styles.navButton} accessibilityRole="button" accessibilityLabel="Następny dzień">
            <Feather name="chevron-right" size={20} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.dayLabel} numberOfLines={1}>{WEEKDAY.format(dayStart)}</Text>
          {loading ? <ActivityIndicator size="small" color={colors.primary.gold} /> : null}
        </View>
        <View style={styles.navRow}>
          <TouchableOpacity onPress={() => setPickerOpen(true)} style={styles.peopleButton} accessibilityRole="button">
            <Feather name="users" size={15} color={colors.primary.gold} />
            <Text style={styles.peopleButtonText}>Osoby ({columns.length})</Text>
          </TouchableOpacity>
          <Text style={styles.hint} numberOfLines={2}>Przytrzymaj wolną godzinę w kolumnie osoby, aby zaplanować z nią spotkanie.</Text>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.body} onLayout={(event) => setSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
        {size && columns.length ? (
          <ScrollView horizontal bounces={false} showsHorizontalScrollIndicator={columns.length * columnWidth + LABEL > size.width}>
            <View style={{ width: total, height: size.height }}>
              <View style={styles.headerRow}>
                <View style={{ width: LABEL }} />
                {columns.map((person) => (
                  <View key={person.id} style={[styles.headerCell, { width: columnWidth }]}>
                    <Text style={styles.headerName} numberOfLines={1}>{schedulePersonName(person)}{person.isSelf ? ' (Ty)' : ''}</Text>
                    <Text style={styles.headerSub} numberOfLines={1}>{person.occupation || departmentLabel(person.department)}</Text>
                  </View>
                ))}
              </View>
              {allDayBlocks.length ? (
                <View style={styles.allDayRow}>
                  <Text style={[styles.allDayLabel, { width: LABEL }]}>Cały dzień</Text>
                  {columns.map((person) => (
                    <View key={person.id} style={[styles.allDayCell, { width: columnWidth }]}>
                      {allDayBlocks.filter((block) => block.employeeId === person.id).map((block, index) => {
                        const color = availabilityColor(block);
                        return (
                          <TouchableOpacity key={`${block.kind}-${block.itemId ?? index}-${block.start}`} onPress={() => setDetail(block)}
                            style={[styles.allDayChip, { backgroundColor: withOpacity(color, block.tentative ? 0.14 : 0.28), borderLeftColor: color }]}>
                            <View style={styles.titleRow}>
                              {block.detailed ? null : <Feather name="lock" size={10} color={colors.text.secondary} />}
                              <Text style={[styles.allDayText, styles.flexShrink]} numberOfLines={1}>{availabilityTitle(block)}</Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))}
                </View>
              ) : null}
              <ScrollView ref={verticalRef} style={styles.flex} showsVerticalScrollIndicator={false}>
                <View style={[styles.gridRow, { height: 24 * HOUR }]}>
                  <View style={{ width: LABEL }}>
                    {Array.from({ length: 23 }, (_, index) => (
                      <Text key={index} style={[styles.hourLabel, { top: (index + 1) * HOUR - 7 }]}>{pad2(index + 1)}:00</Text>
                    ))}
                  </View>
                  {columns.map((person, columnIndex) => (
                    <Pressable key={person.id} onLongPress={(event) => createAt(person, event.nativeEvent.locationY)} delayLongPress={350}
                      style={[styles.column, { width: columnWidth }, today && styles.todayColumn]}
                      accessibilityLabel={`Plan: ${schedulePersonName(person)}`}>
                      <View pointerEvents="none" style={[styles.offHours, { top: 0, height: WORK_START * HOUR }]} />
                      <View pointerEvents="none" style={[styles.offHours, { top: WORK_END * HOUR, height: (24 - WORK_END) * HOUR }]} />
                      {Array.from({ length: 23 }, (_, index) => (
                        <View key={index} pointerEvents="none" style={[styles.hourLine, { top: (index + 1) * HOUR }]} />
                      ))}
                      {(placed[columnIndex] ?? []).map((item) => {
                        const { block } = item;
                        const color = availabilityColor(block);
                        const height = Math.max(16, ((item.end - item.start) / 60) * HOUR - 2);
                        const width = columnWidth / item.columns;
                        return (
                          <TouchableOpacity key={item.id} onPress={() => setDetail(block)} activeOpacity={0.75}
                            style={[styles.block, {
                              top: (item.start / 60) * HOUR + 1, height, left: item.column * width + 1, width: width - 3,
                              backgroundColor: withOpacity(color, block.tentative ? 0.14 : 0.3), borderLeftColor: color,
                              borderColor: withOpacity(color, 0.55),
                            }]}
                            accessibilityRole="button" accessibilityLabel={`${availabilityTitle(block)}, ${availabilityTime(block)}`}>
                            <View style={styles.titleRow}>
                              {block.detailed ? null : <Feather name="lock" size={10} color={colors.text.secondary} />}
                              <Text style={[styles.blockTitle, styles.flexShrink]} numberOfLines={height >= 34 ? 2 : 1}>{availabilityTitle(block)}</Text>
                            </View>
                            {height >= 34 ? <Text style={styles.blockMeta} numberOfLines={1}>{availabilityTime(block)}</Text> : null}
                          </TouchableOpacity>
                        );
                      })}
                      {today ? <View pointerEvents="none" style={[styles.nowLine, { top: (nowMinute / 60) * HOUR }]} /> : null}
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            </View>
          </ScrollView>
        ) : size ? (
          <Text style={styles.empty}>{people.length ? 'Wybierz osoby, których plan chcesz zobaczyć.' : error ? '' : 'Wczytywanie pracowników…'}</Text>
        ) : null}
      </View>

      {/* Szuflada od dołu — zamyka ją przeciągnięcie uchwytu w dół, dotknięcie tła albo „Zamknij” (`TimelineSheet`). */}
      <TimelineSheet visible={detail !== null} onClose={() => setDetail(null)} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
        {detail ? (
          <View style={styles.card}>
            <View style={[styles.cardStripe, { backgroundColor: availabilityColor(detail) }]} />
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={3}>{availabilityTitle(detail)}</Text>
              <View style={styles.fact}>
                <Feather name="clock" size={14} color={colors.primary.gold} />
                <Text style={styles.factText}>{availabilityTime(detail)}{detail.tentative ? ' · niepotwierdzone' : ''}</Text>
              </View>
              {detailPerson ? (
                <View style={styles.fact}>
                  <Feather name="user" size={14} color={colors.primary.gold} />
                  <Text style={styles.factText}>{schedulePersonName(detailPerson)}</Text>
                </View>
              ) : null}
              {detail.detailed ? (
                <View style={styles.fact}>
                  <Feather name="tag" size={14} color={colors.primary.gold} />
                  <Text style={styles.factText}>{availabilityKindLabel(detail.kind)}</Text>
                </View>
              ) : (
                <Text style={styles.muted}>Szczegóły tej pozycji nie są widoczne w Twoim zakresie planu.</Text>
              )}
              {detail.subtitle ? (
                <View style={styles.fact}>
                  <Feather name="map-pin" size={14} color={colors.primary.gold} />
                  <Text style={styles.factText}>{detail.subtitle}</Text>
                </View>
              ) : null}
              <View style={styles.actions}>
                {detail.detailed && detail.itemId && detail.kind !== 'absence' ? (
                  <TouchableOpacity onPress={() => open(detail)} style={[styles.action, styles.actionPrimary]} accessibilityRole="button">
                    <Feather name="maximize-2" size={15} color={colors.background.primary} />
                    <Text style={[styles.actionText, styles.actionPrimaryText]}>Otwórz</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => setDetail(null)} style={styles.action} accessibilityRole="button">
                  <Text style={styles.actionText}>Zamknij</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}
      </TimelineSheet>

      <Sheet visible={pickerOpen} title="Osoby" subtitle={`Najwyżej ${MAX_PEOPLE} osób naraz · wybrano ${selected.length}`}
        onClose={() => setPickerOpen(false)}
        footer={<SheetActions cancelLabel="Tylko ja" onCancel={() => updateSelected(people.filter((person) => person.isSelf).map((person) => person.id))}
          onConfirm={() => setPickerOpen(false)} label="Gotowe" />}>
        {departments.length ? (
          <View style={styles.chips}>
            {departments.map((option) => (
              <Chip key={option.value} label={`Cały dział: ${option.label}`} active={false} onPress={() => addDepartment(option.value)} />
            ))}
          </View>
        ) : null}
        <SelectList multiple searchable options={options} selected={selected} maxHeight={360} emptyText="Brak osób do wyboru."
          onToggle={(id) => {
            if (selected.includes(id)) updateSelected(selected.filter((value) => value !== id));
            else if (selected.length < MAX_PEOPLE) updateSelected([...selected, id]);
          }} />
        <Text style={kit.muted}>Zakres planu wynika z działu: Zarząd — wszyscy; Sprzedaż i Biuro — Sprzedaż, Biuro i Magazyn; Magazyn — swój dział; przełożony — także podwładni.</Text>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  container: { flex: 1 },
  toolbar: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.secondary },
  todayButton: {
    height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center', backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.hover,
  },
  todayButtonText: { color: colors.primary.gold, fontSize: 13, fontWeight: '600' },
  dayLabel: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '600', marginLeft: 4 },
  peopleButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18,
    backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.hover,
  },
  peopleButtonText: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  hint: { flex: 1, color: colors.text.tertiary, fontSize: 11 },
  error: { color: colors.status.error, fontSize: 13 },
  empty: { color: colors.text.tertiary, fontSize: 13, padding: spacing.md },
  body: { flex: 1, borderTopWidth: 1, borderTopColor: colors.border.default },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.default },
  headerCell: { paddingHorizontal: 6, paddingVertical: 6, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border.default },
  headerName: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  headerSub: { color: colors.text.tertiary, fontSize: 11 },
  allDayRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border.default, paddingVertical: 3 },
  allDayLabel: { color: colors.text.tertiary, fontSize: 9, textTransform: 'uppercase', textAlign: 'right', paddingRight: 6, paddingTop: 4 },
  allDayCell: { gap: 2, paddingHorizontal: 2 },
  allDayChip: { borderLeftWidth: 3, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 3 },
  allDayText: { color: colors.text.primary, fontSize: 11, fontWeight: '600' },
  gridRow: { flexDirection: 'row' },
  hourLabel: { position: 'absolute', right: 6, color: colors.text.tertiary, fontSize: 10, fontVariant: ['tabular-nums'] },
  column: { position: 'relative', borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border.default },
  todayColumn: { backgroundColor: colors.primary.gold + '0d' },
  offHours: { position: 'absolute', left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.14)' },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border.default },
  block: {
    position: 'absolute', borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, paddingHorizontal: 4, paddingVertical: 2,
    overflow: 'hidden',
  },
  blockTitle: { color: colors.text.primary, fontSize: 11.5, fontWeight: '600' },
  blockMeta: { color: colors.text.secondary, fontSize: 10.5, fontVariant: ['tabular-nums'] },
  nowLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: colors.status.error, zIndex: 5 },
  sheet: {
    backgroundColor: colors.background.secondary, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 6, paddingHorizontal: spacing.sm,
    borderWidth: 1, borderColor: colors.border.default, width: '100%', maxWidth: 680, alignSelf: 'center',
  },
  card: { flexDirection: 'row', borderRadius: 14, overflow: 'hidden', backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.hover },
  cardStripe: { width: 5 },
  cardBody: { flex: 1, padding: spacing.md, gap: spacing.sm },
  cardTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '600' },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  factText: { flex: 1, color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
  muted: { color: colors.text.tertiary, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 4 },
  action: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border.hover, backgroundColor: colors.background.primary,
  },
  actionPrimary: { backgroundColor: colors.primary.gold, borderColor: colors.primary.gold },
  actionText: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  actionPrimaryText: { color: colors.background.primary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});

