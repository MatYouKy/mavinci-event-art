import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  navigateToClients,
  navigateToInquiry,
  navigateToMeeting,
  navigateToTask,
  routeSalesUrl,
} from '../navigation/navigationRef';
import { colors, spacing, typography, borderRadius } from '../theme';

/*
 * „Mój plan” na pulpicie — te same dane co oś czasu na pulpicie CRM (get_employee_schedule,
 * migracja 20261109140000_employee_schedule.sql): wydarzenia, fazy, spotkania, kontakty w zapytaniach,
 * zadania z terminem, oddzwonienia i nieobecności. Dziś albo dziś i dwa kolejne dni; na telefonie — lista godzin.
 * Starsza baza bez funkcji → sekcja ukryta.
 */

type Kind = 'event' | 'phase' | 'meeting' | 'inquiry' | 'task' | 'call' | 'absence';
type Item = {
  kind: Kind;
  itemId: string;
  title: string;
  subtitle: string | null;
  start: number;
  end: number;
  allDay: boolean;
  status: string | null;
  color: string;
  url: string | null;
};

const KIND_LABELS: Record<Kind, string> = {
  event: 'Wydarzenie',
  phase: 'Faza wydarzenia',
  meeting: 'Spotkanie',
  inquiry: 'Kontakt w zapytaniu',
  task: 'Zadanie',
  call: 'Oddzwonienie',
  absence: 'Nieobecność',
};
const KIND_ICONS: Record<Kind, keyof typeof Feather.glyphMap> = {
  event: 'calendar',
  phase: 'layers',
  meeting: 'users',
  inquiry: 'inbox',
  task: 'check-square',
  call: 'phone-call',
  absence: 'sun',
};
const KINDS = new Set(Object.keys(KIND_LABELS));
const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (value: number) => { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; };
const addDays = (value: Date, days: number) => { const date = new Date(value); date.setDate(date.getDate() + days); return date; };
const time = (value: number) => new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

function parseRows(data: unknown, employeeId: string): Item[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row: any) => {
    const start = Date.parse(row?.starts_at);
    const end = Date.parse(row?.ends_at);
    if (row?.employee_id !== employeeId || !KINDS.has(row?.kind) || !Number.isFinite(start) || !Number.isFinite(end)) return [];
    const kind = row.kind as Kind;
    return [{
      kind,
      itemId: String(row.item_id ?? ''),
      title: typeof row.title === 'string' && row.title.trim() ? row.title : KIND_LABELS[kind],
      subtitle: typeof row.subtitle === 'string' && row.subtitle.trim() ? row.subtitle : null,
      start,
      end: Math.max(end, start + 15 * 60 * 1000),
      allDay: row.all_day === true,
      status: typeof row.status === 'string' ? row.status : null,
      color: typeof row.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(row.color) ? row.color : colors.primary.gold,
      url: typeof row.url === 'string' && row.url.startsWith('/') ? row.url : null,
    }];
  });
}

/** Spotkanie, zadanie i zapytanie otwierają się w aplikacji; wydarzenie przez routeSalesUrl (zakładki jak w CRM). */
function openItem(item: Item) {
  if (item.kind === 'meeting') { navigateToMeeting(item.itemId); return; }
  if (item.kind === 'task') { navigateToTask(item.itemId); return; }
  if (item.kind === 'inquiry') { navigateToInquiry(item.itemId); return; }
  if (routeSalesUrl(item.url)) return;
  if (item.kind === 'call' && item.url?.startsWith('/crm/contacts/')) navigateToClients();
}

const canOpen = (item: Item) => item.kind !== 'absence' && (item.kind !== 'call' || Boolean(item.url));

