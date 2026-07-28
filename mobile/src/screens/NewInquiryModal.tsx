import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';

import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { scheduleInquiryReminders } from '../services/inquiryReminders';
import { SearchableDropdown } from '@/components/SearchableDropdown';

interface NewInquiryModalProps {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  onSaved?: () => void;
}

interface LocationItem {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
}

interface OrganizationItem {
  id: string;
  name: string;
  alias: string | null;
}

interface ContactItem {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

interface EmployeeItem {
  id: string;
  user_id: string;
  name: string;
  surname: string;
  avatar_url: string | null;
}

export default function NewInquiryModal({
  visible,
  onClose,
  initialDate,
  onSaved,
}: NewInquiryModalProps) {
  const { employee } = useAuth();
  const [saving, setSaving] = useState(false);

  // Client data
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');

  // Organization/contact selection
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [selectedOrgLabel, setSelectedOrgLabel] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedContactLabel, setSelectedContactLabel] = useState<string | null>(null);
  const [orgSearch, setOrgSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');

  // Location
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedLocationLabel, setSelectedLocationLabel] = useState<string | null>(null);
  const [locationSearch, setLocationSearch] = useState('');
  const [locationFreeText, setLocationFreeText] = useState('');
  const [openedDropdown, setOpenedDropdown] = useState<string | null>(null);

  // Employee assignment
  const [employees, setEmployees] = useState<EmployeeItem[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedEmployeeLabel, setSelectedEmployeeLabel] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');

  // Event date
  const [eventDate, setEventDate] = useState(initialDate || '');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Other fields
  const [scope, setScope] = useState('');
  const [budget, setBudget] = useState('');
  const [expectations, setExpectations] = useState('');

  useEffect(() => {
    if (!visible) return;
    (async () => {
      const [orgsRes, contactsRes, locsRes, empsRes] = await Promise.all([
        supabase.from('organizations').select('id, name, alias').order('name').limit(200),
        supabase
          .from('contacts')
          .select('id, first_name, last_name, phone, email')
          .order('last_name')
          .limit(200),
        supabase.from('locations').select('id, name, address, city').order('name').limit(200),
        supabase
          .from('employees')
          .select('id, auth_user_id, name, surname, avatar_url')
          .order('name')
          .limit(100),
      ]);
      setOrganizations((orgsRes.data as OrganizationItem[]) || []);
      setContacts((contactsRes.data as ContactItem[]) || []);
      setLocations((locsRes.data as LocationItem[]) || []);
      setEmployees((empsRes.data as unknown as EmployeeItem[]) || []);
    })();
  }, [visible]);

  const resetForm = () => {
    setClientName('');
    setClientPhone('');
    setClientEmail('');
    setSelectedOrgId(null);
    setSelectedOrgLabel(null);
    setSelectedContactId(null);
    setSelectedContactLabel(null);
    setOrgSearch('');
    setContactSearch('');
    setSelectedLocationId(null);
    setSelectedLocationLabel(null);
    setLocationSearch('');
    setLocationFreeText('');
    setSelectedEmployeeId(null);
    setSelectedEmployeeLabel(null);
    setEmployeeSearch('');
    setEventDate(initialDate || '');
    setShowDatePicker(false);
    setScope('');
    setBudget('');
    setExpectations('');
  };

