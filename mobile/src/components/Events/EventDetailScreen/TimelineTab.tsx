import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { supabase } from '../../../lib/supabase';
import { createRefreshQueue } from '../../../lib/refreshQueue';
import { useForegroundEffect } from '../../../hooks/useForegroundEffect';
import { useContentWidth } from '../../../hooks/useTabletLayout';
import { openInCrmWeb } from '../../../navigation/navigationRef';
import { colors, spacing } from '../../../theme';

/*
 * „Timeline” eventu (CRM: zakładka Harmonogram) — fazy z godzinami, kto w nich pracuje (godziny pracy osoby) i które auta
 * z kierowcami są w fazie. Tylko odczyt: dane z tych samych tabel co CRM i Mac (`event_phases`, `event_phase_assignments`,
 * `event_phase_vehicles`), widoczność wynika z RLS. Edycja harmonogramu — w CRM. Na tablecie fazy w dwóch kolumnach.
 */

type Phase = {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
  start: string | null;
  end: string | null;
  color: string | null;
  typeName: string | null;
};

type PhasePerson = {
  id: string;
  phaseId: string;
  employeeId: string;
  name: string;
  role: string | null;
  workStart: string | null;
  workEnd: string | null;
  status: string;
};

type PhaseVehicle = {
  id: string;
  phaseId: string;
  name: string;
  driverId: string | null;
  driver: string | null;
  start: string | null;
  end: string | null;
  purpose: string | null;
};

type TimelineData = { phases: Phase[]; people: PhasePerson[]; vehicles: PhaseVehicle[] };

const STATUS_LABELS: Record<string, string> = { pending: 'Oczekuje', accepted: 'Potwierdzone', rejected: 'Odrzucone' };

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const fullName = (row: any) => [row?.name, row?.surname].filter(Boolean).join(' ').trim();

const dayFormatter = (value: Date) =>
  value.toLocaleDateString('pl-PL', { weekday: 'short', day: '2-digit', month: '2-digit' });
const timeFormatter = (value: Date) => value.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false });

/** „pt. 14.11, 08:00 – 12:30”, „pt. 14.11, 22:00 – sob. 15.11, 02:00”. */
export function phaseRange(start: string | null, end: string | null): string {
  const from = start ? new Date(start) : null;
  const to = end ? new Date(end) : null;
  if (!from || Number.isNaN(from.getTime())) return 'Bez godzin';
  const head = `${dayFormatter(from)}, ${timeFormatter(from)}`;
  if (!to || Number.isNaN(to.getTime())) return head;
  const sameDay = from.toDateString() === to.toDateString();
  return `${head} – ${sameDay ? timeFormatter(to) : `${dayFormatter(to)}, ${timeFormatter(to)}`}`;
}

