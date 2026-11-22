import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Linking, Modal, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, withAlpha } from '../theme';
import EmployeeAvatar from '../components/EmployeeAvatar';
import BrandHeading from '../components/BrandHeading';
import PermissionGate from '../components/PermissionGate';
import TimeEntryDiscussions from '../components/TimeEntryDiscussions';
import { TimeBar, TimePeriodBar, TimePill, TimeTile, timeStyles, workTimeGreen } from '../components/TimeTeamDashboard';
import { navigateToEvent, navigateToTask } from '../navigation/navigationRef';
import {
  TIME_CHANGE_ACTIONS, avatarMetadata, changeActor, dayDate, formatWorkMinutes, plural, timeGet, timePeriodRange, workClock,
  workDateTime, workDay, workLabel, workMoney, workRate, workSpan, type TimeChange, type TimeEmployeePage, type TimeEntryItem,
  type TimePeriod, type TimePeriodKind,
} from '../lib/timeTrackingApi';

/*
 * Czas pracy pracownika (administrator; jak strona pracownika na Macu i `/crm/time-tracking/[employeeId]`): aktualnie naliczany
 * czas z licznikiem na żywo, okres, kafelki, czas według zadań, wszystkie wpisy dniami (opis, event, stawka, rozmowa
 * „do wyjaśnienia”, historia zmian wpisu) oraz historia zmian i usunięć z okresu. Dane: `/bridge/native/v1/time`
 * (`op=employee`, `op=history`). Bez edycji wpisów — jak w CRM.
 */

const ORANGE = '#fb923c';

type Params = { employeeId: string; name?: string; kind?: TimePeriodKind; offset?: number };
/** Wątek rozmowy (`list_time_entry_discussions`). */
type Thread = { time_entry_id: string; resolved: boolean; messages: unknown[] };

/** Zmiana wpisu: akcja, autor, data i pola „przed → po” (jak `WorkTimeChangeRow` na Macu). */
function ChangeRow({ change, showTitle }: { change: TimeChange; showTitle: boolean }) {
  const action = TIME_CHANGE_ACTIONS[change.action] ?? { label: change.action, color: colors.text.secondary };
  return (
    <View style={styles.change}>
      <View style={styles.rowBetween}>
        <TimePill text={action.label} color={action.color} />
        <Text style={styles.metaSmall}>{workDateTime(change.at)}</Text>
      </View>
      <View style={styles.actorRow}>
        <Feather name="user" size={12} color={colors.text.tertiary} />
        <Text style={styles.actor}>{changeActor(change)}</Text>
      </View>
      {showTitle && !!change.title && <Text style={styles.meta}>Wpis: {change.title}</Text>}
      {change.action === 'deleted' ? (
        <View style={styles.actorRow}>
          <Feather name="alert-triangle" size={12} color="#f87171" />
          <Text style={[styles.metaSmall, { color: '#f87171' }]}>Wpis nieodwracalnie usunięty</Text>
        </View>
      ) : null}
      {change.action === 'created' ? <Text style={styles.meta}>Wpis został utworzony</Text> : null}
      {change.action === 'updated' ? change.changes.map((field) => (
        <View key={field.field} style={styles.field}>
          <Text style={styles.fieldLabel}>{field.label}:</Text>
          <Text selectable style={[styles.value, styles.before]}>{field.before}</Text>
          <Feather name="arrow-down" size={12} color={colors.text.tertiary} style={styles.fieldArrow} />
          <Text selectable style={[styles.value, styles.after]}>{field.after}</Text>
        </View>
      )) : null}
    </View>
  );
}

