import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Linking, Modal, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import { PORTFOLIO_LIMITS, PORTFOLIO_STATUS_LABELS, type PortfolioStatus } from '../lib/portfolioShared';
import { portfolioErrorMessage, portfolioGet, portfolioPost, type PortfolioDetail, type PortfolioHome, type PortfolioListItem } from '../lib/portfolioApi';
import PortfolioEventPicker from '../components/Portfolio/PortfolioEventPicker';

/*
 * Marketing → „Realizacje” w aplikacji (jak `/crm/marketing/portfolio` i Mac): lista realizacji portfolio strony — szkice,
 * na stronie, do opublikowania — z wyszukiwaniem i filtrem; nowa realizacja z wydarzenia albo od zera. Realizacja otwiera
 * się w karcie (`PortfolioItemScreen`) z tymi samymi polami, zdjęciami, SEO, asystentem AI i publikacją co w CRM.
 */

type Filter = 'all' | 'draft' | 'published' | 'attention';

export const PORTFOLIO_STATUS_COLORS: Record<PortfolioStatus, string> = {
  draft: colors.text.tertiary,
  published: colors.status.success,
  changed: colors.status.warning,
  conflict: colors.status.error,
};

export function PortfolioStatusBadge({ status }: { status: PortfolioStatus }) {
  const color = PORTFOLIO_STATUS_COLORS[status] || colors.text.tertiary;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{PORTFOLIO_STATUS_LABELS[status]}</Text>
    </View>
  );
}

export const portfolioDateLabel = (value: string | null) => (value ? value.slice(0, 10).split('-').reverse().join('.') : '');

