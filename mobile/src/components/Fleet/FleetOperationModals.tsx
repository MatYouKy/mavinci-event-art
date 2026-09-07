import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as decodeBase64 } from 'base64-arraybuffer';

import { supabase } from '../../lib/supabase';
import { borderRadius, colors, spacing, typography } from '../../theme';

export interface FleetOperationAssignment {
  id: string;
  vehicle_id: string;
  driver_id: string | null;
  status: string;
  is_in_use: boolean;
  pickup_odometer: number | null;
  event_title: string | null;
}

export interface FleetAdHocUsage {
  vehicle_id: string;
  usage_session_id: string;
  driver_id: string;
  driver_name: string;
  pickup_timestamp: string;
  pickup_odometer: number;
  purpose: string;
  pickup_notes: string | null;
}

export interface FleetOperationVehicle {
  id: string;
  title: string;
  registrationNumber: string | null;
  currentMileage: number | null;
}

interface BaseModalProps {
  vehicle: FleetOperationVehicle;
  assignment: FleetOperationAssignment | null;
  visible: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

function ModalShell({
  visible,
  title,
  subtitle,
  saving,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  saving: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.card}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
            </View>
            <TouchableOpacity style={styles.close} onPress={onClose} disabled={saving}>
              <Feather name="x" size={22} color={colors.text.secondary} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          <View style={styles.footer}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FooterButtons({
  saving,
  submitLabel,
  submitIcon,
  onClose,
  onSubmit,
}: {
  saving: boolean;
  submitLabel: string;
  submitIcon: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <TouchableOpacity style={styles.secondaryButton} onPress={onClose} disabled={saving}>
        <Text style={styles.secondaryButtonText}>Anuluj</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.primaryButton, saving && styles.disabled]}
        onPress={onSubmit}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator size="small" color={colors.background.primary} />
        ) : (
          <>
            <Feather name={submitIcon as any} size={17} color={colors.background.primary} />
            <Text style={styles.primaryButtonText}>{submitLabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </>
  );
}

export function VehicleHandoverModal(
  props: BaseModalProps & {
    adHocUsage: FleetAdHocUsage | null;
    allowAdHocPickup: boolean;
  },
) {
  const { vehicle, assignment, adHocUsage, allowAdHocPickup, visible, onClose, onSaved } = props;
  const isAdHoc = Boolean(adHocUsage) || (!assignment && allowAdHocPickup);
  const handoverType = adHocUsage || assignment?.is_in_use ? 'return' : 'pickup';
  const minimumMileage = Math.max(
    vehicle.currentMileage ?? 0,
    assignment?.pickup_odometer ?? 0,
    adHocUsage?.pickup_odometer ?? 0,
  );
  const [odometer, setOdometer] = useState('');
  const [purpose, setPurpose] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setOdometer(minimumMileage > 0 ? String(minimumMileage) : '');
    setPurpose(adHocUsage?.purpose ?? '');
    setNotes('');
  }, [adHocUsage?.purpose, handoverType, minimumMileage, visible]);

  const save = async () => {
    if (!assignment && !adHocUsage && !allowAdHocPickup) return;
    if (!odometer.trim()) {
      Alert.alert('Brak stanu licznika', 'Podaj aktualny stan licznika.');
      return;
    }
    const value = Number(odometer);
    if (!Number.isInteger(value) || value < minimumMileage) {
      Alert.alert(
        'Nieprawidłowy licznik',
        `Podaj pełny stan licznika, nie mniejszy niż ${minimumMileage.toLocaleString('pl-PL')} km.`,
      );
      return;
    }

    if (isAdHoc && handoverType === 'pickup' && purpose.trim().length < 3) {
      Alert.alert('Podaj cel wyjazdu', 'Napisz krótko, dokąd lub w jakim celu odbierasz auto.');
      return;
    }

    setSaving(true);
    try {
      const { error } = assignment
        ? await supabase.rpc('record_assigned_vehicle_handover', {
            p_event_vehicle_id: assignment.id,
            p_handover_type: handoverType,
            p_odometer_reading: value,
            p_notes: notes.trim() || null,
          })
        : await supabase.rpc('record_ad_hoc_vehicle_handover', {
            p_vehicle_id: vehicle.id,
            p_handover_type: handoverType,
            p_odometer_reading: value,
            p_purpose: handoverType === 'pickup' ? purpose.trim() : adHocUsage?.purpose ?? null,
            p_notes: notes.trim() || null,
          });
      if (error) throw error;
      await onSaved();
      onClose();
      Alert.alert(
        handoverType === 'pickup' ? 'Auto odebrane' : 'Auto zdane',
        'Zmiana jest od razu widoczna dla pozostałych użytkowników.',
      );
    } catch (error: any) {
      Alert.alert('Nie udało się zapisać', error?.message || 'Spróbuj ponownie za chwilę.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      visible={visible}
      title={handoverType === 'pickup' ? 'Odbierz auto' : 'Zdaj auto'}
      subtitle={vehicle.title}
      saving={saving}
      onClose={onClose}
      footer={
        <FooterButtons
          saving={saving}
          submitLabel={handoverType === 'pickup' ? 'Potwierdź odbiór' : 'Potwierdź zdanie'}
          submitIcon={handoverType === 'pickup' ? 'log-in' : 'log-out'}
          onClose={onClose}
          onSubmit={save}
        />
      }
    >
      {assignment?.event_title ? (
        <View style={styles.infoBox}>
          <Feather name="calendar" size={16} color={colors.primary.gold} />
          <Text style={styles.infoText}>{assignment.event_title}</Text>
        </View>
      ) : null}
      {isAdHoc && handoverType === 'return' && adHocUsage ? (
        <View style={styles.infoBox}>
          <Feather name="navigation" size={16} color={colors.primary.gold} />
          <View style={styles.infoContent}>
            <Text style={styles.infoCaption}>Cel wyjazdu doraźnego</Text>
            <Text style={styles.infoText}>{adHocUsage.purpose}</Text>
          </View>
        </View>
      ) : null}
      {isAdHoc && handoverType === 'pickup' ? (
        <>
          <Text style={styles.label}>Cel wyjazdu *</Text>
          <TextInput
            style={styles.input}
            value={purpose}
            onChangeText={setPurpose}
            maxLength={500}
            placeholder="np. odbiór materiałów z magazynu"
            placeholderTextColor={colors.text.disabled}
            editable={!saving}
          />
          <Text style={styles.fieldHint}>
            Cel zostanie zapisany w historii użytkowania pojazdu.
          </Text>
        </>
      ) : null}
      <Text style={styles.label}>Stan licznika (km) *</Text>
      <TextInput
        style={styles.input}
        value={odometer}
        onChangeText={(value) => setOdometer(value.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder="np. 125000"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />
      <Text style={styles.label}>Uwagi (opcjonalnie)</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={notes}
        onChangeText={setNotes}
        multiline
        textAlignVertical="top"
        placeholder="Stan auta przy przekazaniu…"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />
    </ModalShell>
  );
}

interface ReceiptPhoto {
  uri: string;
  mimeType: string;
  extension: string;
}

export function FuelEntryModal(props: BaseModalProps) {
  const { vehicle, assignment, visible, onClose, onSaved } = props;
  const [liters, setLiters] = useState('');
  const [price, setPrice] = useState('');
  const [odometer, setOdometer] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('company_card');
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<ReceiptPhoto | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLiters('');
    setPrice('');
    setOdometer(vehicle.currentMileage == null ? '' : String(vehicle.currentMileage));
    setPaymentMethod('company_card');
    setNotes('');
    setPhoto(null);
  }, [vehicle.currentMileage, visible]);

  const total = useMemo(() => {
    const value = Number(liters.replace(',', '.')) * Number(price.replace(',', '.'));
    return Number.isFinite(value) ? value : 0;
  }, [liters, price]);

  const acceptImage = (asset: ImagePicker.ImagePickerAsset) => {
    const mimeType = asset.mimeType || 'image/jpeg';
    const extension =
      asset.fileName?.split('.').pop()?.toLowerCase() ||
      (mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg');
    setPhoto({ uri: asset.uri, mimeType, extension });
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Brak dostępu', 'Zezwól aplikacji na dostęp do aparatu.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      exif: false,
    });
    if (!result.canceled && result.assets?.[0]) acceptImage(result.assets[0]);
  };

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Brak dostępu', 'Zezwól aplikacji na dostęp do zdjęć.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) acceptImage(result.assets[0]);
  };

  const choosePhoto = () => {
    Alert.alert('Zdjęcie paragonu lub faktury', 'Wybierz źródło zdjęcia.', [
      { text: 'Zrób zdjęcie', onPress: () => void takePhoto() },
      { text: 'Wybierz z galerii', onPress: () => void pickPhoto() },
      { text: 'Anuluj', style: 'cancel' },
    ]);
  };

  const save = async () => {
    const litersValue = Number(liters.replace(',', '.'));
    const priceValue = Number(price.replace(',', '.'));
    const mileageValue = Number(odometer);
    const minimumMileage = vehicle.currentMileage ?? 0;

    if (!Number.isFinite(litersValue) || litersValue <= 0) {
      Alert.alert('Brak ilości paliwa', 'Podaj prawidłową liczbę litrów.');
      return;
    }
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      Alert.alert('Brak ceny', 'Podaj prawidłową cenę za litr.');
      return;
    }
    if (!odometer.trim() || !Number.isInteger(mileageValue) || mileageValue < minimumMileage) {
      Alert.alert(
        'Nieprawidłowy licznik',
        `Stan licznika nie może być niższy niż ${minimumMileage.toLocaleString('pl-PL')} km.`,
      );
      return;
    }
    if (!photo) {
      Alert.alert('Dodaj zdjęcie', 'Do tankowania dołącz zdjęcie paragonu lub faktury.');
      return;
    }

    setSaving(true);
    let uploadedPath: string | null = null;
    try {
      const base64 = await FileSystem.readAsStringAsync(photo.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const file = decodeBase64(base64);
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user?.id) throw new Error('Brak aktywnej sesji użytkownika.');
      uploadedPath = `${vehicle.id}/${authData.user.id}/${vehicle.id}_${Date.now()}.${photo.extension}`;
      const { error: uploadError } = await supabase.storage
        .from('fuel-receipts')
        .upload(uploadedPath, file, { contentType: photo.mimeType, upsert: false });
      if (uploadError) throw uploadError;

      const { error } = await supabase.rpc('record_vehicle_fuel_entry', {
        p_vehicle_id: vehicle.id,
        p_event_vehicle_id: assignment?.id ?? null,
        p_liters: litersValue,
        p_price_per_liter: priceValue,
        p_odometer_reading: mileageValue,
        p_payment_method: paymentMethod,
        p_receipt_path: uploadedPath,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;

      await onSaved();
      onClose();
      Alert.alert('Tankowanie dodane', 'Wpis i zdjęcie dokumentu zostały zapisane.');
    } catch (error: any) {
      if (uploadedPath) await supabase.storage.from('fuel-receipts').remove([uploadedPath]);
      Alert.alert('Nie udało się dodać tankowania', error?.message || 'Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      visible={visible}
      title="Dodaj tankowanie"
      subtitle={vehicle.title}
      saving={saving}
      onClose={onClose}
      footer={
        <FooterButtons
          saving={saving}
          submitLabel="Zapisz tankowanie"
          submitIcon="droplet"
          onClose={onClose}
          onSubmit={save}
        />
      }
    >
      <View style={styles.twoColumns}>
        <View style={styles.column}>
          <Text style={styles.label}>Litry *</Text>
          <TextInput
            style={styles.input}
            value={liters}
            onChangeText={setLiters}
            keyboardType="decimal-pad"
            placeholder="45,50"
            placeholderTextColor={colors.text.disabled}
            editable={!saving}
          />
        </View>
        <View style={styles.column}>
          <Text style={styles.label}>Cena za litr *</Text>
          <TextInput
            style={styles.input}
            value={price}
            onChangeText={setPrice}
            keyboardType="decimal-pad"
            placeholder="6,59"
            placeholderTextColor={colors.text.disabled}
            editable={!saving}
          />
        </View>
      </View>

      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>Łączny koszt</Text>
        <Text style={styles.totalValue}>{total.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł</Text>
      </View>

      <Text style={styles.label}>Stan licznika (km) *</Text>
      <TextInput
        style={styles.input}
        value={odometer}
        onChangeText={(value) => setOdometer(value.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        placeholder="125000"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />

      <Text style={styles.label}>Płatność</Text>
      <View style={styles.optionsRow}>
        {[
          ['company_card', 'Karta firmowa'],
          ['cash', 'Gotówka'],
          ['private_card', 'Karta prywatna'],
        ].map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.option, paymentMethod === value && styles.optionActive]}
            onPress={() => setPaymentMethod(value)}
            disabled={saving}
          >
            <Text style={[styles.optionText, paymentMethod === value && styles.optionTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Zdjęcie paragonu lub faktury *</Text>
      <TouchableOpacity style={styles.photoButton} onPress={choosePhoto} disabled={saving}>
        {photo ? (
          <>
            <Image source={{ uri: photo.uri }} style={styles.receiptPreview} resizeMode="cover" />
            <View style={styles.photoOverlay}>
              <Feather name="refresh-cw" size={16} color={colors.white} />
              <Text style={styles.photoOverlayText}>Zmień zdjęcie</Text>
            </View>
          </>
        ) : (
          <>
            <Feather name="camera" size={24} color={colors.primary.gold} />
            <Text style={styles.photoButtonTitle}>Dodaj zdjęcie dokumentu</Text>
            <Text style={styles.photoButtonHint}>Aparat lub galeria</Text>
          </>
        )}
      </TouchableOpacity>

      <Text style={styles.label}>Uwagi (opcjonalnie)</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={notes}
        onChangeText={setNotes}
        multiline
        textAlignVertical="top"
        placeholder="np. tankowanie do pełna"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />
    </ModalShell>
  );
}

export function VehicleIssueModal(props: BaseModalProps) {
  const { vehicle, assignment, visible, onClose, onSaved } = props;
  const [reportType, setReportType] = useState<'damage' | 'suggestion'>('damage');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setReportType('damage');
    setSeverity('medium');
    setTitle('');
    setDescription('');
  }, [visible]);

  const save = async () => {
    if (title.trim().length < 3 || description.trim().length < 3) {
      Alert.alert('Uzupełnij zgłoszenie', 'Dodaj krótki tytuł i opisz zauważony problem.');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.rpc('report_vehicle_issue', {
        p_vehicle_id: vehicle.id,
        p_event_vehicle_id: assignment?.id ?? null,
        p_report_type: reportType,
        p_title: title.trim(),
        p_description: description.trim(),
        p_severity: severity,
      });
      if (error) throw error;
      await onSaved();
      onClose();
      Alert.alert('Zgłoszenie zapisane', 'Osoby zarządzające flotą zobaczą nowy alert.');
    } catch (error: any) {
      Alert.alert('Nie udało się wysłać zgłoszenia', error?.message || 'Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      visible={visible}
      title="Zgłoś uwagę"
      subtitle={vehicle.title}
      saving={saving}
      onClose={onClose}
      footer={
        <FooterButtons
          saving={saving}
          submitLabel="Wyślij zgłoszenie"
          submitIcon="send"
          onClose={onClose}
          onSubmit={save}
        />
      }
    >
      <Text style={styles.label}>Rodzaj zgłoszenia</Text>
      <View style={styles.optionsRow}>
        {[
          ['damage', 'Szkoda'],
          ['suggestion', 'Sugestia naprawy'],
        ].map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.option, reportType === value && styles.optionActive]}
            onPress={() => setReportType(value as 'damage' | 'suggestion')}
            disabled={saving}
          >
            <Text style={[styles.optionText, reportType === value && styles.optionTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Priorytet</Text>
      <View style={styles.optionsRow}>
        {[
          ['low', 'Niski'],
          ['medium', 'Normalny'],
          ['high', 'Pilny'],
          ['critical', 'Krytyczny'],
        ].map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.option, severity === value && styles.optionActive]}
            onPress={() => setSeverity(value as typeof severity)}
            disabled={saving}
          >
            <Text style={[styles.optionText, severity === value && styles.optionTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Tytuł *</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        maxLength={160}
        placeholder="np. Pęknięte lewe lusterko"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />
      <Text style={styles.label}>Opis *</Text>
      <TextInput
        style={[styles.input, styles.descriptionInput]}
        value={description}
        onChangeText={setDescription}
        maxLength={4000}
        multiline
        textAlignVertical="top"
        placeholder="Opisz miejsce, zakres i okoliczności…"
        placeholderTextColor={colors.text.disabled}
        editable={!saving}
      />
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.68)' },
  card: {
    maxHeight: '92%',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border.default,
    backgroundColor: colors.background.primary,
  },
  handle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, marginTop: spacing.sm, backgroundColor: colors.border.default },
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  heading: { flex: 1, minWidth: 0 },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold },
  subtitle: { marginTop: 2, color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  close: { padding: spacing.sm },
  scroll: { flexGrow: 0 },
  content: { padding: spacing.md, paddingBottom: spacing.lg },
  footer: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border.default, backgroundColor: colors.background.secondary },
  secondaryButton: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.md },
  secondaryButtonText: { color: colors.text.secondary, fontWeight: typography.fontWeights.semibold },
  primaryButton: { flex: 1.5, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  primaryButtonText: { color: colors.background.primary, fontWeight: typography.fontWeights.bold },
  disabled: { opacity: 0.55 },
  label: { marginTop: spacing.md, marginBottom: spacing.xs, color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  input: { minHeight: 46, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, color: colors.text.primary },
  multiline: { minHeight: 84, paddingTop: spacing.md },
  descriptionInput: { minHeight: 130, paddingTop: spacing.md },
  infoBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: `${colors.primary.gold}45`, borderRadius: borderRadius.md, backgroundColor: `${colors.primary.gold}12` },
  infoContent: { flex: 1 },
  infoCaption: { marginBottom: 2, color: colors.text.tertiary, fontSize: 10 },
  infoText: { flex: 1, color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  fieldHint: { marginTop: spacing.xs, color: colors.text.tertiary, fontSize: 10, lineHeight: 14 },
  twoColumns: { flexDirection: 'row', gap: spacing.sm },
  column: { flex: 1 },
  totalBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, padding: spacing.md, borderRadius: borderRadius.md, backgroundColor: `${colors.primary.gold}12`, borderWidth: 1, borderColor: `${colors.primary.gold}35` },
  totalLabel: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  totalValue: { color: colors.primary.gold, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold },
  optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  option: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  optionActive: { borderColor: colors.primary.gold, backgroundColor: `${colors.primary.gold}20` },
  optionText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  optionTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  photoButton: { minHeight: 132, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: `${colors.primary.gold}60`, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  photoButtonTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', marginTop: spacing.sm, color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  photoButtonHint: { marginTop: 2, color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  receiptPreview: { width: '100%', height: 180 },
  photoOverlay: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: borderRadius.md, backgroundColor: 'rgba(0,0,0,0.72)' },
  photoOverlayText: { color: colors.white, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold },
});