/** „Historia zmian” wpisu (`op=history`). */
function HistoryModal({ entry, onClose }: { entry: TimeEntryItem | null; onClose: () => void }) {
  const [items, setItems] = useState<TimeChange[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    setItems(null);
    setProblem(null);
    timeGet<{ history: TimeChange[] }>('history', { entry: entry.id })
      .then((reply) => { if (!cancelled) setItems(reply.history); })
      .catch((cause) => { if (!cancelled) setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać historii zmian.'); });
    return () => { cancelled = true; };
  }, [entry]);
  return (
    <Modal visible={!!entry} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <View style={styles.flex}>
            <Text style={styles.modalTitle}>Historia zmian</Text>
            {entry ? <Text style={styles.meta} numberOfLines={2}>{workLabel(entry)}</Text> : null}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.close} accessibilityLabel="Zamknij historię zmian">
            <Text style={styles.closeText}>Zamknij</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.modalContent}>
          {problem ? <Text style={timeStyles.error}>{problem}</Text> : null}
          {!items && !problem ? <ActivityIndicator color={colors.primary.gold} style={styles.loader} /> : null}
          {items && items.length === 0 ? <Text style={timeStyles.muted}>Brak zapisanych zmian tego wpisu.</Text> : null}
          {items?.map((change) => <ChangeRow key={change.id} change={change} showTitle={false} />)}
        </ScrollView>
      </View>
    </Modal>
  );
}

