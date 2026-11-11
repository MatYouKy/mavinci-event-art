import MessageInquiryBadge from '../components/MessageInquiryBadge';
import { readMailboxUnreadCounts } from '../lib/unreadCounts';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { readMessageSalesContext, hasMessageInquiry, salesAiLabel, type MessageSalesContext } from '../lib/messageSalesContext';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';
import { humanizeMessageEnums } from '../lib/messageLabels';
import { inboxMailboxIds, mailboxFilter } from '../lib/mailboxPreferences';

type InboxTab = 'email' | 'trash' | 'forms';

interface EmailMessage {
  sales?: MessageSalesContext;
  id: string;
  email_account_id: string;
  subject: string | null;
  from_address: string | null;
  received_date: string;
  is_read: boolean;
  body_text: string | null;
  body_html: string | null;
}

interface WebhookSource {
  name: string;
  slug: string;
}

interface InboundEvent {
  kind: 'webhook';
  id: string;
  title: string;
  body: string | null;
  event_type: string;
  event_time: string | null;
  created_at: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  source: WebhookSource | WebhookSource[] | null;
}

interface ContactMessage {
  kind: 'contact';
  id: string;
  name: string;
  email: string;
  subject: string | null;
  message: string;
  category: string;
  source_page: string;
  status: string;
  priority: string;
  created_at: string;
}

type FormMessage = InboundEvent | ContactMessage;

interface Mailbox {
  id: string;
  account_name: string;
  email_address: string;
  account_type: string;
}

