import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase } from '../lib/supabase';
import type { PendingCrmCall } from '../hooks/useCrmCall';

type Outcome = 'connected' | 'no_answer' | 'busy' | 'voicemail' | 'wrong_number';

const OUTCOMES: Array<{ id: Outcome; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { id: 'connected', label: 'Rozmowa odbyta', icon: 'check-circle' },
  { id: 'no_answer', label: 'Brak odpowiedzi', icon: 'phone-missed' },
  { id: 'busy', label: 'Zajęte', icon: 'clock' },
  { id: 'voicemail', label: 'Poczta głosowa', icon: 'voicemail' },
  { id: 'wrong_number', label: 'Błędny numer', icon: 'x-circle' },
];

const FOLLOW_UPS = [
  { label: 'Bez terminu', minutes: null },
  { label: 'Za godzinę', minutes: 60 },
  { label: 'Jutro', minutes: 24 * 60 },
  { label: 'Za 3 dni', minutes: 3 * 24 * 60 },
] as const;

export default function CallOutcomeModal({ call, visible, onClose, onSaved }: {
  call: PendingCrmCall | null;
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>('connected');
  const [notes, setNotes] = useState('');
  const [followUpMinutes, setFollowUpMinutes] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!call || saving) return;
    setSaving(true);
    const nextActionAt = followUpMinutes === null
      ? null
      : new Date(Date.now() + followUpMinutes * 60_000).toISOString();
    const { error } = await supabase.rpc('finish_crm_call_activity', {
      p_activity_id: call.activityId,
      p_outcome: outcome,
      p_notes: notes.trim() || null,
      p_next_action_at: nextActionAt,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Nie udało się zapisać wyniku', error.message);
      return;
    }
    setNotes('');
    setOutcome('connected');
    setFollowUpMinutes(null);
    onSaved?.();
    onClose();
  };

  return (
    <Modal visible={visible && Boolean(call)} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}><Text style={styles.title}>Jak zakończyło się połączenie?</Text><Text style={styles.subtitle}>{call?.displayName} · {call?.phoneNumber}</Text></View>
            <TouchableOpacity onPress={onClose} style={styles.close}><Feather name="x" size={20} color={colors.text.secondary} /></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.outcomes}>{OUTCOMES.map((item) => <TouchableOpacity key={item.id} onPress={() => setOutcome(item.id)} style={[styles.outcome, outcome === item.id && styles.outcomeActive]}><Feather name={item.icon} size={18} color={outcome === item.id ? colors.background.primary : colors.primary.gold} /><Text style={[styles.outcomeText, outcome === item.id && styles.outcomeTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
            <Text style={styles.label}>Notatka z rozmowy</Text>
            <TextInput value={notes} onChangeText={setNotes} multiline placeholder="Najważniejsze ustalenia…" placeholderTextColor={colors.text.tertiary} style={styles.notes} />
            <Text style={styles.label}>Następne działanie</Text>
            <View style={styles.followUps}>{FOLLOW_UPS.map((item) => <TouchableOpacity key={item.label} onPress={() => setFollowUpMinutes(item.minutes)} style={[styles.followUp, followUpMinutes === item.minutes && styles.followUpActive]}><Text style={[styles.followUpText, followUpMinutes === item.minutes && styles.followUpTextActive]}>{item.label}</Text></TouchableOpacity>)}</View>
            <TouchableOpacity onPress={() => void save()} disabled={saving} style={[styles.save, saving && { opacity: 0.6 }]}>{saving ? <ActivityIndicator color={colors.background.primary} /> : <><Feather name="save" size={18} color={colors.background.primary} /><Text style={styles.saveText}>Zapisz wynik</Text></>}</TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: { maxHeight: '88%', backgroundColor: colors.background.secondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border.default },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold },
  subtitle: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, marginTop: 4 },
  close: { padding: spacing.sm },
  content: { padding: spacing.lg, gap: spacing.md },
  outcomes: { gap: spacing.sm },
  outcome: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.background.primary },
  outcomeActive: { backgroundColor: colors.primary.gold, borderColor: colors.primary.gold },
  outcomeText: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  outcomeTextActive: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
  label: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, marginTop: spacing.xs },
  notes: { minHeight: 100, textAlignVertical: 'top', color: colors.text.primary, backgroundColor: colors.background.primary, borderWidth: 1, borderColor: colors.border.default, borderRadius: borderRadius.md, padding: spacing.md },
  followUps: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  followUp: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.border.default },
  followUpActive: { borderColor: colors.primary.gold, backgroundColor: colors.primary.gold + '20' },
  followUpText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  followUpTextActive: { color: colors.primary.gold },
  save: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary.gold, borderRadius: borderRadius.md, marginTop: spacing.sm },
  saveText: { color: colors.background.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.bold },
});
