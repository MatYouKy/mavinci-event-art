import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { colors, borderRadius, spacing } from '../../../theme';

/*
 * Okno z notatką / powodem do czynności checklisty sprzętu (potwierdzenie etapu, prośba, zgoda, odmowa, cofnięcie).
 * Walidacja jak w bazie (`validate`); komunikat błędu bazy pokazuje wywołujący (alert).
 */

export type EquipmentNoteRequest = {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  /** Ile znaków najwyżej przyjmuje baza. */
  maxLength: number;
  /** Komunikat walidacji (jak w bazie) albo null. */
  validate?: (note: string) => string | null;
  /** Gwiazdka przy etykiecie (notatka wymagana). */
  required?: boolean;
  confirmLabel: string;
  tone?: 'primary' | 'success' | 'danger';
  onSubmit: (note: string) => Promise<boolean>;
};

export function EquipmentNoteModal({ request, onClose }: { request: EquipmentNoteRequest | null; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNote('');
    setError(null);
    setBusy(false);
  }, [request]);

  const submit = async () => {
    if (!request || busy) return;
    const problem = request.validate?.(note) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const done = await request.onSubmit(note.trim());
      if (done) onClose();
    } finally {
      setBusy(false);
    }
  };

  const toneColor =
    request?.tone === 'success' ? '#059669' : request?.tone === 'danger' ? colors.status.error : colors.primary.gold;
  const toneText = request?.tone === 'success' || request?.tone === 'danger' ? colors.white : colors.background.primary;

  return (
    <Modal visible={!!request} transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.overlay} onPress={() => !busy && onClose()}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title}>{request?.title}</Text>
            {!!request?.description && <Text style={styles.description}>{request.description}</Text>}
            <Text style={styles.label}>
              {request?.label}
              {request?.required ? <Text style={styles.required}> *</Text> : null}
            </Text>
            <TextInput
              value={note}
              onChangeText={(value) => {
                setNote(value);
                if (error) setError(null);
              }}
              placeholder={request?.placeholder}
              placeholderTextColor={colors.text.tertiary}
              multiline
              maxLength={request?.maxLength}
              editable={!busy}
              style={styles.input}
              accessibilityLabel={request?.label}
            />
            {!!error && (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            )}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={busy} accessibilityRole="button">
                <Text style={styles.cancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirm, { backgroundColor: toneColor }, busy && styles.disabled]}
                onPress={() => void submit()}
                disabled={busy}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator size="small" color={toneText} />
                ) : (
                  <Text style={[styles.confirmText, { color: toneText }]}>{request?.confirmLabel}</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background.elevated,
    borderRadius: 14,
    padding: 20,
  },
  title: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    color: colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  description: { color: colors.text.secondary, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  label: { color: colors.text.secondary, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  required: { color: '#f87171' },
  input: {
    minHeight: 96,
    maxHeight: 220,
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
    color: colors.text.primary,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  error: { color: '#ff9999', fontSize: 13, lineHeight: 18, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  cancel: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: 'center',
    backgroundColor: colors.background.tertiary,
  },
  cancelText: { color: colors.text.secondary, fontSize: 14, fontWeight: '600' },
  confirm: { minHeight: 48, minWidth: 120, paddingHorizontal: 18, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  confirmText: { fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
