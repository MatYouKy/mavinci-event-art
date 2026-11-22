import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, withAlpha } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from './EmployeeAvatar';
import BrandHeading from './BrandHeading';
import TimeEntryDiscussions from './TimeEntryDiscussions';
import { useNotice } from './Inquiries/InquiryKit';
import {
  TIME_PERIOD_KINDS, avatarMetadata, dayDate, formatWorkMinutes, plural, timeGet, timePeriodLabel, timePeriodRange, timePost, workClock,
  workLabel, workMoney, workTime, type TimeActiveItem, type TimeDashboard, type TimeDay, type TimePeriod,
} from '../lib/timeTrackingApi';

/*
 * Czas pracy — widok administratora w aplikacji (administrator nie liczy własnego czasu, rozlicza zespół): kto teraz pracuje
 * i nad czym (licznik na żywo), okres z przesuwaniem, kafelki sumy, pracownicy z czasem w okresie (dotknięcie — strona
 * pracownika z wpisami i historią zmian), rozmowy „do wyjaśnienia” i aktywność dzienna. Dane: `/bridge/native/v1/time`
 * (`op=dashboard`, jak raport zespołu na Macu). Odświeżanie co 30 s, gdy ekran jest widoczny.
 */

export const workTimeGreen = '#4ade80';

type Props = {
  /** Nad treścią (wymiar czasu pracy miesiąca). */
  header?: React.ReactNode;
  /** Rozmowa wskazana w powiadomieniu. */
  discussionEntryId?: string;
  discussionRequestId?: number;
};