function stripHtml(value: string | null) {
  if (!value) return '';
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getSource(source: InboundEvent['source']): WebhookSource | null {
  if (Array.isArray(source)) return source[0] ?? null;
  return source;
}

function MessagesContent() {
  const navigation = useNavigation<any>();
  const { employee } = useAuth();
  const [activeTab, setActiveTab] = useState<InboxTab>('email');
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  const scope = `${employee?.id}:${activeTab}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [forms, setForms] = useState<FormMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Skrzynki jak w CRM: własne i przypisane, bez ukrytych w Ustawieniach → Skrzynki pocztowe.
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [unreadByMailbox, setUnreadByMailbox] = useState<Record<string, number>>({});
  const [selectedMailbox, setSelectedMailbox] = useState<string>('all');

  const loadMailboxes = useCallback(async (): Promise<Mailbox[]> => {
    if (!employee?.id) return [];
    const ids = await inboxMailboxIds(supabase, employee.id);
    if (ids.length === 0) {
      setMailboxes([]);
      setUnreadByMailbox({});
      return [];
    }
    const { data, error } = await supabase
      .from('employee_email_accounts')
      .select('id, account_name, email_address, account_type')
      .in('id', ids)
      .eq('is_active', true);
    if (error) throw error;
    const order: Record<string, number> = { personal: 0, shared: 1, system: 2 };
    const list = ((data || []) as Mailbox[]).sort((a, b) =>
      (order[a.account_type] ?? 9) - (order[b.account_type] ?? 9) || a.account_name.localeCompare(b.account_name));
    setMailboxes(list);
    setUnreadByMailbox(await readMailboxUnreadCounts(supabase, list.map(mailbox => mailbox.id)));
    return list;
  }, [employee?.id]);

  const fetchMessages = useCallback(async (isRefresh = false) => {
    if (!employee?.id) return;

    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);

    try {
      if (activeTab !== 'forms') {
        const list = await loadMailboxes();
        const visibleIds = list.map((mailbox) => mailbox.id);
        const scope = selectedMailbox !== 'all' && visibleIds.includes(selectedMailbox) ? [selectedMailbox] : visibleIds;
        if (selectedMailbox !== 'all' && !visibleIds.includes(selectedMailbox)) setSelectedMailbox('all');
        // Pusta lista skrzynek = brak wiadomości (nigdy zapytanie bez filtra skrzynek).
        let query = supabase
          .from('received_emails')
          .select('id, email_account_id, subject, from_address, received_date, is_read, body_text, body_html')
          .in('email_account_id', mailboxFilter(scope))
          .order('received_date', { ascending: false })
          .limit(50);
        query = activeTab === 'trash' ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
        const { data, error } = await query;

        if (error) throw error;
        const sales = await readMessageSalesContext(supabase, (data || []).map(m => ({ id: m.id, type: 'received' })));
        setEmails((data || []).map(m => ({ ...m, sales: sales[`received:${m.id}`] })) as EmailMessage[]);
      } else {
        const [contactResult, webhookResult] = await Promise.all([
          supabase
            .from('contact_messages')
            .select('id, name, email, subject, message, category, source_page, status, priority, created_at')
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('inbound_events')
            .select(`
              id,
              title,
              body,
              event_type,
              event_time,
              created_at,
              priority,
              source:webhook_sources(name, slug)
            `)
            .order('created_at', { ascending: false })
            .limit(50),
        ]);

        if (contactResult.error && webhookResult.error) {
          throw contactResult.error;
        }
        if (contactResult.error) console.error('Error fetching contact messages:', contactResult.error);
        if (webhookResult.error) console.error('Error fetching webhook messages:', webhookResult.error);

        const contactMessages = (contactResult.data || []).map((item) => ({
          ...item,
          kind: 'contact' as const,
        }));
        const webhookMessages = (webhookResult.data || []).map((item) => ({
          ...item,
          kind: 'webhook' as const,
        })) as InboundEvent[];

        setForms([...contactMessages, ...webhookMessages]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 50));
      }
    } catch (err) {
      console.error('Error fetching inbox:', err);
      setErrorMessage('Nie udało się pobrać wiadomości. Pociągnij w dół, aby spróbować ponownie.');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, employee?.id, loadMailboxes, selectedMailbox]);

  useFocusEffect(useCallback(() => {
    void fetchMessages();
  }, [fetchMessages]));

  useFocusEffect(useCallback(() => {
    let active = true, busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!active || busy) return;
      busy = true;
      const requestedScope = scopeRef.current;
      try {
        const context = await readMessageSalesContext(supabase, emailsRef.current.map(m => ({ type: 'received', id: m.id })));
        if (active && requestedScope === scopeRef.current) setEmails(current => current.map(m => ({ ...m, sales: context[`received:${m.id}`] || m.sales })));
      } finally { busy = false; }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 400); };
    const channel = supabase.channel('mobile-mail-sales')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: 'is_inquiry=eq.true' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_ai_qualifications' }, schedule)
      .subscribe();
    return () => { active = false; clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [employee?.id]));

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
  };

  const mailboxName = (id: string) => mailboxes.find((mailbox) => mailbox.id === id)?.account_name;

  const renderEmail = ({ item }: { item: EmailMessage }) => {
    const preview = item.body_text?.trim() || stripHtml(item.body_html);
    const showMailbox = selectedMailbox === 'all' && mailboxes.length > 1;

    return (
      <TouchableOpacity
        style={[styles.messageRow, !item.is_read && styles.messageUnread]}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('EmailMessageDetail', { messageId: item.id })}
      >
        {!item.is_read && <View style={styles.unreadBar} />}
        <View style={styles.messageAvatar}>
          <Feather name="mail" size={17} color={item.is_read ? colors.text.tertiary : colors.primary.gold} />
        </View>
        <View style={styles.messageContent}>
          <View style={styles.messageHeader}>
            <Text style={[styles.messageSender, item.is_read ? styles.messageTextRead : styles.messageTextBold]} numberOfLines={1}>
              {item.from_address || 'Nieznany nadawca'}
            </Text>
            <Text style={[styles.messageDate, !item.is_read && styles.messageAccentUnread]}>{formatDate(item.received_date)}</Text>
          </View>
          <Text style={[styles.messageSubject, item.is_read ? styles.messageTextRead : styles.messageAccentUnread]} numberOfLines={1}>
            {item.subject || '(brak tematu)'}
          </Text>
          {showMailbox && !!mailboxName(item.email_account_id) && (
            <Text style={styles.mailboxLabel} numberOfLines={1}>{mailboxName(item.email_account_id)}</Text>
          )}
          {hasMessageInquiry(item.sales) && item.sales?.inquiries.map(i => <MessageInquiryBadge key={i.id} inquiry={i} />)}
          {hasMessageInquiry(item.sales) && !!item.sales?.aiStatus && <Text style={styles.mailboxLabel}>{salesAiLabel(item.sales.aiStatus)}</Text>}
          {!!preview && <Text style={styles.messageSnippet} numberOfLines={2}>{preview}</Text>}
        </View>
        {!item.is_read ? <View style={styles.unreadDot} /> : <Feather name="chevron-right" size={16} color={colors.text.tertiary} />}
      </TouchableOpacity>
    );
  };

  const renderForm = ({ item }: { item: FormMessage }) => {
    const isContact = item.kind === 'contact';
    const source = isContact ? null : getSource(item.source);
    const eventDate = isContact ? item.created_at : item.event_time || item.created_at;
    const isUnread = isContact && item.status === 'new';

    return (
      <TouchableOpacity
        style={[styles.messageRow, isUnread && styles.messageUnread]}
        activeOpacity={0.7}
        onPress={() => navigation.navigate(
          isContact ? 'ContactMessageDetail' : 'InboundEventDetail',
          isContact ? { messageId: item.id } : { eventId: item.id },
        )}
      >
        {isUnread && <View style={styles.unreadBar} />}
        <View style={styles.messageAvatar}>
          <Feather name={isContact ? 'message-square' : 'file-text'} size={17} color={colors.primary.gold} />
        </View>
        <View style={styles.messageContent}>
          <View style={styles.messageHeader}>
            <Text style={styles.sourceName} numberOfLines={1}>
              {isContact ? 'mavinci.pl' : source?.name || source?.slug || 'Formularz WWW'}
            </Text>
            <Text style={[styles.messageDate, isUnread && styles.messageAccentUnread]}>{formatDate(eventDate)}</Text>
          </View>
          <Text style={[styles.messageSubject, isUnread && styles.messageAccentUnread]} numberOfLines={2}>
            {isContact
              ? item.subject
                ? humanizeMessageEnums(item.subject)
                : `Wiadomość od ${item.name}`
              : humanizeMessageEnums(item.title)}
          </Text>
          <Text style={styles.messageSnippet} numberOfLines={2}>
            {isContact ? item.message : item.body || 'Brak dodatkowej treści'}
          </Text>
        </View>
        {isUnread ? <View style={styles.unreadDot} /> : <Feather name="chevron-right" size={16} color={colors.text.tertiary} />}
      </TouchableOpacity>
    );
  };

  const data = activeTab !== 'forms' ? emails : forms;

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'email' && styles.tabActive]}
          onPress={() => setActiveTab('email')}
        >
          <Feather name="mail" size={16} color={activeTab === 'email' ? colors.background.primary : colors.text.secondary} />
          <Text style={[styles.tabText, activeTab === 'email' && styles.tabTextActive]}>E-maile</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'forms' && styles.tabActive]}
          onPress={() => setActiveTab('forms')}
        >
          <Feather name="file-text" size={16} color={activeTab === 'forms' ? colors.background.primary : colors.text.secondary} />
          <Text style={[styles.tabText, activeTab === 'forms' && styles.tabTextActive]}>Formularze WWW</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'trash' && styles.tabActive]} onPress={() => setActiveTab('trash')}>
          <Feather name="trash-2" size={16} color={activeTab === 'trash' ? colors.background.primary : colors.text.secondary} />
          <Text style={[styles.tabText, activeTab === 'trash' && styles.tabTextActive]}>Kosz</Text>
        </TouchableOpacity>
      </View>

      {activeTab !== 'forms' && mailboxes.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mailboxBar}
          contentContainerStyle={styles.mailboxBarContent}>
          {[{ id: 'all', account_name: 'Wszystkie' } as Pick<Mailbox, 'id' | 'account_name'>, ...mailboxes].map((mailbox) => {
            const active = selectedMailbox === mailbox.id;
            const unread = mailbox.id === 'all'
              ? Object.values(unreadByMailbox).reduce((sum, count) => sum + count, 0)
              : unreadByMailbox[mailbox.id] || 0;
            return (
              <TouchableOpacity key={mailbox.id} onPress={() => setSelectedMailbox(mailbox.id)}
                style={[styles.mailboxChip, active && styles.mailboxChipActive]}
                accessibilityRole="button" accessibilityState={{ selected: active }}>
                <Text style={[styles.mailboxChipText, active && styles.mailboxChipTextActive]} numberOfLines={1}>
                  {mailbox.account_name}{unread > 0 ? ` · ${unread}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      ) : (
        <FlatList
          data={data as any[]}
          key={activeTab}
          keyExtractor={(item) => item.id}
          renderItem={activeTab !== 'forms' ? (renderEmail as any) : (renderForm as any)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchMessages(true)}
              tintColor={colors.primary.gold}
            />
          }
          contentContainerStyle={[styles.listContent, data.length === 0 && styles.emptyListContent]}
          ListHeaderComponent={errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name={activeTab !== 'forms' ? 'inbox' : 'file-text'} size={48} color={colors.text.tertiary} />
              <Text style={styles.emptyText}>
                {activeTab !== 'forms'
                  ? mailboxes.length === 0
                    ? 'Brak skrzynek. Sprawdź Ustawienia → Skrzynki pocztowe.'
                    : activeTab === 'trash' ? 'Kosz jest pusty' : 'Brak wiadomości e-mail'
                  : 'Brak wiadomości z formularzy'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  tab: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
  },
  tabActive: { backgroundColor: colors.primary.gold },
  tabText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: colors.text.secondary },
  tabTextActive: { color: colors.background.primary },
  listContent: { paddingBottom: spacing.lg },
  emptyListContent: { flexGrow: 1 },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 12,
  },
  // Nieprzeczytane jak w CRM: złote tło i pasek z lewej, złoty temat i data; przeczytane — przygaszone.
  messageUnread: { backgroundColor: colors.primary.gold + '12' },
  unreadBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: colors.primary.gold + '73' },
  messageAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageContent: { flex: 1 },
  messageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  messageSender: { fontSize: typography.fontSizes.sm, color: colors.text.primary, flex: 1, marginRight: spacing.sm },
  sourceName: { fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold, color: colors.primary.gold, flex: 1, marginRight: spacing.sm },
  messageDate: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  messageSubject: { fontSize: typography.fontSizes.sm, color: colors.text.primary },
  messageSnippet: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary, marginTop: 3, lineHeight: 17 },
  messageTextBold: { fontWeight: typography.fontWeights.bold },
  messageTextRead: { color: colors.text.secondary },
  messageAccentUnread: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary.gold },
  mailboxLabel: { fontSize: typography.fontSizes.xs, color: colors.primary.gold, marginTop: 2 },
  mailboxBar: { flexGrow: 0, backgroundColor: colors.background.secondary },
  mailboxBarContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  mailboxChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
    maxWidth: 220,
  },
  mailboxChipActive: { backgroundColor: colors.primary.gold + '33' },
  mailboxChipText: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  mailboxChipTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { fontSize: typography.fontSizes.sm, color: colors.text.tertiary },
  errorText: {
    margin: spacing.md,
    padding: spacing.md,
    color: colors.status.error,
    backgroundColor: colors.status.error + '12',
    borderRadius: borderRadius.md,
  },
});

export default function MessagesScreen() {
  return (
    <PermissionGate module="messages">
      <MessagesContent />
    </PermissionGate>
  );
}