  const formatDateForDisplay = (dateStr: string) => {
    try {
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('pl-PL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const handleSave = async () => {
    if (
      !clientName.trim() &&
      !clientPhone.trim() &&
      !clientEmail.trim() &&
      !selectedOrgLabel &&
      !selectedContactLabel
    ) {
      Alert.alert(
        'Brak danych',
        'Podaj przynajmniej dane kontaktowe klienta lub wybierz organizację/kontakt.',
      );
      return;
    }

    setSaving(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        Alert.alert('Błąd', 'Brak aktywnej sesji. Zaloguj się ponownie.');
        setSaving(false);
        return;
      }

      const { data: minRow } = await supabase
        .from('tasks')
        .select('order_index')
        .order('order_index', { ascending: true })
        .limit(1)
        .maybeSingle();

      const newOrderIndex = (minRow?.order_index ?? 0) - 1;

      const clientLabel =
        selectedOrgLabel ||
        selectedContactLabel ||
        clientName.trim() ||
        clientPhone.trim() ||
        clientEmail.trim() ||
        'nieznany';
      const title = `Zapytanie: ${clientLabel}`;

      const locationText = selectedLocationLabel || locationFreeText.trim() || '';
      const selectedDate = eventDate.trim() || null;

      const descParts: string[] = [];
      if (selectedDate) descParts.push(`Termin: ${selectedDate}`);
      if (locationText) descParts.push(`Lokalizacja: ${locationText}`);
      if (scope.trim()) descParts.push(`Zakres: ${scope.trim()}`);
      if (budget.trim()) descParts.push(`Budżet: ${budget.trim()}`);
      if (expectations.trim()) descParts.push(`Oczekiwania: ${expectations.trim()}`);
      const contactBits = [clientName.trim(), clientPhone.trim(), clientEmail.trim()].filter(
        Boolean,
      );
      if (contactBits.length) descParts.push(`Kontakt: ${contactBits.join(' | ')}`);
      if (selectedOrgLabel) descParts.push(`Organizacja: ${selectedOrgLabel}`);
      if (selectedContactLabel) descParts.push(`Osoba kontaktowa: ${selectedContactLabel}`);
      if (selectedEmployeeLabel) descParts.push(`Przypisano: ${selectedEmployeeLabel}`);


      const inquiryDetails = {
        termin: selectedDate,
        location_text: locationText || null,
        location_id: selectedLocationId,
        scope: scope.trim() || null,
        budget: budget.trim() || null,
        expectations: expectations.trim() || null,
        client_text: clientName.trim() || null,
        client_organization_id: selectedOrgId,
        client_contact_id: selectedContactId,
        client_phone: clientPhone.trim() || null,
        client_email: clientEmail.trim() || null,
        assigned_employee_id: selectedEmployeeId,
      };

      const { data: insertedTask, error: insertError } = await supabase
        .from('tasks')
        .insert([
          {
            title,
            description: descParts.join('\n'),
            priority: 'urgent',
            status: 'todo',
            board_column: 'todo',
            order_index: newOrderIndex,
            due_date: selectedDate ? new Date(selectedDate + 'T23:59:00').toISOString() : null,
            created_by: session.user.id,
            is_inquiry: true,
            inquiry_details: inquiryDetails,
          },
        ])
        .select('id')
        .single();

      if (insertError) {
        Alert.alert('Błąd', 'Nie udało się zapisać zapytania: ' + insertError.message);
        setSaving(false);
        return;
      }

      // Assign employee if selected
      if (selectedEmployeeId && insertedTask?.id) {
        const emp = employees.find((e) => e.id === selectedEmployeeId);
        if (emp) {
          await supabase.from('task_assignees').insert({
            task_id: insertedTask.id,
            employee_id: emp.id,
          });
        }
      }

      setSaving(false);
      resetForm();
      onSaved?.();
      onClose();
      Alert.alert('Zapisano', 'Zapytanie zostało dodane do listy zadań z najwyższym priorytetem.');
      scheduleInquiryReminders();
    } catch (e: any) {
      Alert.alert('Błąd', e?.message || 'Nieznany błąd');
      setSaving(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
            <Feather name="x" size={24} color={colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Nowe zapytanie</Text>
          <TouchableOpacity onPress={handleSave} disabled={saving} style={styles.saveBtn}>
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary.gold} />
            ) : (
              <Text style={styles.saveBtnText}>Zapisz</Text>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.form}
          contentContainerStyle={styles.formContent}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => {
            setOpenedDropdown(null);
          }}
        >
          {/* Event date section */}
          <Text style={styles.sectionLabel}>Data wydarzenia</Text>
          {initialDate ? (
            <View style={styles.dateInfo}>
              <Feather name="calendar" size={16} color={colors.primary.gold} />
              <Text style={styles.dateInfoText}>{formatDateForDisplay(initialDate)}</Text>
            </View>
          ) : (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Termin wydarzenia</Text>
              <TouchableOpacity
                style={styles.datePickerButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Feather
                  name="calendar"
                  size={16}
                  color={eventDate ? colors.primary.gold : colors.text.tertiary}
                />
                <Text style={[styles.datePickerText, eventDate && { color: colors.text.primary }]}>
                  {eventDate ? formatDateForDisplay(eventDate) : 'Wybierz datę...'}
                </Text>
                {eventDate ? (
                  <TouchableOpacity
                    onPress={() => {
                      setEventDate('');
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Feather name="x" size={16} color={colors.text.tertiary} />
                  </TouchableOpacity>
                ) : (
                  <Feather name="chevron-down" size={16} color={colors.text.tertiary} />
                )}
              </TouchableOpacity>
              {showDatePicker &&
                (Platform.OS === 'ios' ? (
                  <View style={styles.iosPickerContainer}>
                    <DateTimePicker
                      value={eventDate ? new Date(eventDate + 'T00:00:00') : new Date()}
                      mode="date"
                      display="inline"
                      minimumDate={new Date()}
                      locale="pl-PL"
                      onChange={(_, selectedDate) => {
                        if (selectedDate) {
                          setEventDate(selectedDate.toISOString().split('T')[0]);
                        }
                      }}
                      themeVariant="dark"
                    />
                    <TouchableOpacity
                      style={styles.pickerDoneButton}
                      onPress={() => setShowDatePicker(false)}
                    >
                      <Text style={styles.pickerDoneText}>Gotowe</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <DateTimePicker
                    value={eventDate ? new Date(eventDate + 'T00:00:00') : new Date()}
                    mode="date"
                    display="default"
                    minimumDate={new Date()}
                    onChange={(_, selectedDate) => {
                      setShowDatePicker(false);
                      if (selectedDate) {
                        setEventDate(selectedDate.toISOString().split('T')[0]);
                      }
                    }}
                  />
                ))}
            </View>
          )}

          {/* Organization / Client */}
          <Text style={styles.sectionLabel}>Klient / Organizacja</Text>

          <SearchableDropdown
            dropdownId="organization"
            openedDropdown={openedDropdown}
            setOpenedDropdown={setOpenedDropdown}
            label="Organizacja"
            placeholder="Szukaj organizacji..."
            icon="briefcase"
            items={organizations}
            textValue={orgSearch}
            onTextChange={setOrgSearch}
            selectedLabel={selectedOrgLabel}
            onSelect={(org) => {
              setSelectedOrgId(org.id);
              setSelectedOrgLabel(org.alias || org.name);
              setOrgSearch('');
            }}
            onClear={() => {
              setSelectedOrgId(null);
              setSelectedOrgLabel(null);
            }}
            renderItem={(org) => (org.alias ? `${org.alias} (${org.name})` : org.name)}
            getFilterText={(org) => `${org.alias || ''} ${org.name}`}
          />

          <SearchableDropdown
            dropdownId="contact"
            openedDropdown={openedDropdown}
            setOpenedDropdown={setOpenedDropdown}
            label="Osoba kontaktowa"
            placeholder="Szukaj kontaktu..."
            icon="user"
            items={contacts}
            textValue={contactSearch}
            onTextChange={setContactSearch}
            selectedLabel={selectedContactLabel}
            onSelect={(contact) => {
              setSelectedContactId(contact.id);

              setSelectedContactLabel(
                `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
              );

              if (contact.phone) {
                setClientPhone(contact.phone);
              }

              if (contact.email) {
                setClientEmail(contact.email);
              }

              setContactSearch('');
            }}
            onClear={() => {
              setSelectedContactId(null);
              setSelectedContactLabel(null);
            }}
            renderItem={(contact) =>
              `${contact.first_name || ''} ${contact.last_name || ''}`.trim() +
              (contact.phone ? ` (${contact.phone})` : '')
            }
            getFilterText={(contact) =>
              `${contact.first_name || ''} ${contact.last_name || ''} ${
                contact.email || ''
              } ${contact.phone || ''}`
            }
          />

          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Dane kontaktowe</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Nazwa / imię</Text>
            <TextInput
              style={styles.input}
              value={clientName}
              onChangeText={setClientName}
              placeholder="Jeśli brak organizacji/kontaktu"
              placeholderTextColor={colors.text.tertiary}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Telefon</Text>
              <TextInput
                style={styles.input}
                value={clientPhone}
                onChangeText={setClientPhone}
                placeholder="+48 ..."
                placeholderTextColor={colors.text.tertiary}
                keyboardType="phone-pad"
              />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>E-mail</Text>
              <TextInput
                style={styles.input}
                value={clientEmail}
                onChangeText={setClientEmail}
                placeholder="email@..."
                placeholderTextColor={colors.text.tertiary}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Location */}
          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Lokalizacja</Text>

          <SearchableDropdown
            dropdownId="location"
            openedDropdown={openedDropdown}
            setOpenedDropdown={setOpenedDropdown}
            label="Wybierz z listy"
            placeholder="Szukaj lokalizacji..."
            icon="map-pin"
            items={locations}
            textValue={locationSearch}
            onTextChange={setLocationSearch}
            selectedLabel={selectedLocationLabel}
            onSelect={(location) => {
              setSelectedLocationId(location.id);

              setSelectedLocationLabel([location.name, location.city].filter(Boolean).join(', '));

              setLocationSearch('');
              setLocationFreeText('');
            }}
            onClear={() => {
              setSelectedLocationId(null);
              setSelectedLocationLabel(null);
            }}
            renderItem={(location) => [location.name, location.city].filter(Boolean).join(', ')}
            getFilterText={(location) =>
              `${location.name} ${location.address || ''} ${location.city || ''}`
            }
          />

          {!selectedLocationId && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Lub wpisz ręcznie</Text>
              <TextInput
                style={styles.input}
                value={locationFreeText}
                onChangeText={setLocationFreeText}
                placeholder="Miasto, adres, miejsce..."
                placeholderTextColor={colors.text.tertiary}
              />
            </View>
          )}

          {/* Employee assignment */}
          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Przypisz pracownika</Text>

          <SearchableDropdown
            dropdownId="employee"
            openedDropdown={openedDropdown}
            setOpenedDropdown={setOpenedDropdown}
            label="Pracownik odpowiedzialny"
            placeholder="Szukaj pracownika..."
            icon="user-check"
            items={employees}
            textValue={employeeSearch}
            onTextChange={setEmployeeSearch}
            selectedLabel={selectedEmployeeLabel}
            onSelect={(emp) => {
              setSelectedEmployeeId(emp.id);
              setSelectedEmployeeLabel(`${emp.name} ${emp.surname}`);
              setEmployeeSearch('');
            }}
            onClear={() => {
              setSelectedEmployeeId(null);
              setSelectedEmployeeLabel(null);
            }}
            renderItem={(emp) => `${emp.name} ${emp.surname}`}
            getFilterText={(emp) => `${emp.name} ${emp.surname}`}
          />

          {/* Details */}
          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Szczegóły zapytania</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Zakres usług</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={scope}
              onChangeText={setScope}
              placeholder="Np. nagłośnienie, DJ, kasyno..."
              placeholderTextColor={colors.text.tertiary}
              multiline
              numberOfLines={3}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Budżet</Text>
              <TextInput
                style={styles.input}
                value={budget}
                onChangeText={setBudget}
                placeholder="Np. 5000 PLN"
                placeholderTextColor={colors.text.tertiary}
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Oczekiwania / uwagi</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={expectations}
              onChangeText={setExpectations}
              placeholder="Dodatkowe informacje..."
              placeholderTextColor={colors.text.tertiary}
              multiline
              numberOfLines={3}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  closeBtn: {
    padding: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.text.primary,
  },
  saveBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primary.gold + '20',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
  },
  saveBtnText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary.gold,
  },
  form: {
    flex: 1,
  },
  formContent: {
    padding: spacing.md,
    paddingBottom: 100,
  },
  dateInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary.gold + '15',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.lg,
  },
  dateInfoText: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary.gold,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  datePickerText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    textTransform: 'capitalize',
  },
  iosPickerContainer: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    marginTop: 8,
    overflow: 'hidden',
  },
  pickerDoneButton: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
  },
  pickerDoneText: {
    fontSize: typography.fontSizes.sm,
    color: colors.primary.gold,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  input: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary.gold + '10',
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
