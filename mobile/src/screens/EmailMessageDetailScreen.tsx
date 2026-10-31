import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, borderRadius } from '../theme';
import { useAuth } from '../contexts/AuthContext';

type EmailDetailRoute = RouteProp<RootStackParamList, 'EmailMessageDetail'>;

interface EmailMessage {
  id: string;
  from_address: string;
  to_address: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  received_date: string;
  is_read: boolean;
  email_account_id: string;
  has_attachments: boolean | null;
}

interface Attachment {
  id: string;
  filename: string;
  size_bytes: number | null;
  storage_path: string;
}

function htmlToText(value: string | null) {
  if (!value) return '';
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export default function EmailMessageDetailScreen() {
  const route = useRoute<EmailDetailRoute>();
  const navigation = useNavigation<any>();
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mailboxName, setMailboxName] = useState<string | null>(null);
  const { employee } = useAuth();

  const fetchMessage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('received_emails')
        .select('id, from_address, to_address, subject, body_text, body_html, received_date, is_read, email_account_id, has_attachments')
        .eq('id', route.params.messageId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!data) {
        const { data: contactMessage, error: contactLookupError } = await supabase
          .from('contact_messages')
          .select('id')
          .eq('id', route.params.messageId)
          .maybeSingle();

        if (contactLookupError) throw contactLookupError;
        if (contactMessage) {
          navigation.replace('ContactMessageDetail', { messageId: contactMessage.id });
          return;
        }

        setError('Nie znaleziono wiadomości lub nie masz do niej dostępu.');
        return;
      }
      setMessage(data as EmailMessage);

      const [{ data: account }, { data: files }, { count: assignedCount }] = await Promise.all([
        supabase.from('employee_email_accounts').select('account_name, employee_id').eq('id', data.email_account_id).maybeSingle(),
        supabase.from('email_attachments').select('id, filename, size_bytes, storage_path')
          .eq('email_id', data.id).eq('email_type', 'received').order('created_at'),
        employee?.id
          ? supabase.from('employee_email_account_assignments').select('id', { count: 'exact', head: true })
              .eq('email_account_id', data.email_account_id).eq('employee_id', employee.id)
          : Promise.resolve({ count: 0 }),
      ]);
      setMailboxName(account?.account_name || null);
      setAttachments((files || []) as Attachment[]);
      // Jak w CRM: status „przeczytana” zmienia tylko właściciel lub osoba przypisana do skrzynki,
      // nie administrator otwierający cudzą wiadomość.
      const ownsMailbox = Boolean(employee?.id && (account?.employee_id === employee.id || (assignedCount || 0) > 0));

      if (!data.is_read && ownsMailbox) {
        const { error: updateError } = await supabase
          .from('received_emails')
          .update({ is_read: true })
          .eq('id', data.id);

        if (!updateError) setMessage((current) => current ? { ...current, is_read: true } : current);
      }
    } catch (err) {
      console.error('Error fetching email details:', err);
      setError('Nie udało się otworzyć tej wiadomości.');
    } finally {
      setLoading(false);
    }
  }, [employee?.id, navigation, route.params.messageId]);

  const openAttachment = async (attachment: Attachment) => {
    const { data, error: signError } = await supabase.storage
      .from('email-attachments')
      .createSignedUrl(attachment.storage_path, 300, { download: attachment.filename });
    if (signError || !data?.signedUrl) {
      setError('Nie udało się otworzyć załącznika.');
      return;
    }
    await Linking.openURL(data.signedUrl).catch(() => setError('Nie udało się otworzyć załącznika.'));
  };

  useEffect(() => {
    fetchMessage();
  }, [fetchMessage]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  if (!message || error) {
    return (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={42} color={colors.status.error} />
        <Text style={styles.errorText}>{error || 'Nie znaleziono wiadomości.'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchMessage}>
          <Text style={styles.retryButtonText}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const body = message.body_text?.trim() || htmlToText(message.body_html) || 'Wiadomość nie zawiera treści tekstowej.';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subject}>{message.subject || '(brak tematu)'}</Text>

      <View style={styles.metaCard}>
        <View style={styles.metaRow}>
          <Feather name="user" size={16} color={colors.primary.gold} />
          <View style={styles.metaContent}>
            <Text style={styles.metaLabel}>Od</Text>
            <Text style={styles.metaValue} selectable>{message.from_address}</Text>
          </View>
        </View>
        <View style={styles.metaRow}>
          <Feather name="corner-down-right" size={16} color={colors.text.tertiary} />
          <View style={styles.metaContent}>
            <Text style={styles.metaLabel}>Do</Text>
            <Text style={styles.metaValue} selectable>{message.to_address}</Text>
          </View>
        </View>
        {!!mailboxName && (
          <View style={styles.metaRow}>
            <Feather name="inbox" size={16} color={colors.text.tertiary} />
            <View style={styles.metaContent}>
              <Text style={styles.metaLabel}>Skrzynka</Text>
              <Text style={styles.metaValue}>{mailboxName}</Text>
            </View>
          </View>
        )}
        <View style={styles.metaRow}>
          <Feather name="clock" size={16} color={colors.text.tertiary} />
          <View style={styles.metaContent}>
            <Text style={styles.metaLabel}>Otrzymano</Text>
            <Text style={styles.metaValue}>
              {new Date(message.received_date).toLocaleString('pl-PL', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>
      </View>

      {(attachments.length > 0 || message.has_attachments) && (
        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>Załączniki</Text>
          {attachments.length === 0 ? (
            <Text style={styles.metaValue}>Załączniki tej wiadomości pojawią się po pierwszym otwarciu jej w CRM.</Text>
          ) : attachments.map((attachment) => (
            <TouchableOpacity key={attachment.id} style={styles.attachmentRow} onPress={() => void openAttachment(attachment)}
              accessibilityRole="button" accessibilityLabel={`Otwórz załącznik ${attachment.filename}`}>
              <Feather name="paperclip" size={15} color={colors.primary.gold} />
              <Text style={styles.attachmentName} numberOfLines={1}>{attachment.filename}</Text>
              {!!attachment.size_bytes && <Text style={styles.metaLabel}>{Math.max(1, Math.round(attachment.size_bytes / 1024))} KB</Text>}
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.bodyCard}>
        <Text style={styles.bodyText} selectable>{body}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.background.primary,
  },
  subject: {
    fontSize: typography.fontSizes.xl,
    fontWeight: typography.fontWeights.bold,
    lineHeight: 28,
    color: colors.text.primary,
  },
  metaCard: {
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  metaContent: { flex: 1 },
  metaLabel: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary, marginBottom: 2 },
  metaValue: { fontSize: typography.fontSizes.sm, color: colors.text.primary, lineHeight: 20 },
  bodyCard: {
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  bodyText: { fontSize: typography.fontSizes.md, lineHeight: 24, color: colors.text.primary },
  attachmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  attachmentName: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.text.primary },
  errorText: { fontSize: typography.fontSizes.md, color: colors.text.secondary, textAlign: 'center' },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  retryButtonText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
});
