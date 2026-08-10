import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, borderRadius } from '../theme';

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
  const [message, setMessage] = useState<EmailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessage = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('received_emails')
        .select('id, from_address, to_address, subject, body_text, body_html, received_date, is_read')
        .eq('id', route.params.messageId)
        .single();

      if (fetchError) throw fetchError;
      setMessage(data);

      if (!data.is_read) {
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
  }, [route.params.messageId]);

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
  errorText: { fontSize: typography.fontSizes.md, color: colors.text.secondary, textAlign: 'center' },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  retryButtonText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
});
