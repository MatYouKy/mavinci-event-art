import MessageInquiryBadge from '../components/MessageInquiryBadge';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { getBlobUtil } from '../lib/nativeBlobUtil';
import { decode } from 'base64-arraybuffer';
import { attachmentPreview, matchesPreviewBytes } from '../lib/attachmentPreview';
import { readMessageSalesContext, hasMessageInquiry, canClaimMessageInquiry, messageInquirySaveFeedback, salesAiLabel, type MessageSalesContext } from '../lib/messageSalesContext';
import { navigateToInquiry } from '../navigation/navigationRef';
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
  deleted_at: string | null;
}

interface Attachment {
  id: string;
  content_type: string | null;
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
  const [sales, setSales] = useState<MessageSalesContext>();
  const [addingInquiry, setAddingInquiry] = useState(false);
  const inquiryLock = useRef(false);
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mailboxName, setMailboxName] = useState<string | null>(null);
  const { employee } = useAuth();
  const [canTrash, setCanTrash] = useState(false);
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const attachmentBusy = useRef(false);
  const [openingAttachment, setOpeningAttachment] = useState<string | null>(null);
  const attachmentGeneration = useRef(0);
  const previewFiles = useRef(new Set<string>());
  useEffect(() => () => {
    attachmentGeneration.current++;
    const blobUtil = getBlobUtil();
    if (blobUtil) for (const path of previewFiles.current) void blobUtil.fs.unlink(path).catch(() => undefined);
    previewFiles.current.clear();
  }, [route.params.messageId]);
  const changeTrash = () => {
    if (!message || !canTrash || movingRef.current) return;
    const restore = Boolean(message.deleted_at);
    Alert.alert(restore ? 'Przywróć wiadomość' : 'Przenieś do kosza',
      'Zmiana będzie widoczna także na serwerze pocztowym i w Thunderbirdzie.', [
        { text: 'Anuluj', style: 'cancel' },
        { text: restore ? 'Przywróć' : 'Przenieś do kosza', style: restore ? 'default' : 'destructive', onPress: async () => {
          if (movingRef.current) return;
          movingRef.current = true; setMoving(true);
          try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) throw new Error('Zaloguj się ponownie.');
            const response = await fetch('https://mavinci.pl/bridge/messages/trash', {
              method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: message.id, type: 'received', action: restore ? 'restore' : 'trash' }),
            });
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.ok) throw new Error(result?.error || 'Nie potwierdzono zmiany. Ponów tę samą czynność.');
            navigation.goBack();
          } catch (error) { Alert.alert('Nie udało się potwierdzić zmiany', error instanceof Error ? error.message : 'Spróbuj ponownie.'); }
          finally { movingRef.current = false; setMoving(false); }
        } },
      ]);
  };

  const fetchMessage = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCanTrash(false);

    try {
      const { data, error: fetchError } = await supabase
        .from('received_emails')
        .select('id, from_address, to_address, subject, body_text, body_html, received_date, is_read, email_account_id, has_attachments, deleted_at')
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
      const context = await readMessageSalesContext(supabase, [{ type: 'received', id: data.id }]);
      setSales(context[`received:${data.id}`]);

      const [{ data: account }, { data: files }, { count: assignedCount }, trashAccess] = await Promise.all([
        supabase.from('employee_email_accounts').select('account_name, employee_id').eq('id', data.email_account_id).maybeSingle(),
        supabase.from('email_attachments').select('id, filename, size_bytes, storage_path, content_type')
          .eq('email_id', data.id).eq('email_type', 'received').order('created_at'),
        employee?.id
          ? supabase.from('employee_email_account_assignments').select('id', { count: 'exact', head: true })
              .eq('email_account_id', data.email_account_id).eq('employee_id', employee.id)
          : Promise.resolve({ count: 0 }),
        supabase.rpc('get_mailbox_trash_permissions'),
      ]);
      setCanTrash(!trashAccess.error && (trashAccess.data || []).includes(data.email_account_id));
      setMailboxName(account?.account_name || null);
      setAttachments((files || []) as Attachment[]);
      // Jak w CRM: status „przeczytana” zmienia tylko właściciel lub osoba przypisana do skrzynki,
      // nie administrator otwierający cudzą wiadomość.
      const ownsMailbox = Boolean(employee?.id && (account?.employee_id === employee.id || (assignedCount || 0) > 0));

      if (!data.is_read && !data.deleted_at && ownsMailbox) {
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

  const downloadAttachment = async (attachment: Attachment) => {
    const { data, error: signError } = await supabase.storage.from('email-attachments')
      .createSignedUrl(attachment.storage_path, 300, { download: attachment.filename });
    if (signError || !data?.signedUrl) throw new Error('Nie udało się pobrać załącznika.');
    await Linking.openURL(data.signedUrl);
  };

  const openAttachment = async (attachment: Attachment, downloadOnly = false) => {
    if (attachmentBusy.current) return;
    attachmentBusy.current = true; setOpeningAttachment(attachment.id);
    const generation = attachmentGeneration.current;
    let path: string | null = null;
    let headerPath: string | null = null;
    // W Expo Go nie ma modułu natywnego — wtedy otwieramy podpisany link jak przy pobieraniu.
    const ReactNativeBlobUtil = getBlobUtil();
    try {
      const format = attachmentPreview(attachment.filename, attachment.content_type);
      if (downloadOnly || !format || Platform.OS === 'web' || !ReactNativeBlobUtil) {
        await downloadAttachment(attachment); return;
      }
      const { data, error } = await supabase.storage.from('email-attachments').createSignedUrl(attachment.storage_path, 300);
      if (error || !data?.signedUrl) throw new Error('Nie udało się odczytać załącznika.');
      // Private temporary copy; never send email documents to a public viewer.
      path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/mail-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.${format.extension}`;
      headerPath = path + '.header';
      previewFiles.current.add(path); previewFiles.current.add(headerPath);
      const result = await ReactNativeBlobUtil.config({ path, timeout: 60000 }).fetch('GET', data.signedUrl);
      if (result.info().status !== 200) throw new Error('Nie udało się pobrać załącznika.');
      await ReactNativeBlobUtil.fs.slice(path, headerPath, 0, 16);
      const head = new Uint8Array(decode(await ReactNativeBlobUtil.fs.readFile(headerPath, 'base64')));
      if (generation !== attachmentGeneration.current) return;
      if (!matchesPreviewBytes(head, format.mime)) throw new Error('Ten plik nie obsługuje szybkiego podglądu. Użyj przycisku pobierania.');
      if (Platform.OS === 'ios') await ReactNativeBlobUtil.ios.openDocument(path);
      else await ReactNativeBlobUtil.android.actionViewIntent(path, format.mime, 'Podgląd załącznika');
    } catch (error) {
      if (generation === attachmentGeneration.current) Alert.alert('Podgląd załącznika', error instanceof Error ? error.message : 'Nie udało się otworzyć podglądu. Użyj przycisku pobierania.');
    } finally {
      if (headerPath && ReactNativeBlobUtil) { void ReactNativeBlobUtil.fs.unlink(headerPath).catch(() => undefined); previewFiles.current.delete(headerPath); }
      if (path && ReactNativeBlobUtil && generation !== attachmentGeneration.current) void ReactNativeBlobUtil.fs.unlink(path).catch(() => undefined);
      attachmentBusy.current = false;
      if (generation === attachmentGeneration.current) setOpeningAttachment(null);
    }
  };

  useEffect(() => {
    fetchMessage();
  }, [fetchMessage]);

  const addInquiry = async () => {
    if (!message || !employee?.id || inquiryLock.current) return;
    inquiryLock.current = true; setAddingInquiry(true);
    try {
      const { data, error } = await supabase.rpc('crm_create_inquiry_from_message', {
        p_type: 'received', p_id: message.id, p_owner: employee.id,
      });
      if (error) throw error;
      if (!data?.id) throw new Error('Serwer nie potwierdził zapisu.');
      if (data.ownerId !== employee.id) Alert.alert('Przypisanie zapytania', messageInquirySaveFeedback(data, employee.id));
      await fetchMessage();
      navigateToInquiry(data.id);
    } catch (error) { Alert.alert('Zapytanie', (error as { message?: string })?.message || 'Nie udało się zapisać zapytania.'); }
    finally { inquiryLock.current = false; setAddingInquiry(false); }
  };

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
      {hasMessageInquiry(sales) && sales?.inquiries.map(i => <TouchableOpacity key={i.id} style={styles.retryButton} onPress={() => navigateToInquiry(i.id)}><MessageInquiryBadge inquiry={i} /><Text style={{ color: colors.text.secondary }}>Otwórz zapytanie</Text></TouchableOpacity>)}
      {hasMessageInquiry(sales) && !!sales?.aiStatus && <Text style={{ color: colors.text.secondary }}>{salesAiLabel(sales.aiStatus)}</Text>}
      {!message.deleted_at && (!sales?.inquiries.length || canClaimMessageInquiry(sales)) && <TouchableOpacity disabled={addingInquiry} style={styles.retryButton} onPress={() => void addInquiry()}><Text>{addingInquiry ? 'Zapisywanie…' : canClaimMessageInquiry(sales) ? 'Przypisz mnie do zapytania' : 'Dodaj do zapytań i przypisz mnie'}</Text></TouchableOpacity>}
      {canTrash && <TouchableOpacity style={styles.retryButton} disabled={moving} onPress={changeTrash}
        accessibilityRole="button" accessibilityLabel={message.deleted_at ? 'Przywróć z kosza' : 'Przenieś do kosza'}>
        <Text style={styles.retryButtonText}>{moving ? 'Synchronizowanie…' : message.deleted_at ? 'Przywróć z kosza' : 'Przenieś do kosza'}</Text>
      </TouchableOpacity>}

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
            <View key={attachment.id} style={styles.attachmentRow}>
              <TouchableOpacity style={[styles.attachmentRow, { flex: 1 }]} disabled={Boolean(openingAttachment)} onPress={() => void openAttachment(attachment)}
                accessibilityRole="button" accessibilityLabel={`${attachmentPreview(attachment.filename, attachment.content_type) ? 'Podgląd' : 'Pobierz'} załącznika ${attachment.filename}`}>
                {openingAttachment === attachment.id ? <ActivityIndicator size="small" color={colors.primary.gold} /> : <Feather name="paperclip" size={15} color={colors.primary.gold} />}
                <Text style={styles.attachmentName} numberOfLines={1}>{attachment.filename}</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={Boolean(openingAttachment)} onPress={() => void openAttachment(attachment, true)}
                style={{ padding: spacing.sm }} accessibilityRole="button" accessibilityLabel={`Pobierz załącznik ${attachment.filename}`}>
                <Feather name="download" size={18} color={colors.primary.gold} />
              </TouchableOpacity>
            </View>
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
