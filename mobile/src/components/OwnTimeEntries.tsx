import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ScrollView, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';

type Entry = { id: string; title: string | null; description: string | null; start_time: string; end_time: string; duration_minutes: number | null; updated_at: string };
const dateText = (value: string) => {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const parseDate = (value: string) => {
  const m = value.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, day, month, year, hour, minute] = m.map(Number);
  const d = new Date(year, month - 1, day, hour, minute);
  return dateText(d.toISOString()) === value ? d : null;
};
const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

export default function OwnTimeEntries({ employeeId, refreshKey, onSaved }: { employeeId: string; refreshKey: boolean; onSaved: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [limit, setLimit] = useState(50);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Entry | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [picker, setPicker] = useState<{ field: 'start' | 'end'; mode: 'date' | 'time' } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: queryError } = await supabase.from('time_entries')
        .select('id,title,description,start_time,end_time,duration_minutes,updated_at')
        .eq('employee_id', employeeId).not('end_time', 'is', null)
        .order('start_time', { ascending: false }).order('id').limit(limit + 1);
      if (queryError) throw queryError;
      setEntries((data || []).slice(0, limit));
      setMore((data || []).length > limit);
    } catch { setError('Nie udało się pobrać wpisów. Spróbuj ponownie.'); }
    finally { setLoading(false); }
  }, [employeeId, limit]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const save = async () => {
    const from = parseDate(start), to = parseDate(end);
    if (!editing || saving) return;
    if (!title.trim() || !from || !to || to <= from || to > new Date()) {
      setSaveError('Podaj tytuł i poprawny okres zakończonej pracy (DD.MM.RRRR GG:MM). Koniec musi być po początku i nie może być w przyszłości.');
      return;
    }
    setSaving(true); setSaveError('');
    try {
      const { data, error: writeError } = await supabase.from('time_entries')
        .update({ title: title.trim(), description: description.trim() || null, start_time: from.toISOString(), end_time: to.toISOString() })
        .eq('id', editing.id).eq('employee_id', employeeId).eq('updated_at', editing.updated_at).select('id');
      if (writeError) throw writeError;
      if (!data?.length) throw new Error('Wpis zmienił się lub nie jest już dostępny. Zamknij edycję i odśwież listę.');
      setEditing(null); await load(); onSaved();
    } catch (e: any) { setSaveError(e.message || 'Nie udało się zapisać zmian.'); }
    finally { setSaving(false); }
  };
  const days = entries.reduce<Record<string, Entry[]>>((result, entry) => {
    const key = dateText(entry.start_time).slice(0, 10);
    (result[key] ||= []).push(entry); return result;
  }, {});
  return <View style={styles.section}>
    <Text style={styles.heading}>Moje wpisy</Text>
    <TouchableOpacity onPress={() => void load()} disabled={loading}><Text style={styles.action}>Odśwież listę</Text></TouchableOpacity>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {Object.entries(days).map(([day, items]) => <View key={day} style={styles.day}>
      <Text style={styles.heading}>{day} · {duration(items.reduce((sum, e) => sum + (e.duration_minutes || 0), 0))}</Text>
      {items.map(entry => <View key={entry.id} style={styles.entry}>
        <Text style={styles.text}>{entry.title || 'Praca'}</Text>
        {!!entry.description && <Text style={styles.muted}>{entry.description}</Text>}
        <Text style={styles.muted}>{dateText(entry.start_time)} – {dateText(entry.end_time)} · {duration(entry.duration_minutes || 0)}</Text>
        <TouchableOpacity accessibilityLabel={`Edytuj wpis: ${entry.title || 'Praca'}`} onPress={() => {
          setEditing(entry); setTitle(entry.title || ''); setDescription(entry.description || '');
          setStart(dateText(entry.start_time)); setEnd(dateText(entry.end_time)); setSaveError(''); setPicker(null);
        }}><Text style={styles.action}>Edytuj wpis</Text></TouchableOpacity>
      </View>)}
    </View>)}
    {loading && <ActivityIndicator color={colors.primary.gold} />}
    {!loading && !error && !entries.length && <Text style={styles.muted}>Brak zakończonych wpisów.</Text>}
    {more && <TouchableOpacity disabled={loading} onPress={() => setLimit(n => n + 50)}><Text style={styles.action}>Pokaż wcześniejsze wpisy</Text></TouchableOpacity>}
    <Modal visible={!!editing} animationType="slide" onRequestClose={() => { if (!saving) setEditing(null); }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modal}>
        <Text style={styles.heading}>Edycja czasu pracy</Text>
        <Text style={styles.muted}>Zmiany są zapisywane w historii dostępnej administratorowi.</Text>
        <Text style={styles.text}>Zadanie</Text><TextInput style={styles.input} value={title} onChangeText={setTitle} editable={!saving} />
        <Text style={styles.text}>Opis</Text><TextInput style={[styles.input, { minHeight: 100 }]} multiline value={description} onChangeText={setDescription} editable={!saving} />
        {(['start', 'end'] as const).map(field => <View key={field}>
          <Text style={styles.text}>{field === 'start' ? 'Początek' : 'Koniec'} (DD.MM.RRRR GG:MM)</Text>
          <TextInput style={styles.input} value={field === 'start' ? start : end} onChangeText={field === 'start' ? setStart : setEnd} editable={!saving} />
          <View style={{ flexDirection: 'row', gap: 20 }}>
            <TouchableOpacity disabled={saving} onPress={() => setPicker({ field, mode: 'date' })}><Text style={styles.action}>Wybierz datę</Text></TouchableOpacity>
            <TouchableOpacity disabled={saving} onPress={() => setPicker({ field, mode: 'time' })}><Text style={styles.action}>Wybierz godzinę</Text></TouchableOpacity>
          </View>
        </View>)}
        {picker && <View><DateTimePicker value={parseDate(picker.field === 'start' ? start : end) || new Date()} mode={picker.mode} is24Hour onChange={(_, value) => {
          if (value) (picker.field === 'start' ? setStart : setEnd)(dateText(value.toISOString()));
          if (Platform.OS !== 'ios') setPicker(null);
        }} />{Platform.OS === 'ios' && <TouchableOpacity onPress={() => setPicker(null)}><Text style={styles.action}>Gotowe</Text></TouchableOpacity>}</View>}
        {!!saveError && <Text style={styles.error}>{saveError}</Text>}
        <TouchableOpacity disabled={saving} onPress={() => void save()}><Text style={styles.action}>{saving ? 'Zapisywanie…' : 'Zapisz zmiany'}</Text></TouchableOpacity>
        <TouchableOpacity disabled={saving} onPress={() => setEditing(null)}><Text style={styles.muted}>Anuluj</Text></TouchableOpacity>
      </ScrollView>
    </Modal>
  </View>;
}
const styles = StyleSheet.create({
  section: { padding: 16, gap: 12 },
  heading: { color: colors.primary.gold, fontSize: 17, fontWeight: '600' },
  day: { backgroundColor: colors.background.secondary, padding: 12, borderRadius: 12, gap: 12 },
  entry: { paddingVertical: 8, gap: 6 },
  text: { color: '#e5e4e2', fontSize: 15 },
  muted: { color: '#aaa', fontSize: 13 },
  action: { color: colors.primary.gold, paddingVertical: 10 },
  error: { color: '#fca5a5', paddingVertical: 8 },
  modal: { flexGrow: 1, padding: 24, paddingTop: 60, gap: 14, backgroundColor: colors.background.primary },
  input: { color: '#e5e4e2', backgroundColor: colors.background.secondary, borderRadius: 8, padding: 12, fontSize: 16 },
});
