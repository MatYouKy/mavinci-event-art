import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { RouteProp, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, borderRadius } from '../theme';
import { getMessageTypeLabel, getPriorityLabel } from '../lib/messageLabels';

type InboundDetailRoute = RouteProp<RootStackParamList, 'InboundEventDetail'>;

interface WebhookSource {
  name: string;
  slug: string;
}

interface InboundEvent {
  id: string;
  title: string;
  body: string | null;
  event_type: string;
  event_time: string | null;
  created_at: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  detail_url: string | null;
  metadata: Record<string, unknown> | null;
  source: WebhookSource | WebhookSource[] | null;
}

const metadataLabels: Record<string, string> = {
  name: 'Imię i nazwisko',
  email: 'E-mail',
  phone: 'Telefon',
  company: 'Firma',
  event_type: 'Rodzaj wydarzenia',
  guests: 'Liczba gości',
  preferred_date: 'Preferowany termin',
  source_page: 'Strona formularza',
};

function getSource(source: InboundEvent['source']): WebhookSource | null {
  if (Array.isArray(source)) return source[0] ?? null;
  return source;
}

function formatMetadataValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(String).join(', ');
  return null;
}

export default function InboundEventDetailScreen() {
  const route = useRoute<InboundDetailRoute>();
  const [event, setEvent] = useState<InboundEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvent = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('inbound_events')
        .select(`
          id,
          title,
          body,
          event_type,
          event_time,
          created_at,
          priority,
          detail_url,
          metadata,
          source:webhook_sources(name, slug)
        `)
        .eq('id', route.params.eventId)
        .single();

      if (fetchError) throw fetchError;
      setEvent(data as InboundEvent);
    } catch (err) {
      console.error('Error fetching inbound event:', err);
      setError('Nie udało się otworzyć wiadomości z formularza.');
    } finally {
      setLoading(false);
    }
  }, [route.params.eventId]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  const metadataRows = useMemo(() => {
    if (!event?.metadata) return [];
    return Object.entries(event.metadata)
      .map(([key, value]) => {
        const formattedValue = formatMetadataValue(value);
        const isMessageType = key === 'event_type' || key === 'type' || key === 'category';
        return {
          key,
          value: formattedValue && isMessageType
            ? getMessageTypeLabel(formattedValue)
            : formattedValue,
        };
      })
      .filter((row): row is { key: string; value: string } => !!row.value);
  }, [event?.metadata]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary.gold} />
      </View>
    );
  }

  if (!event || error) {
    return (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={42} color={colors.status.error} />
        <Text style={styles.errorText}>{error || 'Nie znaleziono wiadomości.'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchEvent}>
          <Text style={styles.retryButtonText}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const source = getSource(event.source);
  const date = event.event_time || event.created_at;
  const priorityLabel = getPriorityLabel(event.priority);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.sourceRow}>
        <View style={styles.sourceBadge}>
          <Feather name="globe" size={14} color={colors.primary.gold} />
          <Text style={styles.sourceText}>{source?.name || source?.slug || 'Formularz WWW'}</Text>
        </View>
        <Text style={styles.dateText}>
          {new Date(date).toLocaleString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      <Text style={styles.title}>{event.title}</Text>

      <View style={styles.infoRow}>
        <View style={styles.infoBadge}><Text style={styles.infoBadgeText}>{getMessageTypeLabel(event.event_type)}</Text></View>
        {event.priority !== 'normal' && (
          <View style={[styles.infoBadge, event.priority === 'critical' || event.priority === 'high' ? styles.priorityHigh : styles.priorityLow]}>
            <Text style={styles.infoBadgeText}>Priorytet: {priorityLabel}</Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Treść wiadomości</Text>
        <Text style={styles.bodyText} selectable>{event.body?.trim() || 'Brak dodatkowej treści.'}</Text>
      </View>

      {metadataRows.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Dane z formularza</Text>
          {metadataRows.map(({ key, value }) => (
            <View key={key} style={styles.metadataRow}>
              <Text style={styles.metadataLabel}>{metadataLabels[key] || key.replace(/_/g, ' ')}</Text>
              <Text style={styles.metadataValue} selectable>{value}</Text>
            </View>
          ))}
        </View>
      )}

      {!!event.detail_url && /^https?:\/\//i.test(event.detail_url) && (
        <TouchableOpacity style={styles.externalButton} onPress={() => Linking.openURL(event.detail_url!)}>
          <Feather name="external-link" size={16} color={colors.background.primary} />
          <Text style={styles.externalButtonText}>Otwórz stronę źródłową</Text>
        </TouchableOpacity>
      )}
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
  sourceBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  sourceText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: colors.primary.gold },
  dateText: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  title: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold, lineHeight: 28, color: colors.text.primary },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  infoBadge: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.background.tertiary },
  priorityHigh: { backgroundColor: colors.status.error + '30' },
  priorityLow: { backgroundColor: colors.status.info + '30' },
  infoBadgeText: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  card: { padding: spacing.md, gap: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.border.default, backgroundColor: colors.background.secondary },
  sectionTitle: { fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.primary.gold },
  bodyText: { fontSize: typography.fontSizes.md, lineHeight: 24, color: colors.text.primary },
  metadataRow: { paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border.default },
  metadataLabel: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary, textTransform: 'capitalize', marginBottom: 3 },
  metadataValue: { fontSize: typography.fontSizes.sm, lineHeight: 20, color: colors.text.primary },
  externalButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  externalButtonText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: colors.background.primary },
  errorText: { fontSize: typography.fontSizes.md, color: colors.text.secondary, textAlign: 'center' },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.primary.gold },
  retryButtonText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
});
