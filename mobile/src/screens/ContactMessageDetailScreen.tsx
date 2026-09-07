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
import { getMessageTypeLabel, getPriorityLabel, humanizeMessageEnums } from '../lib/messageLabels';

type ContactDetailRoute = RouteProp<RootStackParamList, 'ContactMessageDetail'>;

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  category: string;
  source_page: string;
  subject: string | null;
  message: string;
  status: string;
  priority: string;
  created_at: string;
}

export default function ContactMessageDetailScreen() {
  const route = useRoute<ContactDetailRoute>();
  const navigation = useNavigation<any>();
  const [message, setMessage] = useState<ContactMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('contact_messages')
        .select('id, name, email, phone, company, category, source_page, subject, message, status, priority, created_at')
        .eq('id', route.params.messageId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!data) {
        const { data: receivedEmail, error: emailLookupError } = await supabase
          .from('received_emails')
          .select('id')
          .eq('id', route.params.messageId)
          .maybeSingle();

        if (emailLookupError) throw emailLookupError;
        if (receivedEmail) {
          navigation.replace('EmailMessageDetail', { messageId: receivedEmail.id });
          return;
        }

        setError('Nie znaleziono wiadomości lub nie masz do niej dostępu.');
        return;
      }
      setMessage(data);

      if (data.status === 'new') {
        const { error: updateError } = await supabase
          .from('contact_messages')
          .update({ status: 'read', read_at: new Date().toISOString() })
          .eq('id', data.id);

        if (!updateError) setMessage((current) => current ? { ...current, status: 'read' } : current);
      }
    } catch (err) {
      console.error('Error fetching contact message details:', err);
      setError('Nie udało się otworzyć wiadomości kontaktowej.');
    } finally {
      setLoading(false);
    }
  }, [navigation, route.params.messageId]);

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.sourceRow}>
        <View style={styles.sourceBadge}>
          <Feather name="globe" size={14} color={colors.primary.gold} />
          <Text style={styles.sourceText}>mavinci.pl{message.source_page ? ` • ${message.source_page}` : ''}</Text>
        </View>
        <Text style={styles.dateText}>
          {new Date(message.created_at).toLocaleString('pl-PL', {
            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </Text>
      </View>

      <Text style={styles.title}>
        {message.subject
          ? humanizeMessageEnums(message.subject)
          : 'Wiadomość z formularza kontaktowego'}
      </Text>

      <View style={styles.badges}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{getMessageTypeLabel(message.category)}</Text>
        </View>
        {message.priority !== 'normal' && (
          <View style={[styles.badge, styles.priorityBadge]}>
            <Text style={styles.badgeText}>Priorytet: {getPriorityLabel(message.priority)}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Nadawca</Text>
        <View style={styles.infoRow}>
          <Feather name="user" size={16} color={colors.text.tertiary} />
          <Text style={styles.infoValue} selectable>{message.name}</Text>
        </View>
        {!!message.company && (
          <View style={styles.infoRow}>
            <Feather name="briefcase" size={16} color={colors.text.tertiary} />
            <Text style={styles.infoValue} selectable>{message.company}</Text>
          </View>
        )}
        <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(`mailto:${message.email}`)}>
          <Feather name="mail" size={16} color={colors.primary.gold} />
          <Text style={styles.linkValue} selectable>{message.email}</Text>
        </TouchableOpacity>
        {!!message.phone && (
          <TouchableOpacity style={styles.infoRow} onPress={() => Linking.openURL(`tel:${message.phone}`)}>
            <Feather name="phone" size={16} color={colors.primary.gold} />
            <Text style={styles.linkValue} selectable>{message.phone}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Treść wiadomości</Text>
        <Text style={styles.bodyText} selectable>{message.message}</Text>
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
  sourceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  sourceText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: colors.primary.gold, flexShrink: 1 },
  dateText: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold, lineHeight: 28, color: colors.text.primary },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.background.tertiary },
  priorityBadge: { backgroundColor: colors.status.warning + '30' },
  badgeText: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  card: { padding: spacing.md, gap: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.background.secondary },
  sectionTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.primary.gold },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoValue: { flex: 1, fontSize: typography.fontSizes.sm, lineHeight: 20, color: colors.text.primary },
  linkValue: { flex: 1, fontSize: typography.fontSizes.sm, lineHeight: 20, color: colors.primary.gold },
  bodyText: { fontSize: typography.fontSizes.md, lineHeight: 24, color: colors.text.primary },
  errorText: { fontSize: typography.fontSizes.md, color: colors.text.secondary, textAlign: 'center' },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  retryButtonText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
});