function dayTitle(day: Date, today: Date) {
  const diff = Math.round((startOfDay(day.getTime()).getTime() - today.getTime()) / DAY);
  const date = day.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
  if (diff === 0) return `Dziś · ${date}`;
  if (diff === 1) return `Jutro · ${date}`;
  const weekday = day.toLocaleDateString('pl-PL', { weekday: 'long' });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · ${date}`;
}

function itemTime(item: Item, dayStart: number) {
  if (item.allDay) return 'cały dzień';
  const from = item.start < dayStart ? 'od wczoraj' : time(item.start);
  const to = item.end > dayStart + DAY ? 'dalej' : time(item.end);
  return `${from}–${to}`;
}

export default function MyScheduleSection({ refreshKey }: { refreshKey: number }) {
  const { employee } = useAuth();
  const [days, setDays] = useState<1 | 3>(3);
  const [items, setItems] = useState<Item[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const today = useMemo(() => startOfDay(now), [now]);
  const todayKey = today.getTime();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!employee?.id) return;
    const from = new Date(todayKey);
    const { data, error } = await supabase.rpc('get_employee_schedule', {
      p_employee_ids: [employee.id],
      p_from: from.toISOString(),
      p_to: addDays(from, 3).toISOString(),
    });
    // Brak funkcji w starszej bazie albo błąd — sekcja znika, pulpit działa dalej.
    setItems(error ? null : parseRows(data, employee.id));
  }, [employee?.id, todayKey]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!items) return null;

  const groups = Array.from({ length: days }, (_, index) => {
    const day = addDays(today, index);
    const start = day.getTime();
    const end = addDays(day, 1).getTime();
    const dayItems = items
      .filter((item) => item.start < end && item.end > start)
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
    return { day, start, items: dayItems };
  });
  const todayCount = groups[0]?.items.length ?? 0;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Mój plan</Text>
          <Text style={styles.subtitle}>
            {todayCount === 0 ? 'Dziś nic nie zaplanowano' : `Dziś: ${todayCount} ${todayCount === 1 ? 'pozycja' : todayCount < 5 ? 'pozycje' : 'pozycji'}`}
          </Text>
        </View>
        <View style={styles.toggle} accessibilityRole="radiogroup">
          {([1, 3] as const).map((value) => (
            <TouchableOpacity
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: days === value }}
              onPress={() => setDays(value)}
              style={[styles.toggleItem, days === value && styles.toggleItemActive]}
            >
              <Text style={[styles.toggleText, days === value && styles.toggleTextActive]}>{value === 1 ? 'Dziś' : '3 dni'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {groups.map((group) => (
        <View key={group.start} style={styles.group}>
          <Text style={[styles.dayTitle, group.start === todayKey && styles.dayTitleToday]}>{dayTitle(group.day, today)}</Text>
          {group.items.length === 0 ? (
            <Text style={styles.empty}>Nic nie zaplanowano</Text>
          ) : group.items.map((item) => {
            const past = item.end <= now;
            const current = !item.allDay && item.start <= now && item.end > now;
            return (
              <TouchableOpacity
                key={`${item.kind}-${item.itemId}-${item.start}`}
                disabled={!canOpen(item)}
                onPress={() => openItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`${KIND_LABELS[item.kind]}: ${item.title}, ${itemTime(item, group.start)}`}
                style={[styles.row, { backgroundColor: `${item.color}26` }, past && styles.rowPast]}
              >
                <View style={[styles.bar, { backgroundColor: item.color }]} />
                <Text style={[styles.time, current && styles.timeCurrent]}>{itemTime(item, group.start)}</Text>
                <View style={styles.body}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {KIND_LABELS[item.kind]}{item.subtitle ? ` · ${item.subtitle}` : ''}{item.status === 'pending' ? ' · czeka na potwierdzenie' : ''}
                  </Text>
                </View>
                <Feather name={KIND_ICONS[item.kind]} size={15} color={colors.text.tertiary} />
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { margin: spacing.md, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold, color: colors.text.primary,
  },
  subtitle: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  toggle: { flexDirection: 'row', padding: 2, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  toggleItem: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: borderRadius.sm },
  toggleItemActive: { backgroundColor: 'rgba(211, 187, 115, 0.18)' },
  toggleText: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  toggleTextActive: { color: colors.primary.gold },
  group: { gap: 6 },
  dayTitle: { fontSize: typography.fontSizes.sm, color: colors.text.primary, marginTop: spacing.xs },
  dayTitleToday: { color: colors.primary.gold },
  empty: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingVertical: 6, paddingRight: spacing.sm, borderRadius: borderRadius.md, overflow: 'hidden' },
  rowPast: { opacity: 0.5 },
  bar: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginLeft: 6 },
  time: { width: 86, fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  timeCurrent: { color: colors.status.error, fontWeight: typography.fontWeights.semibold },
  body: { flex: 1, gap: 1 },
  rowTitle: { fontSize: typography.fontSizes.sm, color: colors.text.primary },
  rowSub: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
});
