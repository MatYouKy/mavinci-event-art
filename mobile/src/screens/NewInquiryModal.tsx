import React, { useState } from 'react';
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
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { scheduleInquiryReminders } from '../services/inquiryReminders';

interface NewInquiryModalProps {
  visible: boolean;
  onClose: () => void;
  initialDate?: string;
  onSaved?: () => void;
}

export default function NewInquiryModal({ visible, onClose, initialDate, onSaved }: NewInquiryModalProps) {
  const { employee } = useAuth();
  const [saving, setSaving] = useState(false);

  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [location, setLocation] = useState('');
  const [scope, setScope] = useState('');
  const [budget, setBudget] = useState('');
  const [expectations, setExpectations] = useState('');

  const resetForm = () => {
    setClientName('');
    setClientPhone('');
    setClientEmail('');
    setLocation('');
    setScope('');
    setBudget('');
    setExpectations('');
  };

  const handleSave = async () => {
    if (!clientName.trim() && !clientPhone.trim() && !clientEmail.trim()) {
      Alert.alert('Brak danych', 'Podaj przynajmniej dane kontaktowe klienta (nazwa, telefon lub e-mail).');
      return;
    }

    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
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

      const clientLabel = clientName.trim() || clientPhone.trim() || clientEmail.trim() || 'nieznany';
      const title = `Zapytanie: ${clientLabel}`;

      const descParts: string[] = [];
      if (initialDate) descParts.push(`Termin: ${initialDate}`);
      if (location.trim()) descParts.push(`Lokalizacja: ${location.trim()}`);
      if (scope.trim()) descParts.push(`Zakres: ${scope.trim()}`);
      if (budget.trim()) descParts.push(`Budżet: ${budget.trim()}`);
      if (expectations.trim()) descParts.push(`Oczekiwania: ${expectations.trim()}`);
      const contactBits = [clientName.trim(), clientPhone.trim(), clientEmail.trim()].filter(Boolean);
      if (contactBits.length) descParts.push(`Kontakt: ${contactBits.join(' | ')}`);

      const inquiryDetails = {
        termin: initialDate || null,
        location_text: location.trim() || null,
        location_id: null,
        scope: scope.trim() || null,
        budget: budget.trim() || null,
        expectations: expectations.trim() || null,
        client_text: clientName.trim() || null,
        client_organization_id: null,
        client_contact_id: null,
        client_phone: clientPhone.trim() || null,
        client_email: clientEmail.trim() || null,
      };

      const { error: insertError } = await supabase.from('tasks').insert([
        {
          title,
          description: descParts.join('\n'),
          priority: 'urgent',
          status: 'todo',
          board_column: 'todo',
          order_index: newOrderIndex,
          due_date: initialDate ? new Date(initialDate + 'T23:59:00').toISOString() : null,
          created_by: session.user.id,
          is_inquiry: true,
          inquiry_details: inquiryDetails,
        },
      ]);

      if (insertError) {
        Alert.alert('Błąd', 'Nie udało się zapisać zapytania: ' + insertError.message);
        setSaving(false);
        return;
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

        <ScrollView style={styles.form} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          {initialDate && (
            <View style={styles.dateInfo}>
              <Feather name="calendar" size={16} color={colors.primary.gold} />
              <Text style={styles.dateInfoText}>
                Termin: {new Date(initialDate + 'T00:00:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>Dane kontaktowe klienta</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Nazwa / Firma *</Text>
            <TextInput
              style={styles.input}
              value={clientName}
              onChangeText={setClientName}
              placeholder="Nazwa firmy lub imię klienta"
              placeholderTextColor={colors.text.tertiary}
            />
          </View>

          <View style={styles.inputGroup}>
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

          <View style={styles.inputGroup}>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              value={clientEmail}
              onChangeText={setClientEmail}
              placeholder="email@firma.pl"
              placeholderTextColor={colors.text.tertiary}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Szczegóły zapytania</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Lokalizacja</Text>
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLocation}
              placeholder="Miasto, miejsce eventu"
              placeholderTextColor={colors.text.tertiary}
            />
          </View>

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

          <View style={styles.inputGroup}>
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
    paddingBottom: spacing.xxl,
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
  sectionLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
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
});
