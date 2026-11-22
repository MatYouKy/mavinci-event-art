import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { supabase } from '../../../lib/supabase';
import { colors, spacing } from '../../../theme';
import { useContentWidth } from '../../../hooks/useTabletLayout';
import {
  mapTeamTransportVehicles,
  summarizeTeamTransport,
  TEAM_TRANSPORT_VEHICLE_SELECT,
  type TeamTransportVehicle,
} from '../../../lib/teamTransport';
import type { EventTeamMember } from './TeamTab';

/*
 * „Logistyka” eventu w aplikacji: auta z kierowcami i godzinami, przejęcie i zdanie auta przez przypisanego kierowcę
 * (`record_assigned_vehicle_handover`), „Kto czym jedzie” (kierowcy z logistyki i `employee_assignments.transport_event_vehicle_id`,
 * wspólne `teamTransport.ts` z CRM i Makiem) oraz — dla osób prowadzących event (`current_employee_can_manage_event`) — zmiana
 * kierowcy auta z floty spośród osób z wymaganymi kategoriami prawa jazdy (`qualified_vehicle_drivers`). Zaproszenie nowego
 * kierowcy, automatyczną akceptację przy przypisaniu siebie i walidację prawa jazdy robi baza (wyzwalacze `event_vehicles`).
 */

export interface EventVehicleAssignment {
  id: string;
  event_id: string;
  vehicle_id: string | null;
  driver_id: string | null;
  role: string;
  status: string;
  is_external: boolean;
  external_company_name: string | null;
  departure_location: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  return_departure_time: string | null;
  return_arrival_time: string | null;
  notes: string | null;
  pickup_odometer: number | null;
  pickup_timestamp: string | null;
  return_odometer: number | null;
  return_timestamp: string | null;
  return_notes: string | null;
  is_in_use: boolean;
  has_trailer?: boolean | null;
  trailer_vehicle_id?: string | null;
  is_trailer_external?: boolean | null;
  vehicle: {
    id: string;
    name: string | null;
    brand: string | null;
    model: string | null;
    registration_number: string | null;
    current_mileage: number | null;
  } | null;
  driver: {
    id: string;
    name: string | null;
    surname: string | null;
  } | null;
}

interface FleetTabProps {
  /** Auta w zakresie osoby (wszystkie — prowadzący, magazyn, zakładka Logistyka; inaczej — tylko auta, które prowadzi). */
  assignments: EventVehicleAssignment[];
  currentEmployeeId: string | null;
  onChanged: () => Promise<void>;
  /** Event — „Kto czym jedzie” i zmiana kierowcy (bez niego tylko lista aut). */
  eventId?: string;
  /** Data eventu — uprawnienia kierowców sprawdzane na ten dzień. */
  eventDate?: string | null;
  /** Zespół eventu (imiona w „Kto czym jedzie”). */
  team?: EventTeamMember[];
  /** Osoba prowadzi event (`current_employee_can_manage_event`) — może zmienić kierowcę auta. */
  canAssignDrivers?: boolean;
  /** Zmiana wartości wymusza odświeżenie (pociągnięcie ekranu). */
  refreshKey?: number;
}

const ROLE_LABELS: Record<string, string> = {
  transport_equipment: 'Transport sprzętu',
  transport_crew: 'Transport ekipy',
  support: 'Wsparcie',
};

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planowane',
  in_transit: 'W drodze',
  arrived: 'Na miejscu',
  returning: 'Powrót',
  completed: 'Zakończone',
  cancelled: 'Anulowane',
};

const formatDateTime = (value: string | null) => {
  if (!value) return null;
  return new Date(value).toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const vehicleName = (assignment: EventVehicleAssignment) => {
  if (assignment.vehicle?.name) return assignment.vehicle.name;
  const makeAndModel = [assignment.vehicle?.brand, assignment.vehicle?.model]
    .filter(Boolean)
    .join(' ');
  return makeAndModel || assignment.external_company_name || 'Pojazd';
};

function DataRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <Feather name={icon as any} size={15} color={colors.primary.gold} />
      <View style={styles.dataText}>
        <Text style={styles.dataLabel}>{label}</Text>
        <Text style={styles.dataValue}>{value}</Text>
      </View>
    </View>
  );
}

