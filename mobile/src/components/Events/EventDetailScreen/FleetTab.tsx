import React, { useEffect, useMemo, useState } from 'react';
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
  assignments: EventVehicleAssignment[];
  currentEmployeeId: string | null;
  onChanged: () => Promise<void>;
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
        handoverType === 'pickup' ? 'Pojazd odebrany' : 'Pojazd zdany',
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
                {handoverType === 'pickup' ? 'Odbierz pojazd' : 'Zdaj pojazd'}
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
              Zapis stanowi potwierdzenie {handoverType === 'pickup' ? 'odbioru' : 'zdania'} pojazdu
              przez przypisanego kierowcę.
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
                    Potwierdź {handoverType === 'pickup' ? 'odbiór' : 'zdanie'}
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

export function FleetTab({ assignments, currentEmployeeId, onChanged }: FleetTabProps) {
  const [selectedAssignment, setSelectedAssignment] = useState<EventVehicleAssignment | null>(null);

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Flota wydarzenia</Text>
          <Text style={styles.sectionSubtitle}>
            Dane aktualizują się automatycznie dla wszystkich użytkowników
          </Text>
        </View>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {assignments.map((assignment) => {
        const isAssignedDriver = assignment.driver_id === currentEmployeeId;
        const pickupDate = formatDateTime(assignment.pickup_timestamp);
        const returnDate = formatDateTime(assignment.return_timestamp);
        const departureDate = formatDateTime(assignment.departure_time);
        const arrivalDate = formatDateTime(assignment.arrival_time);

        return (
          <View key={assignment.id} style={styles.card}>
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
              <View
                style={[
                  styles.statusBadge,
                  assignment.is_in_use ? styles.statusInUse : styles.statusPlanned,
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    assignment.is_in_use ? styles.statusInUseText : styles.statusPlannedText,
                  ]}
                >
                  {assignment.is_in_use
                    ? 'W użytkowaniu'
                    : STATUS_LABELS[assignment.status] || 'Przypisany'}
                </Text>
              </View>
            </View>

            <View style={styles.detailsGrid}>
              <DataRow
                icon="user"
                label="Kierowca"
                value={
                  [assignment.driver?.name, assignment.driver?.surname].filter(Boolean).join(' ') ||
                  'Nieprzypisany'
                }
              />
              <DataRow
                icon="briefcase"
                label="Rola"
                value={ROLE_LABELS[assignment.role] || assignment.role}
              />
              {!!assignment.departure_location && (
                <DataRow icon="map-pin" label="Miejsce wyjazdu" value={assignment.departure_location} />
              )}
              {!!departureDate && <DataRow icon="arrow-right" label="Wyjazd" value={departureDate} />}
              {!!arrivalDate && <DataRow icon="flag" label="Planowany przyjazd" value={arrivalDate} />}
            </View>

            {(pickupDate || returnDate) && (
              <View style={styles.handoverHistory}>
                {pickupDate && (
                  <View style={styles.historyItem}>
                    <View style={[styles.historyIcon, styles.pickupIcon]}>
                      <Feather name="log-in" size={14} color={colors.status.success} />
                    </View>
                    <View style={styles.historyText}>
                      <Text style={styles.historyTitle}>Odebrano {pickupDate}</Text>
                      {assignment.pickup_odometer !== null && (
                        <Text style={styles.historyMeta}>
                          Licznik: {assignment.pickup_odometer.toLocaleString('pl-PL')} km
                        </Text>
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
                        <Text style={styles.historyMeta}>
                          Licznik: {assignment.return_odometer.toLocaleString('pl-PL')} km
                        </Text>
                      )}
                      {!!assignment.return_notes && (
                        <Text style={styles.historyMeta}>{assignment.return_notes}</Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}

            {isAssignedDriver ? (
              <TouchableOpacity
                style={[
                  styles.handoverButton,
                  assignment.is_in_use ? styles.returnButton : styles.pickupButton,
                ]}
                onPress={() => setSelectedAssignment(assignment)}
              >
                <Feather
                  name={assignment.is_in_use ? 'log-out' : 'log-in'}
                  size={18}
                  color={colors.white}
                />
                <Text style={styles.handoverButtonText}>
                  {assignment.is_in_use ? 'Zdaj pojazd' : 'Odbierz pojazd'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.readOnlyHint}>
                <Feather name="lock" size={14} color={colors.text.tertiary} />
                <Text style={styles.readOnlyText}>
                  Odbiór i zdanie może potwierdzić tylko przypisany kierowca.
                </Text>
              </View>
            )}
          </View>
        );
      })}

      {selectedAssignment && (
        <HandoverModal
          assignment={selectedAssignment}
          visible
          onClose={() => setSelectedAssignment(null)}
          onSaved={onChanged}
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
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.text.primary },
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
  vehicleName: { fontSize: 14, fontWeight: '700', color: colors.text.primary },
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
  historyTitle: { fontSize: 11, fontWeight: '600', color: colors.text.primary },
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
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.text.primary },
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