function durationLabel(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} h${rest ? ` ${rest} min` : ''}` : `${rest} min`;
}

async function fetchTimeline(eventId: string): Promise<TimelineData> {
  const phases = await supabase
    .from('event_phases')
    .select('id, name, description, notes, start_time, end_time, sequence_order, color, phase_type:event_phase_types(name, color)')
    .eq('event_id', eventId)
    .order('start_time', { ascending: true });
  if (phases.error) throw phases.error;
  const rows = (phases.data ?? []) as any[];
  const ids = rows.map((row) => row.id);
  const [people, vehicles] = ids.length
    ? await Promise.all([
        supabase
          .from('event_phase_assignments')
          .select(
            'id, phase_id, employee_id, role, phase_work_start, phase_work_end, assignment_start, assignment_end, invitation_status, employee:employees!event_phase_assignments_employee_id_fkey(id, name, surname, nickname)',
          )
          .in('phase_id', ids),
        supabase
          .from('event_phase_vehicles')
          .select(
            'id, phase_id, driver_id, assigned_start, assigned_end, purpose, vehicle:vehicles!event_phase_vehicles_vehicle_id_fkey(name, registration_number, brand, model), driver:employees!event_phase_vehicles_driver_id_fkey(id, name, surname)',
          )
          .in('phase_id', ids),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  return {
    phases: rows.map((row) => {
      const type = one<any>(row.phase_type);
      return {
        id: String(row.id),
        name: row.name || type?.name || 'Faza',
        description: row.description ?? null,
        notes: row.notes ?? null,
        start: row.start_time ?? null,
        end: row.end_time ?? null,
        color: row.color || type?.color || null,
        typeName: type?.name && type.name !== row.name ? type.name : null,
      };
    }),
    // Brak dostępu do obsady lub aut faz (RLS) — fazy pokazujemy bez tych sekcji.
    people: people.error
      ? []
      : ((people.data ?? []) as any[]).map((row) => {
          const employee = one<any>(row.employee);
          return {
            id: String(row.id),
            phaseId: String(row.phase_id),
            employeeId: String(row.employee_id || ''),
            name: employee?.nickname || fullName(employee) || 'Pracownik',
            role: row.role ?? null,
            workStart: row.phase_work_start ?? row.assignment_start ?? null,
            workEnd: row.phase_work_end ?? row.assignment_end ?? null,
            status: row.invitation_status || 'pending',
          };
        }),
    vehicles: vehicles.error
      ? []
      : ((vehicles.data ?? []) as any[]).map((row) => {
          const vehicle = one<any>(row.vehicle);
          const driver = one<any>(row.driver);
          const label = vehicle?.name || [vehicle?.brand, vehicle?.model].filter(Boolean).join(' ') || 'Pojazd';
          return {
            id: String(row.id),
            phaseId: String(row.phase_id),
            name: vehicle?.registration_number ? `${label} · ${vehicle.registration_number}` : label,
            driverId: row.driver_id ? String(row.driver_id) : null,
            driver: driver ? fullName(driver) || null : null,
            start: row.assigned_start ?? null,
            end: row.assigned_end ?? null,
            purpose: row.purpose ?? null,
          };
        }),
  };
}

export function TimelineTab({
  eventId,
  currentEmployeeId,
  canEdit,
  refreshKey,
}: {
  eventId: string;
  currentEmployeeId: string | null;
  /** Osoba może edytować harmonogram (link do CRM). */
  canEdit?: boolean;
  /** Zmiana wartości wymusza odświeżenie (pociągnięcie ekranu). */
  refreshKey?: number;
}) {
  const [state, setState] = useState<{ eventId: string; data: TimelineData } | null>(null);
  const [error, setError] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const width = useContentWidth();
  const twoColumns = width >= 720;
  const readVersion = useRef(0);
  const phaseIds = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const version = ++readVersion.current;
    try {
      const data = await fetchTimeline(eventId);
      if (version !== readVersion.current) return;
      phaseIds.current = new Set(data.phases.map((phase) => phase.id));
      setState({ eventId, data });
      setError('');
    } catch {
      if (version === readVersion.current) setError('Nie udało się pobrać harmonogramu. Spróbuj ponownie.');
    }
  }, [eventId]);

  useEffect(() => {
    setMineOnly(false);
  }, [eventId]);

  useForegroundEffect(
    (signal) => {
      const queue = createRefreshQueue(signal, () => load());
      void queue.refresh();
      const inPhases = (payload: { new?: any; old?: any }) => {
        const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { phase_id?: string } | undefined;
        if (!row?.phase_id || phaseIds.current.has(row.phase_id)) queue.schedule();
      };
      const channel = supabase
        .channel(`mobile-event-timeline-${eventId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_phases', filter: `event_id=eq.${eventId}` }, queue.schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_phase_assignments' }, inPhases)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'event_phase_vehicles' }, inPhases)
        .subscribe();
      return () => {
        readVersion.current++;
        return supabase.removeChannel(channel);
      };
    },
    [eventId, load],
  );

  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    void load();
  }, [refreshKey, load]);

  const data = state?.eventId === eventId ? state.data : null;

  if (!data) {
    return (
      <View style={styles.centered}>
        {error ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => void load()}>
              <Text style={styles.link}>Odśwież</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ActivityIndicator color={colors.primary.gold} />
        )}
      </View>
    );
  }

  const myPhaseIds = new Set(
    [
      ...data.people.filter((person) => person.employeeId === currentEmployeeId),
      ...data.vehicles.filter((vehicle) => vehicle.driverId === currentEmployeeId),
    ].map((row) => row.phaseId),
  );
  const phases = mineOnly ? data.phases.filter((phase) => myPhaseIds.has(phase.id)) : data.phases;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Timeline</Text>
          <Text style={styles.description}>Fazy eventu, kto w nich pracuje i którymi autami.</Text>
        </View>
        {canEdit && (
          <TouchableOpacity
            accessibilityRole="link"
            style={styles.crmButton}
            onPress={() => openInCrmWeb(`/crm/events/${eventId}?tab=phases`)}
          >
            <Feather name="external-link" size={14} color={colors.primary.gold} />
            <Text style={styles.crmText}>Edytuj w CRM</Text>
          </TouchableOpacity>
        )}
      </View>

      {myPhaseIds.size > 0 && (
        <View style={styles.filters}>
          {[
            { key: false, label: `Wszystkie (${data.phases.length})` },
            { key: true, label: `Moje fazy (${myPhaseIds.size})` },
          ].map((option) => (
            <TouchableOpacity
              key={String(option.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: mineOnly === option.key }}
              onPress={() => setMineOnly(option.key)}
              style={[styles.chip, mineOnly === option.key && styles.chipActive]}
            >
              <Text style={[styles.chipText, mineOnly === option.key && styles.chipTextActive]}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}

      {phases.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="clock" size={36} color={colors.text.tertiary} />
          <Text style={styles.emptyText}>Nie dodano jeszcze faz w harmonogramie.</Text>
        </View>
      ) : (
        <View style={[styles.grid, twoColumns && styles.gridTwo]}>
          {phases.map((phase) => {
            const people = data.people.filter((person) => person.phaseId === phase.id);
            const vehicles = data.vehicles.filter((vehicle) => vehicle.phaseId === phase.id);
            const duration = durationLabel(phase.start, phase.end);
            const mine = myPhaseIds.has(phase.id);
            return (
              <View
                key={phase.id}
                style={[styles.card, twoColumns && styles.cardHalf, mine && styles.cardMine, { borderLeftColor: phase.color || colors.primary.gold }]}
              >
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.phaseName}>{phase.name}</Text>
                    {!!phase.typeName && <Text style={styles.meta}>{phase.typeName}</Text>}
                  </View>
                  {mine && (
                    <View style={styles.mineBadge}>
                      <Text style={styles.mineText}>Twoja faza</Text>
                    </View>
                  )}
                </View>
                <View style={styles.timeRow}>
                  <Feather name="clock" size={13} color={colors.primary.gold} />
                  <Text style={styles.timeText}>{phaseRange(phase.start, phase.end)}</Text>
                  {!!duration && <Text style={styles.meta}>{duration}</Text>}
                </View>
                {!!phase.description && <Text style={styles.body}>{phase.description}</Text>}
                {!!phase.notes && <Text style={styles.notes}>{phase.notes}</Text>}

                {people.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Zespół ({people.length})</Text>
                    {people.map((person) => {
                      const isMe = person.employeeId === currentEmployeeId;
                      const ownHours =
                        person.workStart && (person.workStart !== phase.start || person.workEnd !== phase.end)
                          ? phaseRange(person.workStart, person.workEnd)
                          : null;
                      return (
                        <View key={person.id} style={styles.line}>
                          <Feather name="user" size={12} color={isMe ? colors.primary.gold : colors.text.tertiary} />
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.lineText, isMe && styles.lineMine]}>
                              {person.name}
                              {isMe ? ' (Ty)' : ''}
                              {person.role ? <Text style={styles.meta}>{` · ${person.role}`}</Text> : null}
                            </Text>
                            {!!ownHours && <Text style={styles.meta}>Praca: {ownHours}</Text>}
                          </View>
                          {person.status !== 'accepted' && (
                            <Text style={[styles.status, person.status === 'rejected' && { color: colors.status.error }]}>
                              {STATUS_LABELS[person.status] || person.status}
                            </Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                {vehicles.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>Auta ({vehicles.length})</Text>
                    {vehicles.map((vehicle) => {
                      const isMe = vehicle.driverId === currentEmployeeId;
                      return (
                        <View key={vehicle.id} style={styles.line}>
                          <Feather name="truck" size={12} color={isMe ? colors.primary.gold : colors.text.tertiary} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.lineText}>{vehicle.name}</Text>
                            <Text style={[styles.meta, isMe && styles.lineMine]}>
                              Kierowca: {vehicle.driver || 'nieprzypisany'}
                              {isMe ? ' (Ty)' : ''}
                              {vehicle.purpose ? ` · ${vehicle.purpose}` : ''}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: 12 },
  centered: { padding: 40, alignItems: 'center', gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  heading: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 16, fontWeight: '400', color: colors.text.primary },
  description: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.text.tertiary },
  crmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border.hover,
  },
  crmText: { fontSize: 12, fontWeight: '600', color: colors.primary.gold },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: colors.primary.gold + '1f' },
  chipText: { fontSize: 12, color: colors.text.secondary },
  chipTextActive: { color: colors.primary.gold, fontWeight: '600' },
  error: { color: colors.status.error, fontSize: 13 },
  link: { color: colors.primary.gold, paddingVertical: 8 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 50 },
  emptyText: { fontSize: 13, color: colors.text.tertiary, textAlign: 'center' },
  grid: { gap: 10 },
  gridTwo: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  cardHalf: { width: '49%' },
  cardMine: { borderColor: colors.primary.gold + '66' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  phaseName: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 14, fontWeight: '400', color: colors.text.primary },
  meta: { fontSize: 11, color: colors.text.tertiary },
  mineBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.primary.gold + '22' },
  mineText: { fontSize: 10, fontWeight: '700', color: colors.primary.gold },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  timeText: { fontSize: 13, color: colors.text.primary },
  body: { fontSize: 12, lineHeight: 17, color: colors.text.secondary },
  notes: { fontSize: 12, lineHeight: 17, color: colors.text.tertiary, fontStyle: 'italic' },
  section: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border.default, paddingTop: 8 },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: colors.text.secondary },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  lineText: { fontSize: 13, color: colors.text.primary },
  lineMine: { color: colors.primary.gold, fontWeight: '600' },
  status: { fontSize: 10, fontWeight: '700', color: colors.status.warning },
});
