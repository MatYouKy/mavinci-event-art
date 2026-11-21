import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import { showcaseHome } from '../lib/showcaseApi';
import type { ShowcaseHome, ShowcaseItemSummary } from '../lib/showcaseShared';

/*
 * Strefa sprzedawcy → „Prezentacje” w aplikacji (jak w CRM i na Macu): działy i karty na spotkania z klientami, wyszukiwanie
 * we wszystkich kartach; karta otwiera się tak, jak zobaczy ją klient (zdjęcia, korzyści, warianty, przygotowanie, pytania).
 * Przygotowanie kart — w CRM i na Macu. Tryb prezentacji na iPadzie w poziomie i pobieranie offline — kolejny etap.
 */

export default function PresentationsScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const [home, setHome] = useState<ShowcaseHome | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setHome(await showcaseHome());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać prezentacji.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sections = useMemo(() => [...(home?.sections || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl')), [home]);
  const selected = sections.find((section) => section.id === sectionId) || sections[0] || null;
  const needle = query.trim().toLocaleLowerCase('pl');
  const items = useMemo(() => {
    const all = home?.items || [];
    if (needle) return all.filter((item) => [item.title, item.tagline, ...item.productNames].some((value) => value.toLocaleLowerCase('pl').includes(needle)));
    return all.filter((item) => item.sectionId === selected?.id).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl'));
  }, [home, needle, selected]);
  const columns = width >= 700 ? 2 : 1;

  if (!home) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary.gold} />}
        {error ? <TouchableOpacity onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Spróbuj ponownie</Text></TouchableOpacity> : null}
      </View>
    );
  }

  const renderItem = ({ item }: { item: ShowcaseItemSummary }) => {
    const thumb = item.thumbKey ? home.urls[item.thumbKey]?.thumb : null;
    return (
      <TouchableOpacity style={[styles.card, columns > 1 && { flex: 1 / columns }]} onPress={() => navigation.navigate('Presentation', { id: item.id, title: item.title })}
        accessibilityRole="button" accessibilityLabel={`Otwórz kartę ${item.title}`}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Feather name="image" size={28} color={colors.primary.gold} /></View>}
        <View style={styles.cardBody}>
          <View style={styles.row}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
            {!item.isActive && <Feather name="eye-off" size={14} color={colors.text.tertiary} />}
          </View>
          {item.tagline ? <Text style={styles.tagline} numberOfLines={2}>{item.tagline}</Text> : null}
          {needle ? <Text style={styles.muted}>{sections.find((section) => section.id === item.sectionId)?.title}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Feather name="search" size={16} color={colors.text.tertiary} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Szukaj we wszystkich kartach" placeholderTextColor={colors.text.tertiary}
          style={styles.search} autoCorrect={false} />
        {query ? <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}><Feather name="x" size={16} color={colors.text.tertiary} /></TouchableOpacity> : null}
      </View>
      {!needle && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipsBar}>
          {sections.map((section) => {
            const active = section.id === selected?.id;
            return (
              <TouchableOpacity key={section.id} onPress={() => setSectionId(section.id)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{section.title}{section.isActive ? '' : ' · ukryty'}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      <FlatList
        key={`columns-${columns}`}
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? { gap: spacing.md } : undefined}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary.gold} />}
        ListHeaderComponent={selected && !needle && selected.subtitle ? <Text style={styles.subtitle}>{selected.subtitle}</Text> : null}
        ListEmptyComponent={<Text style={styles.empty}>{needle ? 'Brak kart pasujących do wyszukiwania.' : sections.length ? 'Ten dział nie ma jeszcze kart.' : 'Brak działów — prezentacje przygotowuje się w CRM albo na Macu.'}</Text>}
        ListFooterComponent={home.access.manage ? <Text style={styles.footer}>Działy i karty przygotujesz w CRM (Strefa sprzedawcy → Prezentacje) albo w aplikacji na Maca.</Text> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background.primary, padding: spacing.lg },
  retry: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.hover },
  retryText: { color: colors.primary.gold },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, marginBottom: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default,
  },
  search: { flex: 1, color: colors.text.primary, paddingVertical: 10, fontSize: typography.fontSizes.md },
  chipsBar: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border.hover },
  chipActive: { backgroundColor: 'rgba(211,187,115,0.2)', borderColor: colors.primary.gold },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  chipTextActive: { color: colors.primary.gold },
  list: { padding: spacing.md, paddingTop: spacing.xs, gap: spacing.md },
  subtitle: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, marginBottom: spacing.sm },
  card: { borderRadius: borderRadius.lg, overflow: 'hidden', backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default },
  thumb: { width: '100%', aspectRatio: 16 / 10, backgroundColor: 'rgba(0,0,0,0.3)' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: spacing.md, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  tagline: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  empty: { color: colors.text.tertiary, textAlign: 'center', padding: spacing.xl },
  footer: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textAlign: 'center', paddingVertical: spacing.lg },
});