function HandoverModal({
  assignment,
  visible,
  onClose,
  onSaved,
}: {
  assignment: EventVehicleAssignment;
  visible: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const handoverType = assignment.is_in_use ? 'return' : 'pickup';
  const lastMileage = useMemo(
    () =>
      Math.max(
        assignment.vehicle?.current_mileage ?? 0,
        assignment.pickup_odometer ?? 0,
        assignment.return_odometer ?? 0,
      ),
    [assignment],
  );
  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setOdometer(lastMileage > 0 ? String(lastMileage) : '');
    setNotes('');
  }, [lastMileage, visible, handoverType]);

  const handleSubmit = async () => {
    const normalizedMileage = Number(odometer.replace(',', '.'));
    if (!Number.isInteger(normalizedMileage) || normalizedMileage < 0) {
      Alert.alert('Nieprawidłowy licznik', 'Podaj pełny, nieujemny stan licznika w kilometrach.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('record_assigned_vehicle_handover', {
        p_event_vehicle_id: assignment.id,
        p_handover_type: handoverType,
        p_odometer_reading: normalizedMileage,
        p_notes: notes.trim() || null,
      });

      if (error) throw error;

      await onSaved();
      onClose();
      Alert.alert(
        handoverType === 'pickup' ? 'Auto przejęte' : 'Auto zdane',
        'Potwierdzenie zostało zapisane i jest od razu widoczne dla pozostałych użytkowników.',
      );
    } catch (error: any) {
      const message = String(error?.message || 'Nie udało się zapisać potwierdzenia.');
      Alert.alert('Nie udało się zapisać', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleWrap}>
              <Text style={styles.modalTitle}>
                {handoverType === 'pickup' ? 'Przejmij auto' : 'Zdaj auto'}
              </Text>
              <Text style={styles.modalSubtitle}>{vehicleName(assignment)}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} disabled={saving}>
              <Feather name="x" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {lastMileage > 0 && (
              <View style={styles.lastMileageBox}>
                <Feather name="activity" size={16} color={colors.primary.gold} />
                <Text style={styles.lastMileageText}>
                  Ostatni zapisany przebieg: {lastMileage.toLocaleString('pl-PL')} km
                </Text>
              </View>
            )}

            <Text style={styles.inputLabel}>Stan licznika (km) *</Text>
            <TextInput
              style={styles.input}
              value={odometer}
              onChangeText={(value) => setOdometer(value.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              returnKeyType="done"
              placeholder="np. 125000"
              placeholderTextColor={colors.text.disabled}
            />

            <Text style={styles.inputLabel}>Uwagi (opcjonalnie)</Text>
            <TextInput
              style={[styles.input, styles.notesInput]}
              value={notes}
              onChangeText={setNotes}
              multiline
              textAlignVertical="top"
              placeholder="Stan pojazdu, uszkodzenia, tankowanie…"
              placeholderTextColor={colors.text.disabled}
            />

            <Text style={styles.confirmationHint}>
              Zapis stanowi potwierdzenie {handoverType === 'pickup' ? 'przejęcia' : 'zdania'} auta
              przez przypisanego kierowcę (stan licznika trafia do historii pojazdu).
            </Text>
          </ScrollView>

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onClose} disabled={saving}>
              <Text style={styles.secondaryButtonText}>Anuluj</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, saving && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.background.primary} />
              ) : (
                <>
                  <Feather name="check" size={17} color={colors.background.primary} />
                  <Text style={styles.primaryButtonText}>
                    Potwierdź {handoverType === 'pickup' ? 'przejęcie' : 'zdanie'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Dzień eventu (lokalnie) do sprawdzenia uprawnień kierowców — `YYYY-MM-DD`. */
function eventDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const personName = (row: { name?: string | null; surname?: string | null; nickname?: string | null } | null | undefined) =>
  row ? row.nickname || [row.name, row.surname].filter(Boolean).join(' ').trim() : '';

type DriverOption = { id: string; name: string };

function DriverPickerModal({
  assignment,
  eventDate,
  currentEmployeeId,
  onClose,
  onSaved,
}: {
  assignment: EventVehicleAssignment;
  eventDate: string | null | undefined;
  currentEmployeeId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [drivers, setDrivers] = useState<DriverOption[] | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const day = eventDay(eventDate);
    setDrivers(null);
    setMessage('');
    if (!assignment.vehicle_id) {
      setDrivers([]);
      setMessage('Kierowcę auta zewnętrznego zmienisz w CRM.');
      return;
    }
    if (!day) {
      setDrivers([]);
      setMessage('Uzupełnij datę eventu, aby sprawdzić uprawnienia kierowców.');
      return;
    }
    void supabase
      .rpc('qualified_vehicle_drivers', {
        p_vehicle_id: assignment.vehicle_id,
        p_date: day,
        p_trailer_id: assignment.has_trailer && !assignment.is_trailer_external ? assignment.trailer_vehicle_id ?? null : null,
        p_external_trailer: Boolean(assignment.has_trailer && assignment.is_trailer_external),
      })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setDrivers([]);
          setMessage(
            ['PGRST202', '42883'].includes(error.code ?? '')
              ? 'Sprawdzanie kierowców wymaga aktualizacji bazy.'
              : error.message || 'Nie udało się pobrać listy kierowców.',
          );
          return;
        }
        const list = ((data ?? []) as any[]).map((row) => ({ id: String(row.id), name: personName(row) || 'Pracownik' }));
        setDrivers(list);
        if (!list.length) {
          setMessage('Brak aktywnych pracowników z wymaganymi kategoriami prawa jazdy ważnymi w dniu eventu.');
        }
      });
    return () => {
      active = false;
    };
  }, [assignment.id, assignment.vehicle_id, assignment.has_trailer, assignment.is_trailer_external, assignment.trailer_vehicle_id, eventDate]);

  const choose = async (driverId: string | null) => {
    if (saving) return;
    if (driverId === assignment.driver_id) {
      onClose();
      return;
    }
    setSaving(driverId ?? 'none');
    setMessage('');
    try {
      const { data, error } = await supabase
        .from('event_vehicles')
        .update({ driver_id: driverId })
        .eq('id', assignment.id)
        .eq('event_id', assignment.event_id)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Zmiana nie została zapisana — brak uprawnień do logistyki tego eventu.');
      await onSaved();
      onClose();
    } catch (error: any) {
      setMessage(String(error?.message || 'Nie udało się zmienić kierowcy.'));
    } finally {
      setSaving(null);
    }
  };

  const meQualified = Boolean(currentEmployeeId && drivers?.some((driver) => driver.id === currentEmployeeId));
  const ordered = drivers
    ? [...drivers].sort((a, b) => Number(b.id === currentEmployeeId) - Number(a.id === currentEmployeeId))
    : [];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => !saving && onClose()}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleWrap}>
              <Text style={styles.modalTitle}>Kierowca auta</Text>
              <Text style={styles.modalSubtitle}>{vehicleName(assignment)}</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} disabled={Boolean(saving)}>
              <Feather name="x" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalContent, { gap: 8 }]}>
            <Text style={styles.confirmationHint}>
              Lista osób z wymaganymi kategoriami prawa jazdy ważnymi w dniu eventu. Nowy kierowca dostanie powiadomienie i
              potwierdza przypisanie; gdy wybierzesz siebie, przypisanie jest od razu potwierdzone.
            </Text>
            {!drivers && <ActivityIndicator color={colors.primary.gold} style={{ marginVertical: 16 }} />}
            {meQualified && currentEmployeeId !== assignment.driver_id && (
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.handoverButton, styles.pickupButton]}
                disabled={Boolean(saving)}
                onPress={() => void choose(currentEmployeeId)}
              >
                {saving === currentEmployeeId ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Feather name="key" size={17} color={colors.white} />
                )}
                <Text style={styles.handoverButtonText}>Przejmij auto jako kierowca</Text>
              </TouchableOpacity>
            )}
            {ordered.map((driver) => {
              const selected = driver.id === assignment.driver_id;
              return (
                <TouchableOpacity
                  key={driver.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: Boolean(saving) }}
                  disabled={Boolean(saving)}
                  onPress={() => void choose(driver.id)}
                  style={[styles.driverRow, selected && styles.driverRowSelected]}
                >
                  <Feather name="user" size={15} color={selected ? colors.primary.gold : colors.text.secondary} />
                  <Text style={styles.driverName}>
                    {driver.name}
                    {driver.id === currentEmployeeId ? ' (Ty)' : ''}
                  </Text>
                  {saving === driver.id ? (
                    <ActivityIndicator size="small" color={colors.primary.gold} />
                  ) : selected ? (
                    <Feather name="check" size={16} color={colors.primary.gold} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
            {!!assignment.driver_id && (
              <TouchableOpacity
                accessibilityRole="button"
                disabled={Boolean(saving)}
                onPress={() => void choose(null)}
                style={styles.driverRow}
              >
                <Feather name="user-x" size={15} color={colors.status.error} />
                <Text style={[styles.driverName, { color: colors.status.error }]}>Bez kierowcy</Text>
                {saving === 'none' && <ActivityIndicator size="small" color={colors.primary.gold} />}
              </TouchableOpacity>
            )}
            {!!message && <Text style={styles.pickerMessage}>{message}</Text>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type TransportState = { vehicles: TeamTransportVehicle[]; members: { employeeId: string; transportVehicleId: string | null; rejected: boolean }[] };

export function FleetTab({
  assignments,
  currentEmployeeId,
  onChanged,
  eventId,
  eventDate,
  team = [],
  canAssignDrivers = false,
  refreshKey,
}: FleetTabProps) {
  const [selectedAssignment, setSelectedAssignment] = useState<EventVehicleAssignment | null>(null);
  const [driverFor, setDriverFor] = useState<EventVehicleAssignment | null>(null);
  const [transport, setTransport] = useState<{ eventId: string; data: TransportState } | null>(null);
  const width = useContentWidth();
  const twoColumns = width >= 720;
  const readVersion = useRef(0);

  const loadTransport = useCallback(async () => {
    if (!eventId) return;
    const version = ++readVersion.current;
    const [vehicles, members] = await Promise.all([
      supabase.from('event_vehicles').select(TEAM_TRANSPORT_VEHICLE_SELECT).eq('event_id', eventId).order('created_at', { ascending: true }),
      supabase.from('employee_assignments').select('employee_id, status, transport_event_vehicle_id').eq('event_id', eventId),
    ]);
    if (version !== readVersion.current) return;
    // Bez kolumny dojazdu (starsza baza) albo bez dostępu — sekcja „Kto czym jedzie” się nie pokazuje.
    if (vehicles.error || members.error) {
      setTransport(null);
      return;
    }
    setTransport({
      eventId,
      data: {
        vehicles: mapTeamTransportVehicles((vehicles.data ?? []) as any[]),
        members: ((members.data ?? []) as any[]).map((row) => ({
          employeeId: String(row.employee_id || ''),
          transportVehicleId: row.transport_event_vehicle_id ? String(row.transport_event_vehicle_id) : null,
          rejected: row.status === 'rejected',
        })),
      },
    });
  }, [eventId]);

  const assignmentsKey = assignments.map((row) => `${row.id}:${row.driver_id ?? ''}:${row.is_in_use ? 1 : 0}`).join('|');
  const teamKey = team.map((member) => `${member.id}:${member.status ?? ''}`).join('|');
  useEffect(() => {
    void loadTransport();
  }, [loadTransport, assignmentsKey, teamKey, refreshKey]);
  useEffect(() => () => {
    readVersion.current++;
  }, []);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of team) map.set(member.id, personName(member) || 'Pracownik');
    for (const row of assignments) if (row.driver?.id) map.set(row.driver.id, personName(row.driver) || 'Kierowca');
    return map;
  }, [team, assignments]);
  const nameOf = (id: string | null) => (id ? `${names.get(id) || 'Pracownik'}${id === currentEmployeeId ? ' (Ty)' : ''}` : '');

  const transportData = eventId && transport?.eventId === eventId ? transport.data : null;
  const summary =
    transportData && transportData.vehicles.length ? summarizeTeamTransport(transportData.vehicles, transportData.members) : null;
  const travelling = (transportData?.members ?? []).filter((member) => member.employeeId && !member.rejected);
  const drivers = new Set((transportData?.vehicles ?? []).map((vehicle) => vehicle.driverId).filter(Boolean) as string[]);
  const withoutVehicle = travelling.filter((member) => !drivers.has(member.employeeId) && !member.transportVehicleId);
  const myRide = (() => {
    if (!summary || !currentEmployeeId) return null;
    const driving = transportData!.vehicles.find((vehicle) => vehicle.driverId === currentEmployeeId);
    if (driving) return `Kierujesz: ${driving.name}${driving.registration ? ` · ${driving.registration}` : ''}`;
    const me = travelling.find((member) => member.employeeId === currentEmployeeId);
    if (!me) return null;
    const riding = me.transportVehicleId ? transportData!.vehicles.find((vehicle) => vehicle.id === me.transportVehicleId) : null;
    return riding
      ? `Jedziesz: ${riding.name}${riding.registration ? ` · ${riding.registration}` : ''}${riding.driverId ? ` (kierowca: ${nameOf(riding.driverId)})` : ''}`
      : 'Nie masz przypisanego auta — dojazd własny.';
  })();

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>Logistyka eventu</Text>
          <Text style={styles.sectionSubtitle}>Auta, kierowcy i kto czym jedzie — aktualizują się na żywo</Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {!!myRide && (
        <View style={styles.myRide}>
          <Feather name="navigation" size={15} color={colors.primary.gold} />
          <Text style={styles.myRideText}>{myRide}</Text>
        </View>
      )}

      {summary && (
        <View style={styles.card}>
          <Text style={styles.transportTitle}>Kto czym jedzie</Text>
          {summary.loads.map((load) => {
            const passengers = travelling.filter(
              (member) => member.transportVehicleId === load.vehicle.id && member.employeeId !== load.vehicle.driverId,
            );
            return (
              <View key={load.vehicle.id} style={styles.transportRow}>
                <Feather name="truck" size={15} color={colors.primary.gold} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.transportVehicle}>
                    {load.vehicle.name}
                    {load.vehicle.registration ? <Text style={styles.registration}>{`  ${load.vehicle.registration}`}</Text> : null}
                  </Text>
                  <Text style={styles.dataValue}>Kierowca: {nameOf(load.vehicle.driverId) || 'nieprzypisany'}</Text>
                  <Text style={styles.historyMeta}>
                    {passengers.length ? `Pasażerowie: ${passengers.map((member) => nameOf(member.employeeId)).join(', ')}` : 'Bez pasażerów'}
                  </Text>
                </View>
                <Text style={[styles.seats, load.overCapacity && { color: colors.status.warning }]}>
                  {load.people}/{load.vehicle.seats ?? '?'}
                </Text>
              </View>
            );
          })}
          {withoutVehicle.length > 0 && (
            <View style={styles.transportRow}>
              <Feather name="user" size={15} color={colors.text.tertiary} />
              <Text style={[styles.historyMeta, { flex: 1 }]}>
                Bez auta (dojazd własny): {withoutVehicle.map((member) => nameOf(member.employeeId)).join(', ')}
              </Text>
            </View>
          )}
          {summary.warnings.map((warning) => (
            <Text key={warning} style={styles.warningText}>
              {warning}
            </Text>
          ))}
        </View>
      )}

      {assignments.length === 0 && (
        <View style={styles.readOnlyHint}>
          <Feather name="info" size={14} color={colors.text.tertiary} />
          <Text style={styles.readOnlyText}>Nie prowadzisz żadnego auta w tym evencie.</Text>
        </View>
      )}

      <View style={[styles.cards, twoColumns && styles.cardsTwo]}>
        {assignments.map((assignment) => {
          const isAssignedDriver = assignment.driver_id === currentEmployeeId;
          const pickupDate = formatDateTime(assignment.pickup_timestamp);
          const returnDate = formatDateTime(assignment.return_timestamp);
          const departureDate = formatDateTime(assignment.departure_time);
          const arrivalDate = formatDateTime(assignment.arrival_time);
          const passengers = transportData
            ? travelling.filter((member) => member.transportVehicleId === assignment.id && member.employeeId !== assignment.driver_id)
            : [];
          const canChangeDriver = canAssignDrivers && Boolean(eventId) && Boolean(assignment.vehicle_id) && !assignment.is_in_use;

          return (
            <View key={assignment.id} style={[styles.card, twoColumns && styles.cardHalf]}>
              <View style={styles.cardHeader}>
                <View style={styles.vehicleIcon}>
                  <Feather name="truck" size={20} color={colors.primary.gold} />
                </View>
                <View style={styles.vehicleHeading}>
                  <Text style={styles.vehicleName}>{vehicleName(assignment)}</Text>
                  {!!assignment.vehicle?.registration_number && (
                    <Text style={styles.registration}>{assignment.vehicle.registration_number}</Text>
                  )}
                </View>
                <View style={[styles.statusBadge, assignment.is_in_use ? styles.statusInUse : styles.statusPlanned]}>
                  <Text style={[styles.statusText, assignment.is_in_use ? styles.statusInUseText : styles.statusPlannedText]}>
                    {assignment.is_in_use ? 'W użytkowaniu' : STATUS_LABELS[assignment.status] || 'Przypisany'}
                  </Text>
                </View>
              </View>

              <View style={styles.detailsGrid}>
                <DataRow
                  icon="user"
                  label="Kierowca"
                  value={
                    `${[assignment.driver?.name, assignment.driver?.surname].filter(Boolean).join(' ') || 'Nieprzypisany'}` +
                    (isAssignedDriver ? ' (Ty)' : '')
                  }
                />
                {passengers.length > 0 && (
                  <DataRow icon="users" label="Pasażerowie" value={passengers.map((member) => nameOf(member.employeeId)).join(', ')} />
                )}
                <DataRow icon="briefcase" label="Rola" value={ROLE_LABELS[assignment.role] || assignment.role} />
                {!!assignment.departure_location && (
                  <DataRow icon="map-pin" label="Miejsce wyjazdu" value={assignment.departure_location} />
                )}
                {!!departureDate && <DataRow icon="arrow-right" label="Wyjazd" value={departureDate} />}
                {!!arrivalDate && <DataRow icon="flag" label="Planowany przyjazd" value={arrivalDate} />}
                {!!assignment.notes && <DataRow icon="file-text" label="Uwagi" value={assignment.notes} />}
              </View>

              {(pickupDate || returnDate) && (
                <View style={styles.handoverHistory}>
                  {pickupDate && (
                    <View style={styles.historyItem}>
                      <View style={[styles.historyIcon, styles.pickupIcon]}>
                        <Feather name="log-in" size={14} color={colors.status.success} />
                      </View>
                      <View style={styles.historyText}>
                        <Text style={styles.historyTitle}>Przejęto {pickupDate}</Text>
                        {assignment.pickup_odometer !== null && (
                          <Text style={styles.historyMeta}>Licznik: {assignment.pickup_odometer.toLocaleString('pl-PL')} km</Text>
                        )}
                      </View>
                    </View>
                  )}
                  {returnDate && (
                    <View style={styles.historyItem}>
                      <View style={[styles.historyIcon, styles.returnIcon]}>
                        <Feather name="log-out" size={14} color={colors.status.info} />
                      </View>
                      <View style={styles.historyText}>
                        <Text style={styles.historyTitle}>Zdano {returnDate}</Text>
                        {assignment.return_odometer !== null && (
                          <Text style={styles.historyMeta}>Licznik: {assignment.return_odometer.toLocaleString('pl-PL')} km</Text>
                        )}
                        {!!assignment.return_notes && <Text style={styles.historyMeta}>{assignment.return_notes}</Text>}
                      </View>
                    </View>
                  )}
                </View>
              )}

              {isAssignedDriver ? (
                <TouchableOpacity
                  style={[styles.handoverButton, assignment.is_in_use ? styles.returnButton : styles.pickupButton]}
                  onPress={() => setSelectedAssignment(assignment)}
                >
                  <Feather name={assignment.is_in_use ? 'log-out' : 'key'} size={18} color={colors.white} />
                  <Text style={styles.handoverButtonText}>{assignment.is_in_use ? 'Zdaj auto' : 'Przejmij auto'}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.readOnlyHint}>
                  <Feather name="lock" size={14} color={colors.text.tertiary} />
                  <Text style={styles.readOnlyText}>
                    Przejęcie i zdanie auta potwierdza przypisany kierowca
                    {canChangeDriver ? ' — możesz zmienić kierowcę albo przejąć auto jako kierowca.' : '.'}
                  </Text>
                </View>
              )}
              {canChangeDriver && (
                <TouchableOpacity style={styles.driverButton} onPress={() => setDriverFor(assignment)}>
                  <Feather name="repeat" size={15} color={colors.primary.gold} />
                  <Text style={styles.driverButtonText}>{assignment.driver_id ? 'Zmień kierowcę' : 'Przypisz kierowcę'}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      {selectedAssignment && (
        <HandoverModal
          assignment={selectedAssignment}
          visible
          onClose={() => setSelectedAssignment(null)}
          onSaved={onChanged}
        />
      )}
      {driverFor && (
        <DriverPickerModal
          assignment={driverFor}
          eventDate={eventDate}
          currentEmployeeId={currentEmployeeId}
          onClose={() => setDriverFor(null)}
          onSaved={async () => {
            await onChanged();
            await loadTransport();
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  sectionTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 15, fontWeight: '400', color: colors.text.primary },
  sectionSubtitle: { fontSize: 11, color: colors.text.tertiary, marginTop: 3 },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: colors.status.success + '18',
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.status.success },
  liveText: { fontSize: 9, fontWeight: '800', color: colors.status.success },
  card: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 12,
    padding: 14,
    gap: 13,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  vehicleIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.primary.gold + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleHeading: { flex: 1 },
  vehicleName: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 14, fontWeight: '400', color: colors.text.primary },
  registration: { fontSize: 11, color: colors.text.secondary, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusInUse: { backgroundColor: colors.status.success + '1f' },
  statusPlanned: { backgroundColor: colors.status.info + '1f' },
  statusText: { fontSize: 9, fontWeight: '700' },
  statusInUseText: { color: colors.status.success },
  statusPlannedText: { color: colors.status.info },
  detailsGrid: { gap: 10 },
  dataRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  dataText: { flex: 1 },
  dataLabel: { fontSize: 10, color: colors.text.tertiary },
  dataValue: { fontSize: 12, color: colors.text.primary, marginTop: 1 },
  handoverHistory: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    paddingTop: 12,
  },
  historyItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  historyIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupIcon: { backgroundColor: colors.status.success + '18' },
  returnIcon: { backgroundColor: colors.status.info + '18' },
  historyText: { flex: 1 },
  historyTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 11, fontWeight: '400', color: colors.text.primary },
  historyMeta: { fontSize: 10, color: colors.text.tertiary, marginTop: 2 },
  handoverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 9,
    paddingVertical: 11,
  },
  pickupButton: { backgroundColor: colors.status.success },
  returnButton: { backgroundColor: colors.status.info },
  handoverButtonText: { fontSize: 13, fontWeight: '700', color: colors.white },
  readOnlyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: colors.background.tertiary,
    padding: 9,
  },
  readOnlyText: { flex: 1, fontSize: 10, color: colors.text.tertiary },
  cards: { gap: 12 },
  cardsTwo: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  cardHalf: { width: '49%' },
  myRide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary.gold + '55',
    backgroundColor: colors.primary.gold + '12',
  },
  myRideText: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text.primary },
  transportTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 13, fontWeight: '400', color: colors.text.primary },
  transportRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  transportVehicle: { fontSize: 13, fontWeight: '600', color: colors.text.primary },
  seats: { fontSize: 12, fontWeight: '700', color: colors.text.secondary },
  warningText: { fontSize: 11, lineHeight: 16, color: colors.status.warning },
  driverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 9,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border.hover,
  },
  driverButtonText: { fontSize: 13, fontWeight: '600', color: colors.primary.gold },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.tertiary,
  },
  driverRowSelected: { borderColor: colors.primary.gold, backgroundColor: colors.primary.gold + '14' },
  driverName: { flex: 1, fontSize: 13, color: colors.text.primary },
  pickerMessage: { fontSize: 12, lineHeight: 17, color: colors.text.secondary, marginTop: 4 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.68)',
  },
  modalCard: {
    maxHeight: '88%',
    backgroundColor: colors.background.secondary,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: colors.border.hover,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  modalTitleWrap: { flex: 1 },
  modalTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 17, fontWeight: '400', color: colors.text.primary },
  modalSubtitle: { fontSize: 12, color: colors.text.secondary, marginTop: 3 },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  modalScroll: { flexGrow: 0 },
  modalContent: { padding: spacing.md, paddingBottom: 20 },
  lastMileageBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: colors.primary.gold + '12',
    marginBottom: 16,
  },
  lastMileageText: { fontSize: 11, color: colors.primary.gold },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text.secondary,
    marginBottom: 6,
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.hover,
    borderRadius: 9,
    backgroundColor: colors.background.primary,
    color: colors.text.primary,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    marginBottom: 15,
  },
  notesInput: { minHeight: 88 },
  confirmationHint: { fontSize: 10, lineHeight: 15, color: colors.text.tertiary },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border.hover,
    borderRadius: 9,
    paddingVertical: 11,
  },
  secondaryButtonText: { fontSize: 13, fontWeight: '600', color: colors.text.secondary },
  primaryButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 9,
    backgroundColor: colors.primary.gold,
    paddingVertical: 11,
  },
  primaryButtonText: { fontSize: 13, fontWeight: '700', color: colors.background.primary },
  buttonDisabled: { opacity: 0.55 },
});
