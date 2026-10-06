import { useIsFocused } from '@react-navigation/native';
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useForegroundEffect } from '../../hooks/useForegroundEffect';
import { colors } from '../../theme';
import { OPERATIONAL_LABELS } from '../../lib/operationalStages';
export default function RealizationActions({
  eventId,
  onChanged,
}: {
  eventId: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [open, setOpen] = useState(false),
    [notes, setNotes] = useState('Wszystko OK.'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const revision = useRef(0);
  const focused = useIsFocused();
  useForegroundEffect(
    (signal) => {
      if (!focused || open) return;
      const load = async () => {
        if (lock.current) return;
        const version = revision.current;
        const r = await supabase.rpc('get_event_realization_assignment', { p_event_id: eventId });
        if (signal.aborted || version !== revision.current || lock.current) return;
        if (r.error) setError('Nie udało się odczytać stanu realizacji.');
        else {
          setData(r.data);
          setError('');
        }
      };
      void load();
      const timer = setInterval(() => void load(), 30000);
      return () => clearInterval(timer);
    },
    [eventId, focused, open],
  );
  const run = async (action: 'start' | 'complete') => {
    if (lock.current || (action === 'complete' && !notes.trim())) return;
    revision.current += 1;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const r = await supabase.rpc('advance_realization', {
        p_event_id: eventId,
        p_action: action,
        p_notes: action === 'complete' ? notes.trim() : null,
      });
      if (r.error) throw r.error;
      setData((previous: any) => ({
        ...previous,
        realization: r.data,
        status: action === 'start' ? 'in_progress' : 'completed',
      }));
      setOpen(false);
      onChanged?.();
    } catch (e: any) {
      setError(e.message || 'Nie udało się zapisać realizacji. Spróbuj ponownie.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const button = (label: string, action: () => void, disabled = false) => (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={action}
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 8,
        backgroundColor: colors.primary.gold,
        opacity: busy || disabled ? 0.5 : 1,
      }}
    >
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Text style={{ color: colors.background.primary }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
  if (!data?.is_manager)
    return error ? (
      <Text accessibilityRole="alert" style={{ color: '#ff9999', padding: 16 }}>
        {error}
      </Text>
    ) : null;
  return (
    <View
      style={{
        padding: 16,
        backgroundColor: colors.background.secondary,
        borderRadius: 12,
        marginBottom: 12,
      }}
    >
      <Text style={{ color: colors.primary.gold, fontWeight: '600' }}>
        Kierownik realizacji · {OPERATIONAL_LABELS[data.status]}
      </Text>
      {!data.realization?.started_at &&
        data.status === 'ready_for_live' &&
        button('Przejmij realizację', () => void run('start'))}
      {!!data.realization?.started_at &&
        !data.realization?.completed_at &&
        data.status !== 'cancelled' &&
        button('Zrealizowane', () => {
          setNotes('Wszystko OK.');
          setError('');
          setOpen(true);
        })}
      {!!data.realization?.completed_at && (
        <Text style={{ color: colors.text.primary, marginTop: 8 }}>
          Podsumowanie: {data.realization.completion_notes || 'Brak notatki'}
        </Text>
      )}
      {!!error && !open && (
        <Text accessibilityRole="alert" style={{ color: '#ff9999', marginTop: 8 }}>
          {error}
        </Text>
      )}
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{
              maxHeight: '90%',
              backgroundColor: colors.background.secondary,
              borderRadius: 16,
            }}
            contentContainerStyle={{ padding: 20 }}
          >
            <Text accessibilityRole="header" style={{ fontSize: 20, color: colors.text.primary }}>
              Podsumowanie realizacji
            </Text>
            <Text style={{ color: colors.text.secondary, marginVertical: 12 }}>
              Zostaw „Wszystko OK.” albo wpisz uwagi dotyczące wydarzenia.
            </Text>
            <TextInput
              accessibilityLabel="Notatka z realizacji"
              autoFocus
              multiline
              editable={!busy}
              maxLength={5000}
              value={notes}
              onChangeText={setNotes}
              style={{
                minHeight: 140,
                padding: 12,
                borderRadius: 8,
                textAlignVertical: 'top',
                backgroundColor: colors.background.primary,
                color: colors.text.primary,
              }}
            />
            <Text style={{ color: colors.text.secondary, textAlign: 'right' }}>
              {notes.length}/5000
            </Text>
            {!!error && (
              <Text accessibilityRole="alert" style={{ color: '#ff9999', marginTop: 10 }}>
                {error}
              </Text>
            )}
            {button('Zapisz i oznacz jako zrealizowane', () => void run('complete'), !notes.trim())}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setOpen(false)}
              style={{ padding: 14 }}
            >
              <Text style={{ color: colors.text.secondary, textAlign: 'center' }}>Anuluj</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
