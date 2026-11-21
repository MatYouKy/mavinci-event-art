import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { portfolioErrorMessage, portfolioGet, type PortfolioEvent } from '../../lib/portfolioApi';

/*
 * Wybór wydarzenia w „Realizacjach” (nowa realizacja z wydarzenia albo powiązanie realizacji) — wyszukiwanie po nazwie,
 * najnowsze najpierw (`GET /portfolio?op=events`, dostęp jak w CRM).
 */

export function portfolioEventSummary(event: PortfolioEvent) {
  const date = event.date ? event.date.slice(0, 10).split('-').reverse().join('.') : '';
  return [date, event.location, event.category].filter(Boolean).join(' · ');
}

export default function PortfolioEventPicker({ visible, title, onClose, onPick, footer }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onPick: (event: PortfolioEvent) => void;
  footer?: React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      portfolioGet<{ events: PortfolioEvent[] }>('events', { q: query.trim() })
        .then((data) => { if (active) { setEvents(data.events); setProblem(''); } })
        .catch((cause) => { if (active) { setEvents([]); setProblem(portfolioErrorMessage(cause, 'Nie udało się pobrać wydarzeń.')); } })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [visible, query]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Feather name="x" size={22} color={colors.text.primary} /></TouchableOpacity>
          </View>
          <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Szukaj wydarzenia" placeholderTextColor={colors.text.tertiary} />
          {loading && <ActivityIndicator color={colors.primary.gold} style={{ marginVertical: spacing.sm }} />}
          {!!problem && <Text style={styles.muted}>{problem}</Text>}
          <FlatList
            data={events}
            keyExtractor={(event) => event.id}
            keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0, maxHeight: 360 }}
            ListEmptyComponent={!loading && !problem ? <Text style={styles.muted}>Brak wydarzeń.</Text> : null}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.row} onPress={() => onPick(item)}>
                <Feather name="calendar" size={16} color={colors.primary.gold} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.body} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.muted} numberOfLines={1}>{portfolioEventSummary(item)}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
          {footer}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background.elevated, borderTopLeftRadius: borderRadius.xl, borderTopRightRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm, maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.default },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
});
