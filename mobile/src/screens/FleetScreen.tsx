import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import PermissionGate from '../components/PermissionGate';
import {
  FleetAdHocUsage,
  FleetOperationAssignment,
  FuelEntryModal,
  VehicleHandoverModal,
  VehicleIssueModal,
} from '../components/Fleet/FleetOperationModals';
import { useAuth } from '../contexts/AuthContext';
import { canManage, canView } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import { borderRadius, colors, spacing, typography } from '../theme';

interface VehicleImage {
  id: string;
  image_url: string;
  is_primary: boolean | null;
  sort_order: number | null;
}

interface FleetVehicle {
  id: string;
  name: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  registration_number: string | null;
  status: string;
  category: string | null;
  current_mileage: number | null;
  thumb_url: string | null;
  primary_image_url: string | null;
  vehicle_images: VehicleImage[];
  upcoming_services: number;
  expiring_insurance: number;
  in_use: boolean;
  in_use_by: string | null;
  in_use_event: string | null;
  operation_assignment: FleetOperationAssignment | null;
  ad_hoc_usage: FleetAdHocUsage | null;
}

type FleetFilter = 'all' | 'available' | 'in_use' | 'service' | 'attention';

const STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: 'Dostępny', color: colors.status.success },
  available: { label: 'Dostępny', color: colors.status.success },
  in_use: { label: 'W użytkowaniu', color: colors.primary.gold },
  inactive: { label: 'Nieaktywny', color: colors.text.tertiary },
  in_service: { label: 'W serwisie', color: '#FB923C' },
  under_repair: { label: 'W naprawie', color: '#FB923C' },
  no_insurance: { label: 'Brak ważnego OC', color: colors.status.error },
  no_inspection: { label: 'Brak przeglądu', color: colors.status.error },
  sold: { label: 'Sprzedany', color: '#60A5FA' },
  scrapped: { label: 'Złomowany', color: colors.status.error },
};

const MANAGE_STATUSES = [
  { value: 'active', label: 'Dostępny' },
  { value: 'in_service', label: 'W serwisie' },
  { value: 'under_repair', label: 'W naprawie' },
  { value: 'inactive', label: 'Nieaktywny' },
] as const;



const getStatusMeta = (status: string, inUse: boolean) => {
  if (inUse) return STATUS_META.in_use;
  return STATUS_META[status] ?? STATUS_META.inactive;
};

