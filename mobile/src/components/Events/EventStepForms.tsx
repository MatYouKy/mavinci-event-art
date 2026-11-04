import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import {
  EVENT_STEP_DEFAULT_HOUR,
  EVENT_STEP_KIND_LABELS,
  EVENT_STEP_ROLE_LABELS,
  EventStep,
  EventStepAction,
  MANUAL_EVENT_STEP_KINDS,
  MANUAL_EVENT_STEP_ROLES,
  ManualEventStepKind,
  ManualEventStepRole,
  eventStepActionLabel,
  eventStepNeedsOrderFields,
  eventStepNoteRule,
} from '../../lib/eventSteps';

/*
 * Formularze kroków realizacji: notatka do czynności (z polami zamówienia) i „Dodaj krok”.
 * Pola dat jak w całej aplikacji: wybór z kalendarza albo ręczne wpisanie DD.MM.RRRR (z walidacją rzeczywistej daty).
 */

const NOTE_MAX = 2000;
const DETAILS_MAX = 2000;
const SUPPLIER_MAX = 300;
const TITLE_MAX = 200;
// Kroki „wymagane przed gotowością magazynu” baza przyjmuje tylko dla tych ról.
const BLOCKS_READY_ROLES: ManualEventStepRole[] = ['warehouse', 'sales', 'manager'];
// Godzina przyjmowana, gdy wpisano sam dzień — wspólna z CRM (`EVENT_STEP_DEFAULT_HOUR`).
const DEFAULT_HOUR = EVENT_STEP_DEFAULT_HOUR;