/** Wybór okresu: rodzaj (dzień / tydzień / miesiąc / rok) i przesuwanie strzałkami. */
export function TimePeriodBar({ period, onChange, busy }: { period: TimePeriod; onChange: (next: TimePeriod) => void; busy?: boolean }) {
  return (
    <View style={styles.card}>
      <View style={styles.kinds}>
        {TIME_PERIOD_KINDS.map((kind) => {
          const selected = kind.key === period.kind;
          return (
            <TouchableOpacity key={kind.key} onPress={() => onChange({ kind: kind.key, offset: 0 })} style={[styles.kind, selected && styles.kindSelected]}
              accessibilityRole="button" accessibilityState={{ selected }}>
              <Text style={[styles.kindText, selected && styles.kindTextSelected]}>{kind.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.periodRow}>
        <TouchableOpacity onPress={() => onChange({ ...period, offset: period.offset - 1 })} style={styles.arrow} accessibilityLabel="Poprzedni okres">
          <Feather name="chevron-left" size={20} color={colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.periodLabelBox}>
          <Text style={styles.periodLabel} numberOfLines={1}>{timePeriodLabel(period)}</Text>
          {busy ? <ActivityIndicator size="small" color={colors.primary.gold} /> : null}
        </View>
        <TouchableOpacity onPress={() => onChange({ ...period, offset: period.offset + 1 })} style={styles.arrow} accessibilityLabel="Następny okres">
          <Feather name="chevron-right" size={20} color={colors.text.primary} />
        </TouchableOpacity>
      </View>
      {period.offset !== 0 ? (
        <TouchableOpacity onPress={() => onChange({ ...period, offset: 0 })} style={styles.current}>
          <Text style={styles.currentText}>{period.kind === 'day' ? 'Wróć do dziś' : 'Wróć do bieżącego okresu'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function TimeTile({ icon, title, value }: { icon: React.ComponentProps<typeof Feather>['name']; title: string; value: string }) {
  return (
    <View style={styles.tile}>
      <Feather name={icon} size={16} color={colors.primary.gold} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileTitle}>{title}</Text>
    </View>
  );
}

export function TimeBar({ fraction }: { fraction: number }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }]} />
    </View>
  );
}

export function TimePill({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.pill, { color, backgroundColor: withAlpha(color, 0.15) }]}>{text}</Text>;
}

/** Aktywność według miesięcy (okres „Rok”). */
function monthly(days: TimeDay[]) {
  const months = new Map<string, { key: string; minutes: number; entries: number }>();
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const month = months.get(key) ?? { key, minutes: 0, entries: 0 };
    month.minutes += day.minutes;
    month.entries += day.entries;
    months.set(key, month);
  }
  return [...months.values()];
}

export default function TimeTeamDashboard({ header, discussionEntryId, discussionRequestId }: Props) {
  const navigation = useNavigation<any>();
  const { employee } = useAuth();
  const notice = useNotice();
  const [period, setPeriod] = useState<TimePeriod>({ kind: 'day', offset: 0 });
  const [data, setData] = useState<TimeDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showIdle, setShowIdle] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const range = useMemo(() => timePeriodRange(period), [period]);

  const load = useCallback(async (refresh = false) => {
    const id = ++request.current;
    if (refresh) setRefreshing(true);
    try {
      const next = await timeGet<TimeDashboard>('dashboard', { from: range.from, to: range.to });
      if (id !== request.current) return;
      setData(next);
      setError(null);
    } catch (cause) {
      if (id !== request.current) return;
      setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać czasu pracy.');
    } finally {
      if (id === request.current) setRefreshing(false);
    }
  }, [range.from, range.to]);

  // Odświeżanie przy wejściu na ekran, po zmianie okresu, co 30 s i po powrocie do aplikacji.
  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 30_000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [load]));

  const active: TimeActiveItem[] = useMemo(() => data?.active
    ?? (data?.people ?? []).filter((person) => person.active).map((person) => ({ ...person.active!, avatarUrl: person.avatarUrl, avatar: person.avatar })),
  [data]);

  useEffect(() => {
    if (!active.length) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active.length]);

  const openEmployee = (id: string, name: string) => navigation.navigate('TimeEmployee', { employeeId: id, name, kind: period.kind, offset: period.offset });

  const stopOwn = (entry: TimeActiveItem) => {
    Alert.alert('Zakończyć licznik?', `${workLabel(entry)} — od ${workTime(entry.start)}`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Zakończ', style: 'destructive',
        onPress: () => {
          void notice.run('Zatrzymuję licznik…', () => timePost('stop', { id: entry.id }), 'Licznik zatrzymany.').then((reply) => {
            if (reply) void load();
          });
        },
      },
    ]);
  };

  const stale = !data || data.range.from !== range.from || data.range.to !== range.to;
  const activeIds = new Set(active.map((entry) => entry.employeeId));
  const peopleIds = new Set((data?.people ?? []).map((person) => person.id));
  const idle = (data?.employees ?? []).filter((option) => !peopleIds.has(option.id));
  const total = data?.totals.minutes ?? 0;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary.gold} />}
      >
        {header}

        <View style={styles.sectionHeader}>
          <BrandHeading style={styles.sectionTitle}>{`Aktywni teraz${data ? ` · ${active.length}` : ''}`}</BrandHeading>
        </View>
        {!data && !error ? (
          <ActivityIndicator style={styles.loader} size="large" color={colors.primary.gold} />
        ) : !data && error ? (
          <View style={styles.card}>
            <Text style={styles.error}>{error}</Text>
            <TouchableOpacity style={styles.retry} onPress={() => void load(true)}><Text style={styles.retryText}>Spróbuj ponownie</Text></TouchableOpacity>
          </View>
        ) : active.length === 0 ? (
          <View style={styles.card}><Text style={styles.muted}>Nikt teraz nie pracuje — żaden licznik czasu nie jest włączony.</Text></View>
        ) : active.map((entry) => {
          const own = entry.employeeId === employee?.id;
          return (
            <TouchableOpacity key={entry.id} style={styles.activeCard} activeOpacity={0.75} onPress={() => openEmployee(entry.employeeId, entry.employeeName)}
              accessibilityRole="button" accessibilityLabel={`${entry.employeeName}: ${workLabel(entry)}`}>
              <View>
                <EmployeeAvatar avatarUrl={entry.avatarUrl} avatarMetadata={avatarMetadata(entry.avatar)} employeeName={entry.employeeName} size={44} />
                <View style={styles.dot} />
              </View>
              <View style={styles.flex}>
                <View style={styles.rowBetween}>
                  <Text style={styles.name} numberOfLines={1}>{entry.employeeName || 'Pracownik'}</Text>
                  <Text style={styles.clock}>{workClock(entry.start, now)}</Text>
                </View>
                <View style={styles.rowBetween}>
                  <Text style={styles.working} numberOfLines={2}>{workLabel(entry)}</Text>
                  <Text style={styles.since}>od {workTime(entry.start)}</Text>
                </View>
                {!!entry.eventName && <Text style={styles.event} numberOfLines={1}>Event: {entry.eventName}</Text>}
                {!!entry.description && <Text style={styles.description} numberOfLines={2}>{entry.description}</Text>}
                {own ? (
                  <View style={styles.ownRow}>
                    <Text style={styles.muted}>To Twój licznik</Text>
                    <TouchableOpacity style={styles.stop} onPress={() => stopOwn(entry)} accessibilityLabel="Zakończ swój licznik">
                      <Feather name="square" size={12} color={colors.white} />
                      <Text style={styles.stopText}>Zakończ</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        })}

        <TimePeriodBar period={period} onChange={setPeriod} busy={!!data && stale} />
        {data && error ? <Text style={[styles.error, styles.inlineError]}>{error}</Text> : null}

        {data ? (
          <View style={stale ? styles.dimmed : undefined}>
            <View style={styles.tiles}>
              <TimeTile icon="clock" title="Łączny czas" value={formatWorkMinutes(data.totals.minutes)} />
              <TimeTile icon="trending-up" title="Rozliczalny" value={formatWorkMinutes(data.totals.billableMinutes)} />
              <TimeTile icon="users" title="Pracowało w okresie" value={String(data.totals.employees ?? data.people.length)} />
              <TimeTile icon="dollar-sign" title="Wpisy bez umowy — wartość orientacyjna" value={workMoney(data.totals.revenue)} />
            </View>

            <View style={styles.sectionHeader}><BrandHeading style={styles.sectionTitle}>Pracownicy</BrandHeading></View>
            {data.people.length === 0 ? (
              <View style={styles.card}><Text style={styles.muted}>Brak zakończonych wpisów w wybranym okresie.</Text></View>
            ) : data.people.map((person) => (
              <TouchableOpacity key={person.id} style={styles.personCard} activeOpacity={0.75} onPress={() => openEmployee(person.id, person.name)}
                accessibilityRole="button" accessibilityLabel={`Czas pracy: ${person.name}`}>
                <View style={styles.personRow}>
                  <View>
                    <EmployeeAvatar avatarUrl={person.avatarUrl} avatarMetadata={avatarMetadata(person.avatar)} employeeName={person.name} size={40} />
                    {activeIds.has(person.id) ? <View style={styles.dot} /> : null}
                  </View>
                  <View style={styles.flex}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.name, styles.flex]} numberOfLines={1}>{person.name}</Text>
                      <Text style={styles.minutes}>{formatWorkMinutes(person.minutes)}</Text>
                    </View>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.meta, styles.flex]} numberOfLines={1}>
                        {plural(person.entries, 'wpis', 'wpisy', 'wpisów')} • {plural(person.days, 'dzień', 'dni', 'dni')}
                      </Text>
                      <Text style={styles.metaSmall}>{formatWorkMinutes(person.billableMinutes)} rozliczalnych</Text>
                    </View>
                    {person.active || person.revenue > 0 ? (
                      <View style={styles.rowBetween}>
                        <Text style={[styles.workingSmall, styles.flex]} numberOfLines={1}>{person.active ? `Teraz: ${workLabel(person.active)}` : ''}</Text>
                        {person.revenue > 0 ? <Text style={styles.money}>{workMoney(person.revenue)}</Text> : null}
                      </View>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
                </View>
                <TimeBar fraction={total > 0 ? person.minutes / total : 0} />
              </TouchableOpacity>
            ))}

            {idle.length > 0 ? (
              <View style={styles.card}>
                <TouchableOpacity style={styles.rowBetween} onPress={() => setShowIdle((value) => !value)} accessibilityRole="button"
                  accessibilityState={{ expanded: showIdle }}>
                  <Text style={styles.idleTitle}>Bez wpisów w tym okresie · {idle.length}</Text>
                  <Feather name={showIdle ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.secondary} />
                </TouchableOpacity>
                {showIdle ? idle.map((option) => (
                  <TouchableOpacity key={option.id} style={styles.idleRow} onPress={() => openEmployee(option.id, option.name)} accessibilityRole="button">
                    <View>
                      <EmployeeAvatar avatarUrl={option.avatarUrl ?? null} avatarMetadata={avatarMetadata(option.avatar)} employeeName={option.name} size={32} />
                      {activeIds.has(option.id) ? <View style={[styles.dot, styles.dotSmall]} /> : null}
                    </View>
                    <Text style={[styles.idleName, styles.flex]} numberOfLines={1}>{option.name}</Text>
                    {activeIds.has(option.id) ? <TimePill text="Aktywny" color={workTimeGreen} /> : null}
                    <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
                  </TouchableOpacity>
                )) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        <TimeEntryDiscussions entries={[]} discussionEntryId={discussionEntryId} discussionRequestId={discussionRequestId} />

        {data && period.kind !== 'day' ? (
          <View style={stale ? styles.dimmed : undefined}>
            <View style={styles.sectionHeader}>
              <BrandHeading style={styles.sectionTitle}>{period.kind === 'year' ? 'Aktywność miesięczna' : 'Aktywność dzienna'}</BrandHeading>
            </View>
            <View style={styles.card}>
              {data.daily.length === 0 ? <Text style={styles.muted}>Brak danych dla wybranego okresu.</Text> : null}
              {period.kind === 'year'
                ? monthly(data.daily).map((month) => (
                  <View key={month.key} style={styles.dayRow}>
                    <Text style={styles.dayLabel}>{dayDate(`${month.key}-15`).toLocaleDateString('pl-PL', { month: 'long' })}</Text>
                    <Text style={styles.dayMinutes}>{formatWorkMinutes(month.minutes)}</Text>
                    <Text style={styles.metaSmall}>{plural(month.entries, 'wpis', 'wpisy', 'wpisów')}</Text>
                  </View>
                ))
                : data.daily.map((day) => (
                  <View key={day.date} style={styles.dayRow}>
                    <Text style={styles.dayLabel}>{dayDate(day.date).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })}</Text>
                    <Text style={styles.dayMinutes}>{formatWorkMinutes(day.minutes)}</Text>
                    <Text style={styles.metaSmall}>{plural(day.entries, 'wpis', 'wpisy', 'wpisów')} · {plural(day.employees, 'osoba', 'osoby', 'osób')}</Text>
                  </View>
                ))}
            </View>
          </View>
        ) : null}
        <View style={{ height: 40 }} />
      </ScrollView>
      {notice.overlay}
    </View>
  );
}

export const timeStyles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md, marginBottom: spacing.md, padding: spacing.md, backgroundColor: colors.background.secondary,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border.default,
  },
  sectionHeader: { marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: typography.fontFamilies.heading, fontSize: 13, color: colors.text.secondary },
  muted: { fontSize: 13, color: colors.text.tertiary },
  error: { fontSize: 13, color: colors.status.error },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background.primary },
  content: { paddingBottom: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  loader: { marginVertical: spacing.lg },
  card: timeStyles.card,
  sectionHeader: timeStyles.sectionHeader,
  sectionTitle: timeStyles.sectionTitle,
  muted: timeStyles.muted,
  error: timeStyles.error,
  inlineError: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  retry: { marginTop: spacing.sm, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, backgroundColor: withAlpha(colors.primary.gold, 0.15) },
  retryText: { color: colors.primary.gold, fontSize: 13, fontWeight: '600' },
  dimmed: { opacity: 0.5 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  activeCard: {
    flexDirection: 'row', gap: 12, marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: 14, borderRadius: 12,
    backgroundColor: withAlpha(workTimeGreen, 0.08), borderWidth: 1, borderColor: withAlpha(workTimeGreen, 0.35),
  },
  dot: {
    position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 6, backgroundColor: workTimeGreen,
    borderWidth: 2, borderColor: colors.background.secondary,
  },
  dotSmall: { width: 10, height: 10, borderRadius: 5 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text.primary },
  clock: { fontSize: 18, fontWeight: '300', color: workTimeGreen, fontVariant: ['tabular-nums'] },
  working: { flex: 1, fontSize: 14, color: workTimeGreen, marginTop: 2 },
  workingSmall: { fontSize: 12, color: workTimeGreen, marginTop: 2 },
  since: { fontSize: 12, color: colors.text.tertiary, fontVariant: ['tabular-nums'] },
  event: { fontSize: 12, color: colors.primary.gold, marginTop: 4 },
  description: { fontSize: 12, color: colors.text.secondary, marginTop: 4 },
  ownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.status.error },
  stopText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  kinds: { flexDirection: 'row', gap: 6 },
  kind: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, backgroundColor: colors.layer.well },
  kindSelected: { backgroundColor: withAlpha(colors.primary.gold, 0.2) },
  kindText: { fontSize: 13, color: colors.text.secondary },
  kindTextSelected: { color: colors.primary.gold, fontWeight: '600' },
  periodRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  arrow: { padding: 8 },
  periodLabelBox: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  periodLabel: { fontSize: 15, fontWeight: '600', color: colors.text.primary, textAlign: 'center', flexShrink: 1 },
  current: { alignSelf: 'center', marginTop: 4, paddingVertical: 4, paddingHorizontal: 10 },
  currentText: { fontSize: 12, color: colors.primary.gold },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.md },
  tile: {
    flexGrow: 1, flexBasis: '45%', minWidth: 140, padding: 12, gap: 4, borderRadius: 12, backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.default,
  },
  tileValue: { fontSize: 18, fontWeight: '700', color: colors.text.primary, fontVariant: ['tabular-nums'] },
  tileTitle: { fontSize: 11, color: colors.text.tertiary },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.layer.well, overflow: 'hidden', marginTop: 10 },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary.gold },
  pill: { fontSize: 11, fontWeight: '600', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  personCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.sm, padding: 12, borderRadius: 12, backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.default,
  },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  meta: { fontSize: 12, color: colors.text.tertiary, marginTop: 2 },
  metaSmall: { fontSize: 11, color: colors.text.tertiary },
  minutes: { fontSize: 16, fontWeight: '700', color: colors.text.primary, fontVariant: ['tabular-nums'] },
  money: { fontSize: 11, color: colors.primary.gold },
  idleTitle: { fontSize: 14, color: colors.text.secondary, fontWeight: '600' },
  idleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border.default, marginTop: 8 },
  idleName: { fontSize: 14, color: colors.text.primary },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  dayLabel: { width: 110, fontSize: 13, color: colors.text.primary },
  dayMinutes: { width: 70, fontSize: 13, fontWeight: '600', color: colors.primary.gold, fontVariant: ['tabular-nums'] },
});
