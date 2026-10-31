import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, KeyboardAvoidingView, Platform, AppState, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { colors } from '../theme';

type Entry = { id: string; title: string | null; description: string | null; start_time: string; duration_minutes: number | null };
export default function TimeEntryDiscussions({ entries, discussionEntryId, discussionRequestId, onThreadsChange }: { entries: Entry[]; discussionEntryId?: string; discussionRequestId?: number; onThreadsChange?: (threads: any[]) => void }) {
  const { employee } = useAuth();
  const admin = (employee as any)?.access_level === 'admin' || (employee as any)?.role === 'admin';
  const [threads, setThreads] = useState<any[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('list_time_entry_discussions');
    if (error) setLoadError('Nie udało się pobrać rozmów dotyczących czasu pracy.');
    else { const next = Array.isArray(data) ? data : []; setThreads(next); onThreadsChange?.(next); setLoadError(''); }
    setLoading(false);
  }, [onThreadsChange]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void refresh(); }, 20000);
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { clearInterval(timer); listener.remove(); };
  }, [refresh]);
  const openedRequest = useRef<string | null>(null);
  useEffect(() => { if (discussionEntryId) void refresh(); }, [discussionEntryId, discussionRequestId, refresh]);
  useEffect(() => {
    if (!discussionEntryId) return;
    const key = `${discussionEntryId}:${discussionRequestId}`;
    const target = threads.find(t => t.time_entry_id === discussionEntryId);
    if (!target || openedRequest.current === key) return;
    openedRequest.current = key;
    setSelected({ ...target, id: target.time_entry_id }); setBody(''); setError('');
  }, [threads, discussionEntryId, discussionRequestId]);
  const thread = threads.find(t => t.time_entry_id === selected?.id);
  const open = (entry: Entry) => { setSelected(entry); setBody(''); setError(''); void refresh(); };
  const mutate = async (resolved?: boolean) => {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const result = resolved === undefined
        ? await supabase.rpc('post_time_entry_discussion', { p_entry: selected.id, p_body: body })
        : await supabase.rpc('resolve_time_entry_discussion', { p_entry: selected.id, p_resolved: resolved });
      if (result.error) throw result.error;
      if (resolved === undefined) setBody('');
      await refresh();
    } catch (e: any) { setError(e.message || 'Nie udało się zapisać odpowiedzi.'); }
    finally { setBusy(false); }
  };
  const button = { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 8, backgroundColor: '#d3bb7320', marginTop: 8 };
  return <View style={{ padding: 16 }}>
    <Text style={{ color: colors.primary.gold, fontSize: 17, fontWeight: '600' }}>Rozmowy o czasie pracy{threads.some(t => !t.resolved) ? ` · Do wyjaśnienia: ${threads.filter(t => !t.resolved).length}` : ''}</Text>
    <Text style={{ color: '#aaa', marginTop: 4, marginBottom: 8 }}>Pytania i odpowiedzi także do wcześniejszych wpisów.</Text>
    {loading && <ActivityIndicator color={colors.primary.gold} />}
    {!loading && !loadError && !threads.length && <Text style={{ color: '#aaa' }}>Brak rozpoczętych wątków.</Text>}
    {threads.map(t => <TouchableOpacity key={t.id} style={button} onPress={() => open({ ...t, id: t.time_entry_id })}>
      <Text style={{ color: '#e5e4e2', fontWeight: '600' }}>{t.title}</Text>
      <Text style={{ color: '#bbb', marginTop: 4 }}>{t.employee_name} · {new Date(t.start_time).toLocaleDateString('pl-PL')}</Text>
      <Text style={{ color: t.resolved ? '#7bd99c' : colors.primary.gold, marginTop: 4 }}>{t.resolved ? 'Wyjaśnione' : 'Do wyjaśnienia'} · {t.messages.length} wiadomości</Text>
    </TouchableOpacity>)}
    {admin && entries.filter(e => !threads.some(t => t.time_entry_id === e.id)).map(e => <TouchableOpacity key={e.id} style={button} onPress={() => open(e)}><Text style={{ color: colors.primary.gold }}>Rozpocznij wątek: {e.title || 'Praca'}</Text></TouchableOpacity>)}
    {!!loadError && <><Text accessibilityRole="alert" style={{ color: '#f88', marginTop: 8 }}>{loadError}</Text><TouchableOpacity onPress={() => void refresh()} style={button}><Text style={{ color: colors.primary.gold }}>Spróbuj ponownie</Text></TouchableOpacity></>}
    <Modal visible={!!selected} animationType="slide" onRequestClose={() => { if (!busy) setSelected(null); }}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background.primary, paddingTop: Platform.OS === 'ios' ? 54 : 24 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 }}>
          <Text style={{ color: '#e5e4e2', fontSize: 18 }}>Wyjaśnienie czasu pracy</Text>
          <TouchableOpacity disabled={busy} accessibilityLabel="Zamknij rozmowę" onPress={() => setSelected(null)} style={{ padding: 12 }}><Text style={{ color: colors.primary.gold }}>Zamknij</Text></TouchableOpacity>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={{ color: colors.primary.gold }}>{selected?.title || 'Praca'}</Text>
          {!!selected && <Text style={{ color: '#aaa', marginVertical: 8 }}>{new Date(selected.start_time).toLocaleString('pl-PL')} · {selected.duration_minutes ?? '—'} min</Text>}
          {!!selected?.description && <Text style={{ color: '#ccc', marginBottom: 12 }}>{selected.description}</Text>}
          {thread?.messages.map((m: any) => <View key={m.id} style={{ padding: 12, backgroundColor: '#ffffff08', borderRadius: 8, marginBottom: 10 }}>
            <Text style={{ color: colors.primary.gold }}>{m.author_name}</Text>
            <Text style={{ color: '#999', fontSize: 12, marginVertical: 4 }}>{new Date(m.created_at).toLocaleString('pl-PL')}</Text>
            <Text selectable style={{ color: '#e5e4e2', lineHeight: 22 }}>{m.body}</Text>
          </View>)}
          {thread?.resolved ? <Text style={{ color: '#7bd99c' }}>Wątek oznaczono jako wyjaśniony.</Text> : <>
            <Text style={{ color: '#e5e4e2', marginVertical: 8 }}>{thread ? 'Twoja odpowiedź' : 'Pytanie do wpisu'}</Text>
            <TextInput accessibilityLabel="Treść wiadomości" multiline maxLength={4000} editable={!busy} value={body} onChangeText={setBody} placeholder="Wpisz wiadomość…" placeholderTextColor="#888" style={{ minHeight: 100, textAlignVertical: 'top', backgroundColor: '#ffffff08', padding: 12, borderRadius: 8, color: '#e5e4e2' }} />
            <TouchableOpacity disabled={busy || !body.trim() || !!loadError} onPress={() => void mutate()} style={{ ...button, opacity: busy || !body.trim() || !!loadError ? 0.4 : 1 }}><Text style={{ color: colors.primary.gold }}>{busy ? 'Zapisywanie…' : thread ? 'Dodaj odpowiedź' : 'Rozpocznij wątek'}</Text></TouchableOpacity>
          </>}
          {admin && thread && <TouchableOpacity disabled={busy} style={button} onPress={() => void mutate(!thread.resolved)}><Text style={{ color: colors.primary.gold }}>{thread.resolved ? 'Otwórz ponownie' : 'Oznacz jako wyjaśnione'}</Text></TouchableOpacity>}
          {!!(error || loadError) && <Text accessibilityRole="alert" style={{ color: '#f88', marginTop: 12 }}>{error || loadError}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