/** Data z pola (z godziną albo domyślnie 10:00) jako ISO; null przy błędnej dacie. */
function stepInputToIso(value: string): string | null {
  const parsed = parseStepDateInput(value);
  if (!parsed) return null;
  const date = new Date(parsed.date);
  if (!parsed.hasTime) date.setHours(DEFAULT_HOUR, 0, 0, 0);
  return date.toISOString();
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatStepDateInput(date: Date, withTime: boolean): string {
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

/** „DD.MM.RRRR” albo „DD.MM.RRRR GG:MM” → data lokalna; null, gdy data nie istnieje (np. 31.02). */
export function parseStepDateInput(value: string): { date: Date; hasTime: boolean } | null {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hasTime = match[4] !== undefined;
  const hour = hasTime ? Number(match[4]) : 0;
  const minute = hasTime ? Number(match[5]) : 0;
  if (year < 2000 || year > 2100 || hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date, hasTime };
}

function minLengthMessage(label: string, minLength: number): string {
  if (minLength <= 1) return `Uzupełnij pole „${label}”.`;
  return `${label}: wpisz co najmniej ${minLength} znaków.`;
}

/** Pole daty: ręczny wpis DD.MM.RRRR (opcjonalnie GG:MM) + wybór z kalendarza / zegara. */
export function StepDateField({
  label,
  value,
  onChange,
  withTime = false,
  disabled = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  // Stała wartość kalendarza na czas otwarcia (Android odświeża okno przy każdej zmianie `value`).
  const [pickerValue, setPickerValue] = useState<Date>(() => new Date());
  const parsed = parseStepDateInput(value);

  const togglePicker = (mode: 'date' | 'time') => {
    if (picker === mode) {
      setPicker(null);
      return;
    }
    setPickerValue(parsed?.date ?? new Date());
    setPicker(mode);
  };

  const apply = (mode: 'date' | 'time', selected: Date) => {
    const next = new Date(parsed?.date ?? pickerValue);
    if (mode === 'date') {
      next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      onChange(formatStepDateInput(next, withTime && Boolean(parsed?.hasTime)));
    } else {
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      onChange(formatStepDateInput(next, true));
    }
    setPickerValue(next);
  };

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    const mode = picker;
    if (Platform.OS !== 'ios') setPicker(null);
    if (!mode || event.type !== 'set' || !selected) return;
    apply(mode, selected);
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.dateRow}>
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          editable={!disabled}
          placeholder={withTime ? 'DD.MM.RRRR GG:MM' : 'DD.MM.RRRR'}
          placeholderTextColor={colors.text.tertiary}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          maxLength={withTime ? 16 : 10}
          style={[styles.input, styles.dateInput]}
        />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${label}: wybierz z kalendarza`}
          disabled={disabled}
          onPress={() => togglePicker('date')}
          style={styles.iconBtn}
        >
          <Feather name="calendar" size={18} color={colors.primary.gold} />
        </TouchableOpacity>
        {withTime && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${label}: wybierz godzinę`}
            disabled={disabled}
            onPress={() => togglePicker('time')}
            style={styles.iconBtn}
          >
            <Feather name="clock" size={18} color={colors.primary.gold} />
          </TouchableOpacity>
        )}
      </View>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      {picker && (
        <View>
          <DateTimePicker
            value={pickerValue}
            mode={picker}
            is24Hour
            locale="pl-PL"
            themeVariant="dark"
            display={Platform.OS === 'ios' ? (picker === 'date' ? 'inline' : 'spinner') : 'default'}
            onChange={onPickerChange}
          />
          {Platform.OS === 'ios' && (
            <TouchableOpacity accessibilityRole="button" onPress={() => setPicker(null)} style={styles.pickerDone}>
              <Text style={styles.link}>Gotowe</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function ModalShell({
  visible,
  busy,
  onCancel,
  children,
}: {
  visible: boolean;
  busy: boolean;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onCancel();
      }}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          style={styles.sheet}
          contentContainerStyle={styles.sheetContent}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SubmitButtons({
  label,
  busy,
  onSubmit,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={busy}
        onPress={onSubmit}
        style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.background.primary} />
        ) : (
          <Text style={styles.primaryBtnText}>{label}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>Anuluj</Text>
      </TouchableOpacity>
    </>
  );
}

export type EventStepActionRequest = { step: EventStep; action: EventStepAction };

/** Okno czynności kroku: notatka (wymagana według eventStepNoteRule) i — przy zamówieniu — dostawca oraz data dostawy. */
export function EventStepActionModal({
  request,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  request: EventStepActionRequest | null;
  busy: boolean;
  error: string;
  onSubmit: (note: string, payload: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  const [supplier, setSupplier] = useState('');
  const [expected, setExpected] = useState('');
  const [formError, setFormError] = useState('');
  const step = request?.step ?? null;
  const action = request?.action ?? null;

  useEffect(() => {
    if (!step || !action) return;
    setNote('');
    setFormError('');
    setSupplier(step.supplier ?? '');
    const current = step.expected_at ? new Date(step.expected_at) : null;
    setExpected(current && !Number.isNaN(current.getTime()) ? formatStepDateInput(current, true) : '');
    // Formularz zerujemy przy każdym otwarciu (nowe żądanie), nie przy odświeżeniu danych kroków.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!step || !action) return null;
  const rule = eventStepNoteRule(step, action);
  const orderFields = eventStepNeedsOrderFields(step, action);
  const actionLabel = eventStepActionLabel(step, action);

  const submit = () => {
    const trimmed = note.trim();
    if (rule) {
      // Długość sprawdzamy tylko przy notatce wymaganej (jak w CRM); opcjonalne notatki ocenia baza.
      const minimum = Math.max(1, rule.minLength);
      if (rule.required && trimmed.length < minimum) {
        setFormError(minLengthMessage(rule.label, minimum));
        return;
      }
    }
    const payload: Record<string, string> = {};
    if (orderFields) {
      if (supplier.trim()) payload.supplier = supplier.trim();
      if (expected.trim()) {
        const iso = stepInputToIso(expected);
        if (!iso) {
          setFormError('Podaj datę dostawy w formacie DD.MM.RRRR albo DD.MM.RRRR GG:MM (np. 12.11.2026 10:00).');
          return;
        }
        payload.expected_at = iso;
      }
    }
    setFormError('');
    onSubmit(trimmed, payload);
  };

  return (
    <ModalShell visible busy={busy} onCancel={onCancel}>
      <Text accessibilityRole="header" style={styles.title}>
        {actionLabel}
      </Text>
      <Text style={styles.subtitle}>{step.title}</Text>
      {action === 'problem' && (
        <Text style={styles.info}>Kierownik realizacji i prowadzący wydarzenie dostaną powiadomienie.</Text>
      )}
      {action === 'skip' && <Text style={styles.info}>Powód będzie widoczny w historii kroku.</Text>}
      {action === 'done' && step.key === 'dispatch_out' && (
        <Text style={styles.info}>
          Wydanie zablokuje listę załadunku. Jeśli nie wszystkie pozycje są odhaczone, opisz rozbieżność.
        </Text>
      )}

      {orderFields && (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>Dostawca</Text>
            <TextInput
              accessibilityLabel="Dostawca"
              value={supplier}
              onChangeText={setSupplier}
              editable={!busy}
              maxLength={SUPPLIER_MAX}
              placeholder="Nazwa dostawcy"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
            />
          </View>
          <StepDateField
            label="Data dostawy"
            value={expected}
            onChange={setExpected}
            withTime
            disabled={busy}
            hint="Bez godziny przyjmujemy 10:00."
          />
        </>
      )}

      {rule && (
        <View style={styles.field}>
          <Text style={styles.label}>
            {rule.label}
            {rule.required ? ' *' : ''}
          </Text>
          <TextInput
            accessibilityLabel={rule.label}
            autoFocus={!orderFields}
            multiline
            editable={!busy}
            maxLength={NOTE_MAX}
            value={note}
            onChangeText={setNote}
            placeholder={rule.placeholder}
            placeholderTextColor={colors.text.tertiary}
            style={[styles.input, styles.multiline]}
          />
          <Text style={styles.counter}>
            {note.length}/{NOTE_MAX}
          </Text>
        </View>
      )}

      {!!(formError || error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {formError || error}
        </Text>
      )}
      <SubmitButtons label={actionLabel} busy={busy} onSubmit={submit} onCancel={onCancel} />
    </ModalShell>
  );
}

export type NewEventStepInput = {
  title: string;
  kind: ManualEventStepKind;
  ownerRole: ManualEventStepRole;
  dueAt: string;
  details: string | null;
  blocksReady: boolean;
};

/** „Dodaj krok” — ręczny krok z właścicielem i terminem (RPC add_event_step). */
export function AddEventStepModal({
  visible,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  busy: boolean;
  error: string;
  onSubmit: (input: NewEventStepInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ManualEventStepKind>('task');
  const [ownerRole, setOwnerRole] = useState<ManualEventStepRole>('warehouse');
  const [due, setDue] = useState('');
  const [details, setDetails] = useState('');
  const [blocksReady, setBlocksReady] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setKind('task');
    setOwnerRole('warehouse');
    setDue('');
    setDetails('');
    setBlocksReady(false);
    setFormError('');
  }, [visible]);

  if (!visible) return null;
  const blocksReadyAllowed = BLOCKS_READY_ROLES.includes(ownerRole);

  const submit = () => {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3 || trimmedTitle.length > TITLE_MAX) {
      setFormError('Podaj nazwę kroku (3–200 znaków).');
      return;
    }
    if (!due.trim()) {
      setFormError('Podaj termin kroku — właściciel dostanie przypomnienie.');
      return;
    }
    const dueAt = stepInputToIso(due);
    if (!dueAt) {
      setFormError('Podaj termin w formacie DD.MM.RRRR albo DD.MM.RRRR GG:MM (np. 12.11.2026 10:00).');
      return;
    }
    if (new Date(dueAt).getTime() < Date.now() - 60_000) {
      setFormError('Termin nie może być w przeszłości.');
      return;
    }
    setFormError('');
    onSubmit({
      title: trimmedTitle,
      kind,
      ownerRole,
      dueAt,
      details: details.trim() || null,
      blocksReady: blocksReadyAllowed && blocksReady,
    });
  };

  return (
    <ModalShell visible busy={busy} onCancel={onCancel}>
      <Text accessibilityRole="header" style={styles.title}>
        Dodaj krok
      </Text>
      <Text style={styles.info}>Właściciel kroku dostanie przypomnienie przed terminem.</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Nazwa kroku *</Text>
        <TextInput
          accessibilityLabel="Nazwa kroku"
          value={title}
          onChangeText={setTitle}
          editable={!busy}
          maxLength={TITLE_MAX}
          placeholder="np. Potwierdź godzinę wjazdu z obiektem"
          placeholderTextColor={colors.text.tertiary}
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Rodzaj</Text>
        <View style={styles.chips}>
          {MANUAL_EVENT_STEP_KINDS.map((value) => (
            <Chip
              key={value}
              label={EVENT_STEP_KIND_LABELS[value]}
              active={kind === value}
              disabled={busy}
              onPress={() => setKind(value)}
            />
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Kto odpowiada</Text>
        <View style={styles.chips}>
          {MANUAL_EVENT_STEP_ROLES.map((value) => (
            <Chip
              key={value}
              label={EVENT_STEP_ROLE_LABELS[value]}
              active={ownerRole === value}
              disabled={busy}
              onPress={() => setOwnerRole(value)}
            />
          ))}
        </View>
      </View>

      <StepDateField
        label="Termin *"
        value={due}
        onChange={setDue}
        withTime
        disabled={busy}
        hint="Bez godziny przyjmujemy 10:00."
      />

      <View style={styles.field}>
        <Text style={styles.label}>Opis (opcjonalnie)</Text>
        <TextInput
          accessibilityLabel="Opis kroku"
          multiline
          value={details}
          onChangeText={setDetails}
          editable={!busy}
          maxLength={DETAILS_MAX}
          placeholder="Co dokładnie trzeba zrobić, kontakt, ilości"
          placeholderTextColor={colors.text.tertiary}
          style={[styles.input, styles.multiline]}
        />
      </View>

      <View style={[styles.switchRow, !blocksReadyAllowed && { opacity: 0.5 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Wymagane przed gotowością magazynu</Text>
          <Text style={styles.hint}>
            {blocksReadyAllowed
              ? 'Magazyn nie oznaczy „Gotowe do wydania”, dopóki krok nie zostanie zamknięty.'
              : 'Dotyczy kroków magazynu, sprzedawcy i kierownika realizacji.'}
          </Text>
        </View>
        <Switch
          accessibilityLabel="Wymagane przed gotowością magazynu"
          value={blocksReadyAllowed && blocksReady}
          disabled={busy || !blocksReadyAllowed}
          onValueChange={setBlocksReady}
          trackColor={{ false: colors.background.tertiary, true: `${colors.primary.gold}55` }}
          thumbColor={blocksReadyAllowed && blocksReady ? colors.primary.gold : colors.text.tertiary}
        />
      </View>

      {!!(formError || error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {formError || error}
        </Text>
      )}
      <SubmitButtons label="Dodaj krok" busy={busy} onSubmit={submit} onCancel={onCancel} />
    </ModalShell>
  );
}

function Chip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.md },
  sheet: { maxHeight: '92%', backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl },
  sheetContent: { padding: 20 },
  title: { fontSize: typography.fontSizes.xl, color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  subtitle: { color: colors.text.secondary, marginTop: 4 },
  info: { color: colors.text.secondary, marginTop: spacing.sm, lineHeight: 20 },
  field: { marginTop: spacing.md },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, marginBottom: 6 },
  input: {
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.primary,
    color: colors.text.primary,
    fontSize: typography.fontSizes.md,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  counter: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textAlign: 'right', marginTop: 4 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dateInput: { flex: 1 },
  iconBtn: { padding: 12, borderRadius: borderRadius.md, backgroundColor: colors.background.primary },
  hint: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, marginTop: 4, lineHeight: 16 },
  pickerDone: { alignSelf: 'flex-end', paddingVertical: 8 },
  link: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.primary,
  },
  chipActive: { backgroundColor: 'rgba(211, 187, 115, 0.2)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  chipTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  switchLabel: { color: colors.text.primary },
  error: { color: '#ff9999', marginTop: spacing.md },
  primaryBtn: {
    marginTop: spacing.md,
    padding: 14,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary.gold,
    alignItems: 'center',
  },
  primaryBtnText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
  cancelBtn: { padding: 14, alignItems: 'center' },
  cancelText: { color: colors.text.secondary },
});