function TimeEmployeeContent() {
  const route = useRoute<any>();
  const params = (route.params ?? {}) as Params;
  const employeeId = params.employeeId;
  const [period, setPeriod] = useState<TimePeriod>({ kind: params.kind ?? 'day', offset: params.offset ?? 0 });
  const [page, setPage] = useState<TimeEmployeePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [threads, setThreads] = useState<Thread[]>([]);
  const [discussion, setDiscussion] = useState<{ entryId: string; requestId: number } | null>(null);
  const [historyFor, setHistoryFor] = useState<TimeEntryItem | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [deletedOnly, setDeletedOnly] = useState(false);
  const request = useRef(0);
  const range = useMemo(() => timePeriodRange(period), [period]);

  const load = useCallback(async (refresh = false) => {
    if (!employeeId) return;
    const id = ++request.current;
    if (refresh) setRefreshing(true);
    try {
      const next = await timeGet<TimeEmployeePage>('employee', { id: employeeId, from: range.from, to: range.to });
      if (id !== request.current) return;
      setPage(next);
      setError(null);
    } catch (cause) {
      if (id !== request.current) return;
      setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać czasu pracy.');
    } finally {
      if (id === request.current) setRefreshing(false);
    }
  }, [employeeId, range.from, range.to]);

  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 30_000);
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [load]));

  const active = page?.active ?? null;
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const stale = !page || page.range.from !== range.from || page.range.to !== range.to;
  const entries = page?.entries ?? [];
  // Wpisy dniami (od najnowszych, jak na serwerze).
  const days = useMemo(() => {
    const groups: { day: string; entries: TimeEntryItem[] }[] = [];
    for (const entry of entries) {
      const day = workDay(entry);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.entries.push(entry); else groups.push({ day, entries: [entry] });
    }
    return groups;
  }, [entries]);
  const discussionEntries = useMemo(() => entries.map((entry) => ({
    id: entry.id, title: workLabel(entry), description: entry.description || null, start_time: entry.start, duration_minutes: entry.minutes,
  })), [entries]);
  const history = (page?.history ?? []).filter((change) => !deletedOnly || change.action === 'deleted');
  const threadOf = (entryId: string) => threads.find((thread) => thread.time_entry_id === entryId);
  const discuss = (entry: TimeEntryItem) => setDiscussion({ entryId: entry.id, requestId: Date.now() });

  if (!page && !error) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.gold} /></View>;
  }
  if (!page) {
    return (
      <View style={styles.centered}>
        <Text style={[timeStyles.error, styles.centerText]}>{error}</Text>
        <TouchableOpacity style={styles.retry} onPress={() => void load(true)}><Text style={styles.retryText}>Spróbuj ponownie</Text></TouchableOpacity>
      </View>
    );
  }

  const person = page.employee;
  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary.gold} />}
      >
        <View style={[timeStyles.card, styles.header]}>
          <EmployeeAvatar avatarUrl={person.avatarUrl} avatarMetadata={avatarMetadata(person.avatar)} employeeName={person.name} size={64} />
          <View style={styles.flex}>
            <Text style={styles.headerName}>{person.name}</Text>
            {active ? <View style={styles.pillRow}><TimePill text="Aktywny licznik" color={workTimeGreen} /></View> : null}
            {!!person.email && (
              <TouchableOpacity style={styles.contact} onPress={() => void Linking.openURL(`mailto:${person.email}`)} accessibilityRole="link">
                <Feather name="mail" size={13} color={colors.text.tertiary} />
                <Text style={styles.contactText} numberOfLines={1}>{person.email}</Text>
              </TouchableOpacity>
            )}
            {!!person.phone && (
              <TouchableOpacity style={styles.contact} onPress={() => void Linking.openURL(`tel:${person.phone.replace(/\s+/g, '')}`)} accessibilityRole="link">
                <Feather name="phone" size={13} color={colors.text.tertiary} />
                <Text style={styles.contactText}>{person.phone}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {active ? (
          <View style={styles.activeCard}>
            <View style={styles.actorRow}>
              <Feather name="clock" size={14} color={workTimeGreen} />
              <Text style={styles.activeTitle}>Aktualnie naliczany czas pracy</Text>
            </View>
            <Text style={styles.activeClock}>{workClock(active.start, now)}</Text>
            <Text style={styles.activeLabel}>{workLabel(active)}</Text>
            {!!active.eventName && <Text style={styles.event}>Event: {active.eventName}</Text>}
            {!!active.description && <Text style={styles.description}>{active.description}</Text>}
            <Text style={styles.meta}>Rozpoczęto: {workDateTime(active.start)}</Text>
            <View style={styles.pillRow}>
              {active.billable ? <TimePill text="Płatne" color={workTimeGreen} /> : null}
              {workRate(active) ? <Text style={styles.metaSmall}>Stawka: {workRate(active)}</Text> : null}
            </View>
            {active.taskId ? (
              <TouchableOpacity style={styles.link} onPress={() => navigateToTask(active.taskId!)}>
                <Feather name="external-link" size={13} color={colors.primary.gold} />
                <Text style={styles.linkText}>Otwórz zadanie</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        <TimePeriodBar period={period} onChange={setPeriod} busy={stale} />
        {error ? <Text style={[timeStyles.error, styles.inlineError]}>{error}</Text> : null}

        <View style={stale ? styles.dimmed : undefined}>
          <View style={styles.tiles}>
            <TimeTile icon="clock" title="Łączny czas" value={formatWorkMinutes(page.totals.minutes)} />
            <TimeTile icon="dollar-sign" title="Rozliczalny" value={formatWorkMinutes(page.totals.billableMinutes)} />
            <TimeTile icon="calendar" title="Wpisów" value={String(page.totals.entries ?? entries.length)} />
            <TimeTile icon="trending-up" title="Wpisy bez umowy — wartość orientacyjna" value={workMoney(page.totals.revenue)} />
          </View>

          <View style={timeStyles.sectionHeader}><BrandHeading style={timeStyles.sectionTitle}>Czas według zadań</BrandHeading></View>
          <View style={timeStyles.card}>
            {page.tasks.length === 0 ? <Text style={timeStyles.muted}>Brak danych dla wybranego okresu.</Text> : null}
            {page.tasks.map((stat, index) => (
              <View key={stat.taskId ?? 'no-task'} style={[styles.task, index > 0 && styles.separator]}>
                <View style={styles.rowBetween}>
                  <View style={styles.flex}>
                    <Text style={styles.taskTitle}>{stat.title}</Text>
                    {!!stat.eventName && <Text style={styles.metaSmall}>Event: {stat.eventName}</Text>}
                    <Text style={styles.metaSmall}>
                      {plural(stat.entries, 'wpis', 'wpisy', 'wpisów')} • Ostatnio: {new Date(stat.last).toLocaleDateString('pl-PL')}
                    </Text>
                  </View>
                  <Text style={styles.taskMinutes}>{formatWorkMinutes(stat.minutes)}</Text>
                </View>
                <TimeBar fraction={page.totals.minutes > 0 ? stat.minutes / page.totals.minutes : 0} />
              </View>
            ))}
          </View>

          <View style={timeStyles.sectionHeader}><BrandHeading style={timeStyles.sectionTitle}>Wpisy czasu</BrandHeading></View>
          {days.length === 0 ? <View style={timeStyles.card}><Text style={timeStyles.muted}>Brak wpisów czasu w wybranym okresie.</Text></View> : null}
          {days.map((group) => (
            <View key={group.day} style={styles.dayBlock}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayTitle}>{dayDate(group.day).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
                <Text style={styles.metaSmall}>
                  {formatWorkMinutes(group.entries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0))} · {plural(group.entries.length, 'wpis', 'wpisy', 'wpisów')}
                </Text>
              </View>
              {group.entries.map((entry) => {
                const thread = threadOf(entry.id);
                const rate = workRate(entry);
                return (
                  <View key={entry.id} style={styles.entry}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.entryTitle}>{workLabel(entry)}</Text>
                      <Text style={styles.entryMinutes}>{entry.end ? formatWorkMinutes(entry.minutes) : workClock(entry.start, now)}</Text>
                    </View>
                    <View style={styles.pillRow}>
                      <Text style={styles.metaSmall}>{workSpan(entry)}</Text>
                      {entry.billable ? <TimePill text="Płatne" color={workTimeGreen} /> : null}
                      {!entry.end ? <TimePill text="W trakcie" color={workTimeGreen} /> : null}
                    </View>
                    {!!entry.title && !!entry.taskTitle && entry.title !== entry.taskTitle ? <Text style={styles.meta}>{entry.title}</Text> : null}
                    {!!entry.description && <Text selectable style={styles.description}>{entry.description}</Text>}
                    {!!entry.eventName && (
                      entry.eventId ? (
                        <TouchableOpacity onPress={() => navigateToEvent(entry.eventId!)}><Text style={styles.event}>Event: {entry.eventName}</Text></TouchableOpacity>
                      ) : <Text style={styles.event}>Event: {entry.eventName}</Text>
                    )}
                    {rate ? <Text style={styles.metaSmall}>Stawka: {rate}</Text> : null}
                    <View style={styles.actions}>
                      {entry.taskId ? (
                        <TouchableOpacity style={styles.action} onPress={() => navigateToTask(entry.taskId!)}>
                          <Feather name="external-link" size={13} color={colors.primary.gold} />
                          <Text style={styles.actionText}>Zadanie</Text>
                        </TouchableOpacity>
                      ) : null}
                      {entry.edits > 0 ? (
                        <TouchableOpacity style={styles.action} onPress={() => setHistoryFor(entry)} accessibilityLabel={`Historia zmian: ${entry.edits}`}>
                          <Feather name="rotate-ccw" size={13} color={colors.primary.gold} />
                          <Text style={styles.actionText}>Zmiany · {entry.edits}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity style={[styles.action, thread && { backgroundColor: withAlpha(thread.resolved ? workTimeGreen : ORANGE, 0.15) }]}
                        onPress={() => discuss(entry)}>
                        <Feather name="message-circle" size={13} color={thread ? (thread.resolved ? workTimeGreen : ORANGE) : colors.primary.gold} />
                        <Text style={[styles.actionText, thread && { color: thread.resolved ? workTimeGreen : ORANGE }]}>
                          {thread ? `${thread.resolved ? 'Wyjaśnione' : 'Do wyjaśnienia'} · ${thread.messages.length}` : 'Zapytaj'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}

          {page.history.length > 0 ? (
            <View style={timeStyles.card}>
              <TouchableOpacity style={styles.rowBetween} onPress={() => setShowHistory((value) => !value)} accessibilityRole="button"
                accessibilityState={{ expanded: showHistory }}>
                <BrandHeading style={timeStyles.sectionTitle}>{`Historia zmian i usunięć · ${page.history.length}`}</BrandHeading>
                <Feather name={showHistory ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.secondary} />
              </TouchableOpacity>
              {showHistory ? (
                <>
                  <TouchableOpacity style={styles.toggle} onPress={() => setDeletedOnly((value) => !value)} accessibilityRole="checkbox"
                    accessibilityState={{ checked: deletedOnly }}>
                    <Feather name={deletedOnly ? 'check-square' : 'square'} size={16} color={colors.primary.gold} />
                    <Text style={styles.toggleText}>Tylko usunięte</Text>
                  </TouchableOpacity>
                  {history.length === 0 ? <Text style={timeStyles.muted}>{deletedOnly ? 'Brak usuniętych wpisów.' : 'Brak historii zmian w wybranym okresie.'}</Text> : null}
                  {history.map((change) => <ChangeRow key={change.id} change={change} showTitle />)}
                </>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
      <TimeEntryDiscussions variant="modal" entries={discussionEntries} discussionEntryId={discussion?.entryId} discussionRequestId={discussion?.requestId}
        onThreadsChange={setThreads} />
      <HistoryModal entry={historyFor} onClose={() => setHistoryFor(null)} />
    </View>
  );
}

export default function TimeEmployeeScreen() {
  return (
    <PermissionGate module="time_tracking">
      <TimeEmployeeContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background.primary },
  content: { paddingTop: spacing.md, paddingBottom: spacing.md },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.background.primary },
  centerText: { textAlign: 'center' },
  flex: { flex: 1, minWidth: 0 },
  loader: { marginVertical: spacing.lg },
  retry: { marginTop: spacing.md, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: withAlpha(colors.primary.gold, 0.15) },
  retryText: { color: colors.primary.gold, fontWeight: '600' },
  inlineError: { marginHorizontal: spacing.md, marginBottom: spacing.sm },
  dimmed: { opacity: 0.5 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerName: { fontSize: 20, fontWeight: '300', color: colors.text.primary },
  pillRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  contact: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  contactText: { flexShrink: 1, fontSize: 13, color: colors.text.secondary },
  activeCard: {
    marginHorizontal: spacing.md, marginBottom: spacing.md, padding: 16, borderRadius: 12, backgroundColor: withAlpha(workTimeGreen, 0.08),
    borderWidth: 1, borderColor: withAlpha(workTimeGreen, 0.35),
  },
  activeTitle: { fontSize: 14, fontWeight: '600', color: workTimeGreen },
  activeClock: { fontSize: 34, fontWeight: '200', color: workTimeGreen, fontVariant: ['tabular-nums'], marginTop: 8 },
  activeLabel: { fontSize: 16, fontWeight: '600', color: colors.text.primary, marginTop: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  linkText: { fontSize: 13, color: colors.primary.gold },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.md },
  task: { paddingVertical: 10 },
  separator: { borderTopWidth: 1, borderTopColor: colors.border.default },
  taskTitle: { fontSize: 14, fontWeight: '600', color: colors.text.primary },
  taskMinutes: { fontSize: 14, fontWeight: '700', color: colors.primary.gold, fontVariant: ['tabular-nums'] },
  dayBlock: { marginHorizontal: spacing.md, marginBottom: spacing.md },
  dayHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm, marginBottom: 6 },
  dayTitle: { fontSize: 14, fontWeight: '600', color: colors.text.primary },
  entry: {
    padding: 12, marginBottom: 8, borderRadius: 10, backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.default,
  },
  entryTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text.primary },
  entryMinutes: { fontSize: 14, fontWeight: '700', color: colors.primary.gold, fontVariant: ['tabular-nums'] },
  event: { fontSize: 12, color: colors.primary.gold, marginTop: 4 },
  description: { fontSize: 13, color: colors.text.secondary, marginTop: 4, lineHeight: 18 },
  meta: { fontSize: 12, color: colors.text.tertiary, marginTop: 4 },
  metaSmall: { fontSize: 11, color: colors.text.tertiary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  action: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8,
    backgroundColor: withAlpha(colors.primary.gold, 0.12),
  },
  actionText: { fontSize: 12, color: colors.primary.gold, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  toggleText: { fontSize: 13, color: colors.text.primary },
  change: { padding: 12, marginTop: 8, borderRadius: 10, backgroundColor: colors.layer.well },
  actorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  actor: { fontSize: 13, color: colors.text.primary },
  field: { marginTop: 8 },
  fieldLabel: { fontSize: 11, fontWeight: '600', color: colors.text.secondary, marginBottom: 4 },
  fieldArrow: { alignSelf: 'center', marginVertical: 2 },
  value: { fontSize: 13, color: colors.text.primary, padding: 6, borderRadius: 6, overflow: 'hidden' },
  before: { backgroundColor: withAlpha('#f87171', 0.12) },
  after: { backgroundColor: withAlpha('#4ade80', 0.12) },
  modal: { flex: 1, backgroundColor: colors.background.primary },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: Platform.OS === 'ios' ? 54 : 24, paddingBottom: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border.default,
  },
  modalTitle: { fontSize: 18, color: colors.text.primary },
  close: { padding: 12 },
  closeText: { color: colors.primary.gold },
  modalContent: { padding: spacing.md, paddingBottom: 40 },
});
