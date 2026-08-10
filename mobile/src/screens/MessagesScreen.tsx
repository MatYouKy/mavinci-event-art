import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, typography, borderRadius } from '../theme';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';
import { humanizeMessageEnums } from '../lib/messageLabels';

type InboxTab = 'email' | 'forms';

interface EmailMessage {
  id: string;
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
  const [forms, setForms] = useState<FormMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchMessages = useCallback(async (isRefresh = false) => {
    if (!employee?.id) return;

    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);
    setErrorMessage(null);

    try {
      if (activeTab === 'email') {
        const { data, error } = await supabase
          .from('received_emails')
          .select('id, subject, from_address, received_date, is_read, body_text, body_html')
          .order('received_date', { ascending: false })
          .limit(50);

        if (error) throw error;
        setEmails(data || []);
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
  }, [activeTab, employee?.id]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
  };

  const renderEmail = ({ item }: { item: EmailMessage }) => {
    const preview = item.body_text?.trim() || stripHtml(item.body_html);

    return (
      <TouchableOpacity
        style={[styles.messageRow, !item.is_read && styles.messageUnread]}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('EmailMessageDetail', { messageId: item.id })}
      >
        <View style={styles.messageAvatar}>
          <Feather name="mail" size={17} color={item.is_read ? colors.text.tertiary : colors.primary.gold} />
        </View>
        <View style={styles.messageContent}>
          <View style={styles.messageHeader}>
            <Text style={[styles.messageSender, !item.is_read && styles.messageTextBold]} numberOfLines={1}>
              {item.from_address || 'Nieznany nadawca'}
            </Text>
            <Text style={styles.messageDate}>{formatDate(item.received_date)}</Text>
          </View>
          <Text style={[styles.messageSubject, !item.is_read && styles.messageTextBold]} numberOfLines={1}>
            {item.subject || '(brak tematu)'}
          </Text>
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
        <View style={styles.messageAvatar}>
          <Feather name={isContact ? 'message-square' : 'file-text'} size={17} color={colors.primary.gold} />
        </View>
        <View style={styles.messageContent}>
          <View style={styles.messageHeader}>
            <Text style={styles.sourceName} numberOfLines={1}>
              {isContact ? 'mavinci.pl' : source?.name || source?.slug || 'Formularz WWW'}
            </Text>
            <Text style={styles.messageDate}>{formatDate(eventDate)}</Text>
          </View>
          <Text style={[styles.messageSubject, isUnread && styles.messageTextBold]} numberOfLines={2}>
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

  const data = activeTab === 'email' ? emails : forms;

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
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      ) : (
        <FlatList
          data={data as any[]}
          key={activeTab}
          keyExtractor={(item) => item.id}
          renderItem={activeTab === 'email' ? (renderEmail as any) : (renderForm as any)}
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
              <Feather name={activeTab === 'email' ? 'inbox' : 'file-text'} size={48} color={colors.text.tertiary} />
              <Text style={styles.emptyText}>
                {activeTab === 'email' ? 'Brak wiadomości e-mail' : 'Brak wiadomości z formularzy'}
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
  messageUnread: { backgroundColor: colors.primary.gold + '08' },
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
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary.gold },
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