const getVehicleTitle = (vehicle: FleetVehicle) =>
  vehicle.name || [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Pojazd';

function StatusBadge({ vehicle }: { vehicle: FleetVehicle }) {
  const meta = getStatusMeta(vehicle.status, vehicle.in_use);
  return (
    <View style={[styles.statusBadge, { borderColor: `${meta.color}55`, backgroundColor: `${meta.color}18` }]}>
      <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
      <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

function VehicleDetailsModal({
  vehicle,
  editable,
  canUseFleet,
  employeeId,
  onClose,
  onSaved,
}: {
  vehicle: FleetVehicle | null;
  editable: boolean;
  canUseFleet: boolean;
  employeeId: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [mileage, setMileage] = useState('');
  const [status, setStatus] = useState('active');
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState<'handover' | 'fuel' | 'issue' | null>(null);

  useEffect(() => {
    if (!vehicle) return;
    setMileage(vehicle.current_mileage == null ? '' : String(vehicle.current_mileage));
    setStatus(
      MANAGE_STATUSES.some((option) => option.value === vehicle.status)
        ? vehicle.status
        : 'active',
    );
    setEditing(false);
    setOperation(null);
  }, [vehicle]);

  if (!vehicle) return null;

  const saveChanges = async () => {
    const normalizedMileage = mileage.trim() === '' ? null : Number(mileage);
    if (normalizedMileage !== null && (!Number.isInteger(normalizedMileage) || normalizedMileage < 0)) {
      Alert.alert('Nieprawidłowy przebieg', 'Podaj pełny, nieujemny stan licznika.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('vehicles')
        .update({ current_mileage: normalizedMileage, status })
        .eq('id', vehicle.id);

      if (error) throw error;
      await onSaved();
      setEditing(false);
    } catch (error: any) {
      Alert.alert('Nie udało się zapisać', error?.message || 'Spróbuj ponownie za chwilę.');
    } finally {
      setSaving(false);
    }
  };

  const imageUrl = vehicle.primary_image_url || vehicle.thumb_url || vehicle.vehicle_images[0]?.image_url;
  const assignment = vehicle.operation_assignment;
  const adHocUsage = vehicle.ad_hoc_usage;
  const isAssignedDriver = Boolean(assignment && assignment.driver_id === employeeId);
  const isCurrentAdHocDriver = Boolean(adHocUsage && adHocUsage.driver_id === employeeId);
  const canStartAdHoc =
    canUseFleet &&
    !vehicle.in_use &&
    !assignment &&
    ['active', 'available'].includes(vehicle.status);
  const canRecordOperation = editable || isAssignedDriver || isCurrentAdHocDriver;
  const handoverAssignment = isCurrentAdHocDriver ? null : assignment;
  const operationVehicle = {
    id: vehicle.id,
    title: getVehicleTitle(vehicle),
    registrationNumber: vehicle.registration_number,
    currentMileage: vehicle.current_mileage,
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHeader}>
            <View style={styles.modalHeading}>
              <Text style={styles.modalTitle} numberOfLines={1}>{getVehicleTitle(vehicle)}</Text>
              <Text style={styles.modalSubtitle}>
                {[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} disabled={saving}>
              <Feather name="x" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.detailImage} resizeMode="cover" />
            ) : (
              <View style={styles.detailImagePlaceholder}>
                <Feather name="truck" size={42} color={colors.text.tertiary} />
              </View>
            )}

            <View style={styles.detailTopRow}>
              <StatusBadge vehicle={vehicle} />
              {vehicle.registration_number ? (
                <View style={styles.registrationBadge}>
                  <Text style={styles.registrationText}>{vehicle.registration_number}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.detailGrid}>
              <View style={styles.detailTile}>
                <Feather name="activity" size={17} color={colors.primary.gold} />
                <Text style={styles.detailLabel}>Przebieg</Text>
                <Text style={styles.detailValue}>
                  {vehicle.current_mileage == null
                    ? 'Brak danych'
                    : `${vehicle.current_mileage.toLocaleString('pl-PL')} km`}
                </Text>
              </View>
              <View style={styles.detailTile}>
                <Feather name="alert-triangle" size={17} color={colors.primary.gold} />
                <Text style={styles.detailLabel}>Alerty</Text>
                <Text style={styles.detailValue}>
                  {vehicle.upcoming_services + vehicle.expiring_insurance || 'Brak'}
                </Text>
              </View>
            </View>

            {vehicle.in_use && (
              <View style={styles.usageBox}>
                <Feather name="navigation" size={18} color={colors.primary.gold} />
                <View style={styles.usageContent}>
                  <Text style={styles.usageTitle}>Pojazd jest w użyciu</Text>
                  {vehicle.in_use_by ? <Text style={styles.usageText}>{vehicle.in_use_by}</Text> : null}
                  {vehicle.in_use_event ? <Text style={styles.usageText}>{vehicle.in_use_event}</Text> : null}
                  {adHocUsage?.pickup_timestamp ? (
                    <Text style={styles.usageText}>
                      Odebrano: {new Date(adHocUsage.pickup_timestamp).toLocaleString('pl-PL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      })}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}

            {canRecordOperation && (
              <View style={styles.operationSection}>
                <View style={styles.operationHeading}>
                  <View>
                    <Text style={styles.sectionTitle}>Operacje pojazdu</Text>
                    <Text style={styles.operationHint}>Zapisy są od razu widoczne w systemie floty.</Text>
                  </View>
                  <View style={styles.liveBadge}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>LIVE</Text>
                  </View>
                </View>

                <View style={styles.operationGrid}>
                  <TouchableOpacity style={styles.operationButton} onPress={() => setOperation('fuel')}>
                    <View style={styles.operationIcon}>
                      <Feather name="droplet" size={18} color={colors.primary.gold} />
                    </View>
                    <Text style={styles.operationButtonTitle}>Tankowanie</Text>
                    <Text style={styles.operationButtonText} numberOfLines={2}>Dodaj koszt i zdjęcie dokumentu</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.operationButton} onPress={() => setOperation('issue')}>
                    <View style={styles.operationIcon}>
                      <Feather name="alert-triangle" size={18} color={colors.primary.gold} />
                    </View>
                    <Text style={styles.operationButtonTitle}>Zgłoś uwagę</Text>
                    <Text style={styles.operationButtonText} numberOfLines={2}>Szkoda lub sugestia naprawy</Text>
                  </TouchableOpacity>
                </View>

                {editable && !editing ? (
                  <TouchableOpacity style={styles.editDataButton} onPress={() => setEditing(true)}>
                    <Feather name="edit-2" size={14} color={colors.text.tertiary} />
                    <Text style={styles.editDataButtonText}>Edytuj dane pojazdu</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            {editing && editable && (
              <View style={styles.editSection}>
                <Text style={styles.sectionTitle}>Dane operacyjne</Text>
                <Text style={styles.inputLabel}>Stan pojazdu</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.statusOptions}
                >
                  {MANAGE_STATUSES.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.statusOption, status === option.value && styles.statusOptionActive]}
                      onPress={() => setStatus(option.value)}
                      disabled={saving}
                    >
                      <Text
                        style={[
                          styles.statusOptionText,
                          status === option.value && styles.statusOptionTextActive,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.inputLabel}>Aktualny przebieg (km)</Text>
                <TextInput
                  style={styles.input}
                  value={mileage}
                  onChangeText={(value) => setMileage(value.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="np. 125000"
                  placeholderTextColor={colors.text.disabled}
                  editable={!saving}
                />
              </View>
            )}
          </ScrollView>

          {canUseFleet && (
            <View style={styles.modalActions}>
              {editing ? (
                <>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={() => setEditing(false)}
                    disabled={saving}
                  >
                    <Text style={styles.secondaryButtonText}>Anuluj</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, saving && styles.disabledButton]}
                    onPress={saveChanges}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color={colors.background.primary} />
                    ) : (
                      <>
                        <Feather name="save" size={17} color={colors.background.primary} />
                        <Text style={styles.primaryButtonText}>Zapisz</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              ) : isCurrentAdHocDriver && adHocUsage ? (
                <TouchableOpacity
                  style={[styles.fullWidthButton, styles.returnVehicleButton]}
                  onPress={() => setOperation('handover')}
                >
                  <Feather name="log-out" size={18} color={colors.background.primary} />
                  <Text style={styles.primaryButtonText}>Zdaj pojazd</Text>
                </TouchableOpacity>
              ) : isAssignedDriver && assignment ? (
                <TouchableOpacity
                  style={[
                    styles.fullWidthButton,
                    assignment.is_in_use ? styles.returnVehicleButton : styles.pickupVehicleButton,
                  ]}
                  onPress={() => setOperation('handover')}
                >
                  <Feather
                    name={assignment.is_in_use ? 'log-out' : 'log-in'}
                    size={18}
                    color={colors.background.primary}
                  />
                  <Text style={styles.primaryButtonText}>
                    {assignment.is_in_use ? 'Zdaj pojazd' : 'Odbierz pojazd'}
                  </Text>
                </TouchableOpacity>
              ) : canStartAdHoc ? (
                <TouchableOpacity
                  style={[styles.fullWidthButton, styles.pickupVehicleButton]}
                  onPress={() => setOperation('handover')}
                >
                  <Feather name="log-in" size={18} color={colors.background.primary} />
                  <Text style={styles.primaryButtonText}>Odbierz pojazd</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.readOnlyAssignmentHint}>
                  <Feather name="user" size={15} color={colors.text.tertiary} />
                  <Text style={styles.readOnlyAssignmentText}>
                    {adHocUsage
                      ? `Pojazd odebrał(a): ${adHocUsage.driver_name}.`
                      : vehicle.in_use
                        ? 'Odbiór lub zdanie potwierdza przypisany kierowca.'
                        : 'Ten pojazd nie jest obecnie dostępny do odbioru.'}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>

        <VehicleHandoverModal
          visible={operation === 'handover'}
          vehicle={operationVehicle}
          assignment={handoverAssignment}
          adHocUsage={isCurrentAdHocDriver ? adHocUsage : null}
          allowAdHocPickup={canStartAdHoc}
          onClose={() => setOperation(null)}
          onSaved={onSaved}
        />
        <FuelEntryModal
          visible={operation === 'fuel'}
          vehicle={operationVehicle}
          assignment={assignment}
          onClose={() => setOperation(null)}
          onSaved={onSaved}
        />
        <VehicleIssueModal
          visible={operation === 'issue'}
          vehicle={operationVehicle}
          assignment={assignment}
          onClose={() => setOperation(null)}
          onSaved={onSaved}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FleetContent() {
  const { employee } = useAuth();
  const editable = canManage(employee, 'fleet');
  const canUseFleet = canView(employee, 'fleet');
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FleetFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadVehicles = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from('fleet_vehicles_view')
        .select(`
          *,
          vehicle_images (id, image_url, is_primary, sort_order)
        `)
        .order('name', { ascending: true });

      if (error) throw error;

      const vehicleIds = (data ?? []).map((vehicle: any) => vehicle.id).filter(Boolean);
      const { data: assignments, error: assignmentsError } = employee?.id && vehicleIds.length
        ? await supabase
            .from('event_vehicles')
            .select(`
              id, vehicle_id, driver_id, status, is_in_use, pickup_odometer, created_at,
              event:events!event_vehicles_event_id_fkey(name)
            `)
            .eq('driver_id', employee.id)
            .in('vehicle_id', vehicleIds)
            .in('status', ['planned', 'in_transit', 'arrived', 'returning'])
            .order('created_at', { ascending: false })
        : { data: [], error: null };

      if (assignmentsError) throw assignmentsError;

      const { data: activeUsages, error: activeUsagesError } = vehicleIds.length
        ? await supabase.rpc('get_current_vehicle_usages')
        : { data: [], error: null };

      if (activeUsagesError) throw activeUsagesError;

      const assignmentByVehicle = new Map<string, FleetOperationAssignment>();
      ((assignments ?? []) as any[])
        .sort((left, right) => Number(Boolean(right.is_in_use)) - Number(Boolean(left.is_in_use)))
        .forEach((assignment) => {
          if (!assignment.vehicle_id || assignmentByVehicle.has(assignment.vehicle_id)) return;
          const event = Array.isArray(assignment.event) ? assignment.event[0] : assignment.event;
          assignmentByVehicle.set(assignment.vehicle_id, {
            id: assignment.id,
            vehicle_id: assignment.vehicle_id,
            driver_id: assignment.driver_id,
            status: assignment.status,
            is_in_use: Boolean(assignment.is_in_use),
            pickup_odometer: assignment.pickup_odometer == null ? null : Number(assignment.pickup_odometer),
            event_title: event?.name ?? null,
          });
        });

      const adHocUsageByVehicle = new Map<string, FleetAdHocUsage>();
      ((activeUsages ?? []) as any[]).forEach((usage) => {
        if (!usage.vehicle_id) return;
        adHocUsageByVehicle.set(usage.vehicle_id, {
          vehicle_id: usage.vehicle_id,
          usage_session_id: usage.usage_session_id,
          driver_id: usage.driver_id,
          driver_name: usage.driver_name,
          pickup_timestamp: usage.pickup_timestamp,
          pickup_odometer: Number(usage.pickup_odometer) || 0,
          purpose: usage.purpose,
          pickup_notes: usage.pickup_notes ?? null,
        });
      });

      const mapped = ((data ?? []) as any[]).map((vehicle) => {
        const images = [...(vehicle.vehicle_images ?? [])].sort((left, right) => {
          if (Boolean(left.is_primary) !== Boolean(right.is_primary)) return left.is_primary ? -1 : 1;
          return (left.sort_order ?? 9999) - (right.sort_order ?? 9999);
        });

        const adHocUsage = adHocUsageByVehicle.get(vehicle.id) ?? null;

        return {
          ...vehicle,
          vehicle_images: images,
          primary_image_url:
            vehicle.primary_image_url || images.find((image) => image.is_primary)?.image_url || images[0]?.image_url || null,
          upcoming_services: Number(vehicle.upcoming_services) || 0,
          expiring_insurance: Number(vehicle.expiring_insurance) || 0,
          in_use: Boolean(vehicle.in_use || adHocUsage),
          in_use_by: adHocUsage?.driver_name ?? vehicle.in_use_by ?? null,
          in_use_event: adHocUsage
            ? `Wyjazd doraźny: ${adHocUsage.purpose}`
            : vehicle.in_use_event ?? null,
          operation_assignment: assignmentByVehicle.get(vehicle.id) ?? null,
          ad_hoc_usage: adHocUsage,
        } as FleetVehicle;
      });

      setVehicles(mapped);
      setSelectedVehicle((current) => mapped.find((item) => item.id === current?.id) ?? current);
    } catch (error: any) {
      console.error('Error fetching fleet:', error);
      Alert.alert('Nie udało się wczytać floty', error?.message || 'Spróbuj ponownie za chwilę.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [employee?.id]);

  useEffect(() => {
    void loadVehicles();

    const channel = supabase
      .channel(`mobile-fleet-${employee?.id ?? 'anonymous'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => void loadVehicles())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_vehicles' }, () => void loadVehicles())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_handovers' }, () => void loadVehicles())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_alerts' }, () => void loadVehicles())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'insurance_policies' }, () => void loadVehicles())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [employee?.id, loadVehicles]);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl-PL');
    return vehicles.filter((vehicle) => {
      const matchesQuery =
        !query ||
        [vehicle.name, vehicle.brand, vehicle.model, vehicle.registration_number]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase('pl-PL').includes(query));

      const matchesFilter =
        filter === 'all' ||
        (filter === 'available' && ['active', 'available'].includes(vehicle.status) && !vehicle.in_use) ||
        (filter === 'in_use' && (vehicle.in_use || vehicle.status === 'in_use')) ||
        (filter === 'service' && ['in_service', 'under_repair'].includes(vehicle.status)) ||
        (filter === 'attention' &&
          (vehicle.upcoming_services > 0 ||
            vehicle.expiring_insurance > 0 ||
            ['no_insurance', 'no_inspection'].includes(vehicle.status)));

      return matchesQuery && matchesFilter;
    });
  }, [filter, search, vehicles]);

  const stats = useMemo(
    () => ({
      total: vehicles.length,
      available: vehicles.filter(
        (vehicle) => ['active', 'available'].includes(vehicle.status) && !vehicle.in_use,
      ).length,
      inUse: vehicles.filter((vehicle) => vehicle.in_use || vehicle.status === 'in_use').length,
      alerts: vehicles.reduce(
        (sum, vehicle) => sum + vehicle.upcoming_services + vehicle.expiring_insurance,
        0,
      ),
    }),
    [vehicles],
  );

  const renderVehicle = ({ item }: { item: FleetVehicle }) => {
    const imageUrl = item.primary_image_url || item.thumb_url || item.vehicle_images[0]?.image_url;
    const alerts = item.upcoming_services + item.expiring_insurance;
    return (
      <TouchableOpacity style={styles.vehicleCard} onPress={() => setSelectedVehicle(item)} activeOpacity={0.75}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.vehicleImage} resizeMode="cover" />
        ) : (
          <View style={styles.vehicleImagePlaceholder}>
            <Feather name="truck" size={25} color={colors.text.tertiary} />
          </View>
        )}
        <View style={styles.vehicleInfo}>
          <View style={styles.vehicleTitleRow}>
            <Text style={styles.vehicleName} numberOfLines={1}>{getVehicleTitle(item)}</Text>
            <Feather name="chevron-right" size={17} color={colors.text.tertiary} />
          </View>
          <Text style={styles.vehicleSubtitle} numberOfLines={1}>
            {[item.brand, item.model, item.year].filter(Boolean).join(' · ') || 'Brak danych modelu'}
          </Text>
          <View style={styles.vehicleMetaRow}>
            <StatusBadge vehicle={item} />
            {item.registration_number ? (
              <Text style={styles.registrationInline}>{item.registration_number}</Text>
            ) : null}
          </View>
          <View style={styles.vehicleFooter}>
            <Text style={styles.mileageText}>
              {item.current_mileage == null ? 'Brak przebiegu' : `${item.current_mileage.toLocaleString('pl-PL')} km`}
            </Text>
            {alerts > 0 ? (
              <View style={styles.alertBadge}>
                <Feather name="alert-triangle" size={12} color={colors.status.error} />
                <Text style={styles.alertBadgeText}>{alerts}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
        <Text style={styles.loadingText}>Ładowanie floty…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{stats.total}</Text>
          <Text style={styles.summaryLabel}>Pojazdy</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.status.success }]}>{stats.available}</Text>
          <Text style={styles.summaryLabel}>Dostępne</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.primary.gold }]}>{stats.inUse}</Text>
          <Text style={styles.summaryLabel}>W użyciu</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, stats.alerts > 0 && { color: colors.status.error }]}>{stats.alerts}</Text>
          <Text style={styles.summaryLabel}>Alerty</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <Feather name="search" size={17} color={colors.text.tertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Szukaj pojazdu lub rejestracji…"
          placeholderTextColor={colors.text.tertiary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Feather name="x" size={17} color={colors.text.tertiary} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filtersContent}
        style={styles.filters}
      >
        {FILTERS.map((item) => (
          <TouchableOpacity
            key={item.value}
            style={[styles.filterChip, filter === item.value && styles.filterChipActive]}
            onPress={() => setFilter(item.value)}
          >
            <Text style={[styles.filterText, filter === item.value && styles.filterTextActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView> */}

      <FlatList
        data={filteredVehicles}
        keyExtractor={(item) => item.id}
        renderItem={renderVehicle}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadVehicles(true)}
            tintColor={colors.primary.gold}
            colors={[colors.primary.gold]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="truck" size={48} color={colors.text.tertiary} />
            <Text style={styles.emptyTitle}>Brak pojazdów</Text>
            <Text style={styles.emptyText}>
              {search || filter !== 'all' ? 'Zmień wyszukiwanie lub filtr.' : 'Flota nie zawiera jeszcze pojazdów.'}
            </Text>
          </View>
        }
      />

      <VehicleDetailsModal
        vehicle={selectedVehicle}
        editable={editable}
        canUseFleet={canUseFleet}
        employeeId={employee?.id ?? null}
        onClose={() => setSelectedVehicle(null)}
        onSaved={() => loadVehicles()}
      />
    </View>
  );
}

export default function FleetScreen() {
  return (
    <PermissionGate module="fleet">
      <FleetContent />
    </PermissionGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.primary,
  },
  loadingText: { marginTop: spacing.md, color: colors.text.tertiary },
  summaryRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background.secondary,
    overflow: 'hidden',
  },
  summaryItem: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm },
  summaryValue: {
    color: colors.text.primary,
    fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.bold,
  },
  summaryLabel: { color: colors.text.tertiary, fontSize: 10, marginTop: 2 },
  searchContainer: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background.secondary,
  },
  searchInput: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.sm },
  filters: { flexGrow: 0, marginTop: spacing.sm },
  filtersContent: { paddingHorizontal: spacing.md, gap: spacing.sm },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.background.secondary,
  },
  filterChipActive: { borderColor: colors.primary.gold, backgroundColor: `${colors.primary.gold}20` },
  filterText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  filterTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  listContent: { padding: spacing.md, paddingBottom: spacing.xxl },
  vehicleCard: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background.secondary,
  },
  vehicleImage: { width: 92, height: 108, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  vehicleImagePlaceholder: {
    width: 92,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
  },
  vehicleInfo: { flex: 1, minWidth: 0 },
  vehicleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  vehicleName: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    flex: 1,
    color: colors.text.primary,
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold,
  },
  vehicleSubtitle: { marginTop: 2, color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  vehicleMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 10, fontWeight: typography.fontWeights.semibold },
  registrationInline: { color: colors.text.secondary, fontSize: 11, fontWeight: typography.fontWeights.semibold },
  vehicleFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  mileageText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  alertBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  alertBadgeText: { color: colors.status.error, fontSize: 11, fontWeight: typography.fontWeights.bold },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 72 },
  emptyTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', marginTop: spacing.md, color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold },
  emptyText: { marginTop: spacing.xs, color: colors.text.tertiary, textAlign: 'center' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  modalCard: {
    maxHeight: '92%',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border.default,
    backgroundColor: colors.background.primary,
  },
  modalHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginTop: spacing.sm, backgroundColor: colors.border.default },
  modalHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  modalHeading: { flex: 1, minWidth: 0 },
  modalTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold },
  modalSubtitle: { marginTop: 2, color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  closeButton: { padding: spacing.sm },
  modalContent: { padding: spacing.md, paddingBottom: spacing.lg },
  detailImage: { width: '100%', height: 190, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary },
  detailImagePlaceholder: { width: '100%', height: 150, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  detailTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  registrationBadge: { borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.sm, paddingHorizontal: spacing.sm, paddingVertical: 5, backgroundColor: colors.background.secondary },
  registrationText: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.bold, letterSpacing: 0.5 },
  detailGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  detailTile: { flex: 1, padding: spacing.md, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  detailLabel: { marginTop: spacing.sm, color: colors.text.tertiary, fontSize: 11 },
  detailValue: { marginTop: 2, color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  usageBox: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: `${colors.primary.gold}55`, borderRadius: borderRadius.lg, backgroundColor: `${colors.primary.gold}12` },
  usageContent: { flex: 1 },
  usageTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  usageText: { marginTop: 2, color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  operationSection: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border.default },
  operationHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  operationHint: { marginTop: 2, color: colors.text.tertiary, fontSize: 11 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: borderRadius.md, backgroundColor: `${colors.status.success}15` },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.status.success },
  liveText: { color: colors.status.success, fontSize: 9, fontWeight: typography.fontWeights.bold },
  operationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  operationButton: { flexGrow: 1, flexBasis: '46%', minHeight: 116, padding: spacing.md, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  operationIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md, backgroundColor: `${colors.primary.gold}14` },
  operationButtonTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', marginTop: spacing.sm, color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.bold },
  operationButtonText: { marginTop: 3, color: colors.text.tertiary, fontSize: 10, lineHeight: 14 },
  editDataButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md, paddingVertical: spacing.xs },
  editDataButtonText: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold },
  editSection: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border.default },
  sectionTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', marginBottom: spacing.md, color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.bold },
  inputLabel: { marginBottom: spacing.xs, color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  statusOptions: { gap: spacing.sm, paddingBottom: spacing.md },
  statusOption: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  statusOptionActive: { borderColor: colors.primary.gold, backgroundColor: `${colors.primary.gold}20` },
  statusOptionText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  statusOptionTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  input: { height: 46, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, color: colors.text.primary },
  modalActions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border.default, backgroundColor: colors.background.secondary },
  secondaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 46, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.md },
  secondaryButtonText: { color: colors.text.secondary, fontWeight: typography.fontWeights.semibold },
  primaryButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  fullWidthButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  pickupVehicleButton: { backgroundColor: colors.primary.gold },
  returnVehicleButton: { backgroundColor: '#FB923C' },
  readOnlyAssignmentHint: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
  readOnlyAssignmentText: { flexShrink: 1, color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textAlign: 'center' },
  primaryButtonText: { color: colors.background.primary, fontWeight: typography.fontWeights.bold },
  disabledButton: { opacity: 0.55 },
});