export default function PortfolioScreen() {
  const navigation = useNavigation<any>();
  const [home, setHome] = useState<PortfolioHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await portfolioGet<PortfolioHome>('home');
      setHome(data);
      setError('');
    } catch (cause) {
      setError(portfolioErrorMessage(cause, 'Nie udało się pobrać realizacji.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Po powrocie z karty realizacji — świeży stan listy (publikacja, zmiany).
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pl');
    return (home?.items || [])
      .filter((item) => filter === 'all' || (filter === 'attention' ? item.status === 'changed' || item.status === 'conflict' : item.status === filter))
      .filter((item) => !needle || [item.title, item.category, item.location, item.eventName].some((value) => (value || '').toLocaleLowerCase('pl').includes(needle)))
      .sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || '') || a.title.localeCompare(b.title, 'pl'));
  }, [home, query, filter]);

  const create = async (body: { title?: string; eventId?: string }) => {
    setCreating(false);
    setBusy('Tworzę realizację');
    try {
      const detail = await portfolioPost<PortfolioDetail>('create', body);
      setNewTitle('');
      navigation.navigate('PortfolioItem', { id: detail.item.id });
    } catch (cause) {
      Alert.alert('Realizacje', portfolioErrorMessage(cause, 'Nie udało się utworzyć realizacji.'));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !home) {
    return <View style={styles.center}><ActivityIndicator color={colors.primary.gold} size="large" /></View>;
  }
  if (error && !home) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity style={[styles.secondary, { marginTop: spacing.md, paddingHorizontal: spacing.lg }]} onPress={() => { setLoading(true); void load(); }}>
          <Text style={styles.secondaryText}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const filters: Array<[Filter, string]> = [
    ['all', `Wszystkie (${home?.items.length || 0})`],
    ['draft', `Szkic (${home?.counts.draft || 0})`],
    ['published', `Na stronie (${home?.counts.published || 0})`],
    ['attention', `Do opublikowania (${home?.counts.changed || 0})`],
  ];

  const renderItem = ({ item }: { item: PortfolioListItem }) => (
    <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('PortfolioItem', { id: item.id })}>
      {item.thumbnailUrl
        ? <Image source={{ uri: item.thumbnailUrl }} style={styles.thumb} />
        : <View style={[styles.thumb, styles.placeholder]}><Feather name="image" size={20} color={colors.text.tertiary} /></View>}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
          <Text style={[styles.body, { flex: 1 }]} numberOfLines={2}>{item.title}</Text>
          {item.isFeatured && <Feather name="star" size={14} color={colors.primary.gold} />}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <PortfolioStatusBadge status={item.status} />
          {item.problems > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
              <Feather name="alert-triangle" size={12} color={colors.status.warning} />
              <Text style={[styles.muted, { color: colors.status.warning }]}>{item.problems}</Text>
            </View>
          )}
        </View>
        <Text style={styles.muted} numberOfLines={1}>{[portfolioDateLabel(item.eventDate), item.category, `${item.photos} zdj.`].filter(Boolean).join(' · ')}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary.gold} onRefresh={() => { setRefreshing(true); void load(); }} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={(
          <View style={{ gap: spacing.sm, marginBottom: spacing.xs }}>
            <Text style={styles.muted}>Portfolio na stronie mavinci.pl — kopie robocze, zdjęcia, opisy, SEO i publikacja.</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={() => setCreating(true)}>
                <Feather name="plus" size={16} color={colors.background.primary} />
                <Text style={styles.primaryText}>Nowa realizacja</Text>
              </TouchableOpacity>
              {!!home?.siteUrl && (
                <TouchableOpacity style={[styles.secondary, { paddingHorizontal: spacing.md }]} onPress={() => { void Linking.openURL(home.siteUrl); }}>
                  <Feather name="external-link" size={16} color={colors.primary.gold} />
                  <Text style={styles.secondaryText}>Strona</Text>
                </TouchableOpacity>
              )}
            </View>
            <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Szukaj realizacji" placeholderTextColor={colors.text.tertiary} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {filters.map(([key, label]) => (
                <TouchableOpacity key={key} onPress={() => setFilter(key)} style={[styles.chip, filter === key && styles.chipActive]}>
                  <Text style={[styles.chipText, filter === key && { color: colors.primary.gold }]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={[styles.muted, { padding: spacing.md }]}>Brak realizacji w tym widoku.</Text>}
      />

      <PortfolioEventPicker
        visible={creating}
        title="Nowa realizacja"
        onClose={() => setCreating(false)}
        onPick={(event) => { void create({ eventId: event.id }); }}
        footer={(
          <View style={{ gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border.default, paddingTop: spacing.sm }}>
            <Text style={styles.muted}>Z eventu: tytuł, data, miejsce i rodzaj. Albo od zera:</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <TextInput style={[styles.input, { flex: 1 }]} value={newTitle} onChangeText={(value) => setNewTitle(value.slice(0, PORTFOLIO_LIMITS.title))}
                placeholder="Tytuł realizacji" placeholderTextColor={colors.text.tertiary}
                onSubmitEditing={() => { if (newTitle.trim()) void create({ title: newTitle.trim() }); }} />
              <TouchableOpacity style={[styles.primary, { paddingHorizontal: spacing.md }]} disabled={!newTitle.trim()} onPress={() => { void create({ title: newTitle.trim() }); }}>
                <Text style={styles.primaryText}>Utwórz</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <Modal visible={busy !== null} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modal, { alignItems: 'center' }]}>
            <ActivityIndicator color={colors.primary.gold} size="large" />
            <Text style={styles.body}>{busy}…</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary, padding: spacing.lg },
  card: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default },
  thumb: { width: 84, height: 64, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  input: { borderWidth: 1, borderColor: colors.border.hover, borderRadius: borderRadius.md, padding: spacing.sm, color: colors.text.primary, backgroundColor: colors.background.tertiary, fontSize: typography.fontSizes.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.default },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: 'rgba(211,187,115,0.12)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  badge: { borderWidth: 1, borderRadius: borderRadius.full, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontSize: 11 },
  primary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm + 2, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { width: '100%', backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.sm },
});
