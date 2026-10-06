import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, ViewToken } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { Feather } from '@expo/vector-icons';
import { uuid } from 'expo-modules-core';
import { supabase } from '../lib/supabase';
import { getSellerConversation, SellerConversation, sellerConversationLabel } from '../lib/sellerChat';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { createRefreshQueue } from '../lib/refreshQueue';
import { navigateToEvent } from '../navigation/navigationRef';
import { colors } from '../theme';

type Message = { id: string; seq: number; sender_kind: string; sender_name: string; body: string; created_at: string; own: boolean };

export default function SellerChatScreen({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const focused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const [conversation, setConversation] = useState<SellerConversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [older, setOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const initial = useRef(true);
  const sendLock = useRef(false);
  const olderLock = useRef(false);
  const pending = useRef<{ id: string; body: string } | null>(null);
  const readThrough = useRef(0);
  const visibleThrough = useRef(0);
  const readBusy = useRef(false);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const list = useRef<FlatList<Message>>(null);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [focused, onBack]);

  const markVisibleRead = useCallback(async () => {
    if (readBusy.current || !focusedRef.current || AppState.currentState !== 'active' || visibleThrough.current <= readThrough.current) return;
    const through = visibleThrough.current;
    readBusy.current = true;
    try {
      const { error: readError } = await supabase.rpc('mark_seller_conversation_read', { p_conversation: conversationId, p_through: through });
      if (!readError && alive.current) readThrough.current = through;
    } finally { readBusy.current = false; }
  }, [conversationId]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<Message>[] }) => {
    visibleThrough.current = Math.max(0, ...viewableItems.map(item => Number(item.item.seq)));
    void markVisibleRead();
  }).current;

  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const [summary, result] = await Promise.all([
        getSellerConversation(conversationId),
        supabase.rpc('get_seller_messages', { p_conversation: conversationId }),
      ]);
      if (!alive.current || signal?.aborted) return;
      if (result.error) throw result.error;
      const rows = (result.data || []) as Message[];
      setConversation(summary);
      if (initial.current) setHasOlder(rows.length === 50);
      initial.current = false;
      setMessages(previous => [...new Map([...previous, ...rows].map(row => [row.id, row])).values()].sort((a, b) => Number(b.seq) - Number(a.seq)));
      void markVisibleRead();
    } catch {
      if (alive.current && !signal?.aborted) setError('Nie udało się wczytać rozmowy. Sprawdź połączenie i dostęp do wątku.');
    } finally { if (alive.current && !signal?.aborted) setLoading(false); }
  }, [conversationId, markVisibleRead]);

  useForegroundEffect(signal => {
    if (!focused) return;
    const queue = createRefreshQueue(signal, reload);
    void queue.refresh();
    const channel = supabase.channel(`mobile-seller-chat-${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'seller_messages', filter: `conversation_id=eq.${conversationId}` }, queue.schedule)
      .subscribe(status => { if (status === 'SUBSCRIBED') queue.schedule(); });
    const timer = setInterval(queue.schedule, 15000);
    return () => { clearInterval(timer); return supabase.removeChannel(channel); };
  }, [conversationId, focused, reload]);

  const loadOlder = async () => {
    if (!hasOlder || olderLock.current || !messages.length) return;
    olderLock.current = true; setOlder(true);
    try {
      const { data, error: fetchError } = await supabase.rpc('get_seller_messages', { p_conversation: conversationId, p_before: messages[messages.length - 1].seq });
      if (!alive.current) return;
      if (fetchError) throw fetchError;
      const rows = (data || []) as Message[];
      setHasOlder(rows.length === 50);
      setMessages(previous => [...new Map([...previous, ...rows].map(row => [row.id, row])).values()].sort((a, b) => Number(b.seq) - Number(a.seq)));
    } catch { if (alive.current) setError('Nie udało się wczytać starszych wiadomości. Spróbuj ponownie.'); }
    finally { olderLock.current = false; if (alive.current) setOlder(false); }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sendLock.current || !conversation?.can_send) return;
    sendLock.current = true; setSending(true); setError('');
    try {
      if (!pending.current || pending.current.body !== body) pending.current = { id: uuid.v4(), body };
      const { error: sendError } = await supabase.rpc('send_seller_message', { p_conversation: conversationId, p_message_id: pending.current.id, p_body: body });
      if (sendError) throw sendError;
      if (!alive.current) return;
      pending.current = null; setText('');
      await reload();
      list.current?.scrollToOffset({ offset: 0, animated: true });
    } catch { if (alive.current) setError('Nie potwierdzono wysyłki. Spróbuj ponownie — ta sama wiadomość nie zostanie zdublowana.'); }
    finally { sendLock.current = false; if (alive.current) setSending(false); }
  };

  return <KeyboardAvoidingView
    style={styles.container}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    // The scene starts below the navigator header; keyboard coordinates are screen-relative.
    keyboardVerticalOffset={headerHeight}
  >
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} accessibilityLabel="Wróć do komunikatora" style={styles.back}><Feather name="arrow-left" size={24} color={colors.text.primary} /></TouchableOpacity>
      <View style={styles.heading}><Text style={styles.title} numberOfLines={2}>{conversation?.event_name || conversation?.offer_title || conversation?.title || 'Rozmowa ze sprzedawcą'}</Text></View>
    </View>
    {conversation && <View style={styles.context}>
      <Text style={styles.label}>{sellerConversationLabel(conversation)}</Text>
      <Text style={styles.contextText}>{[conversation.brand_name, conversation.title].filter(Boolean).join(' · ')}</Text>
      {conversation.offer_id && <Text style={styles.contextText}>Ustalenia ze sprzedawcą · wspólna historia oferty i realizacji</Text>}
      {conversation.can_view_event && conversation.event_id && <TouchableOpacity onPress={() => navigateToEvent(conversation.event_id!)}><Text style={styles.link}>Otwórz wydarzenie →</Text></TouchableOpacity>}
    </View>}
    {loading ? <ActivityIndicator style={styles.loading} color={colors.primary.gold} /> : <FlatList
      style={styles.messageList}
      ref={list} inverted data={messages} keyExtractor={item => item.id} contentContainerStyle={styles.messages}
      onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={{ itemVisiblePercentThreshold: 50 }}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <View style={[styles.bubble, item.own && styles.own]}>
        <Text style={[styles.author, item.own && styles.ownText]}>{item.sender_name} · {item.sender_kind === 'seller' ? 'Sprzedawca' : 'MAVINCI'}</Text>
        <Text selectable style={[styles.body, item.own && styles.ownText]}>{item.body}</Text>
        <Text style={[styles.time, item.own && styles.ownText]}>{new Date(item.created_at).toLocaleString('pl-PL')}</Text>
      </View>}
      ListFooterComponent={hasOlder ? <TouchableOpacity disabled={older} onPress={loadOlder}><Text style={styles.link}>{older ? 'Wczytywanie…' : 'Pokaż starsze wiadomości'}</Text></TouchableOpacity> : null}
      ListEmptyComponent={<Text style={styles.empty}>Brak wiadomości w tej rozmowie.</Text>}
    />}
    {!!error && <View style={styles.error}><Text style={styles.contextText}>{error}</Text><TouchableOpacity onPress={() => { setError(''); void reload(); }}><Text style={styles.link}>Odśwież rozmowę</Text></TouchableOpacity></View>}
    {conversation?.can_send ? <View style={styles.composer}>
      <TextInput style={styles.input} multiline maxLength={10000} value={text} onChangeText={setText} editable={!sending} placeholder="Odpowiedź widoczna dla sprzedawcy…" placeholderTextColor={colors.text.tertiary} accessibilityLabel="Wiadomość do sprzedawcy" />
      <TouchableOpacity onPress={send} disabled={sending || !text.trim()} accessibilityLabel="Wyślij wiadomość" style={[styles.send, (sending || !text.trim()) && { opacity: 0.4 }]}>{sending ? <ActivityIndicator color={colors.background.primary} /> : <Feather name="send" size={22} color={colors.background.primary} />}</TouchableOpacity>
    </View> : conversation && <Text style={styles.readOnly}>Masz dostęp do odczytu tej rozmowy.</Text>}
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  back: { padding: 8 }, heading: { flex: 1 },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: 17, color: colors.text.primary },
  context: { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: colors.background.secondary, gap: 5 },
  label: { fontSize: 12, fontWeight: '700', color: colors.primary.gold },
  contextText: { fontSize: 12, lineHeight: 18, color: colors.text.secondary },
  link: { color: colors.primary.gold, paddingVertical: 10, fontSize: 13 },
  messageList: { flex: 1, minHeight: 0 },
  loading: { flex: 1 }, messages: { padding: 16, gap: 12 },
  bubble: { alignSelf: 'flex-start', maxWidth: '92%', padding: 12, borderRadius: 14, backgroundColor: colors.secondary.burgundyLight },
  own: { alignSelf: 'flex-end', backgroundColor: colors.primary.gold },
  ownText: { color: colors.background.primary },
  author: { color: colors.primary.gold, fontSize: 11, marginBottom: 6 },
  body: { color: colors.text.primary, fontSize: 15, lineHeight: 22 },
  time: { color: colors.text.tertiary, fontSize: 10, marginTop: 8 },
  empty: { color: colors.text.secondary, textAlign: 'center', transform: [{ scaleY: -1 }], padding: 24 },
  error: { paddingHorizontal: 16, paddingTop: 8 },
  composer: { flexShrink: 0, flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 10 },
  input: { flex: 1, minHeight: 44, maxHeight: 140, padding: 12, borderRadius: 12, backgroundColor: colors.background.secondary, color: colors.text.primary, fontSize: 15 },
  send: { padding: 12, borderRadius: 12, backgroundColor: colors.primary.gold },
  readOnly: { color: colors.text.secondary, padding: 16, fontSize: 13 },
});
