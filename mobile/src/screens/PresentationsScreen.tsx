import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography, shade } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import ReorderableList from '../components/ReorderableList';
import { useNotice } from '../components/Inquiries/InquiryKit';
import { resetShowcaseLayout, saveShowcaseLayout, showcaseHome } from '../lib/showcaseApi';
import { localizeShowcaseUrls, subscribeShowcaseOffline, type ShowcaseOfflineStatus } from '../lib/showcaseOffline';
import {
  showcaseLayoutHide, showcaseLayoutReorder, showcaseVisibleForMe,
  type ShowcaseHome, type ShowcaseItemSummary, type ShowcaseSectionView,
} from '../lib/showcaseShared';

/*
 * Strefa sprzedawcy → „Prezentacje” w aplikacji (jak w CRM i na Macu): działy i karty na spotkania z klientami, wyszukiwanie
 * we wszystkich kartach; karta otwiera się tak, jak zobaczy ją klient (zdjęcia, korzyści, warianty, przygotowanie, pytania).
 * „Układ” — własny układ pracownika: kolejność działów i kart (przeciąganie za uchwyt) i ukrywanie u siebie (oko); ten sam
 * zapis w CRM, na Macu, telefonie i iPadzie, inni widzą swój układ. Prezentacje zapisują się w pamięci urządzenia (karty
 * i zdjęcia) — bez internetu pokaz działa z pamięci. Przygotowanie kart (treść, działy kart) — w CRM i na Macu.
 */

const bySort = <T extends { sortOrder: number; title: string }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl');

const cardsLabel = (count: number) =>
  `${count} ${count === 1 ? 'karta' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'karty' : 'kart'}`;

const formatBytes = (bytes: number) => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1).replace('.', ',')} GB`;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1).replace('.', ',')} MB`;
};

export default function PresentationsScreen() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const { session } = useAuth();
  const user = session?.user.id ?? null;
  const notice = useNotice();
  const [home, setHome] = useState<ShowcaseHome | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [arranging, setArranging] = useState(false);
  const [arrangeId, setArrangeId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sync, setSync] = useState<ShowcaseOfflineStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await showcaseHome(user);
      setHome(result.home);
      setOffline(result.offline);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać prezentacji.');
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeShowcaseOffline(setSync), []);

  // Po zapisaniu zdjęć w pamięci miniatury listy idą już z dysku.
  const syncState = sync?.state;
  useEffect(() => {
    if (syncState && syncState !== 'syncing') setHome((current) => (current ? { ...current, urls: localizeShowcaseUrls(current.urls) } : current));
  }, [syncState]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Na spotkaniu — bez działów i kart ukrytych w układzie pracownika.
  const mine = useMemo(() => (home ? showcaseVisibleForMe(home) : null), [home]);
  const sections = useMemo(() => [...(mine?.sections || [])].sort(bySort), [mine]);
  const selected = sections.find((section) => section.id === sectionId) || sections[0] || null;
  const needle = query.trim().toLocaleLowerCase('pl');
  const items = useMemo(() => {
    const all = mine?.items || [];
    if (needle) return all.filter((item) => [item.title, item.tagline, ...item.productNames].some((value) => value.toLocaleLowerCase('pl').includes(needle)));
    return all.filter((item) => item.sectionId === selected?.id).sort(bySort);
  }, [mine, needle, selected]);
  const columns = width >= 700 ? 2 : 1;

  // Układ: wszystkie działy i karty (także ukryte u pracownika).
  const allSections = useMemo(() => [...(home?.sections || [])].sort(bySort), [home]);
  const arrangeSection = allSections.find((section) => section.id === arrangeId) || allSections[0] || null;
  const arrangeItems = useMemo(
    () => (home && arrangeSection ? home.items.filter((item) => item.sectionId === arrangeSection.id).sort(bySort) : []),
    [home, arrangeSection],
  );

  const openArrange = () => {
    if (!home) return;
    if (offline) { notice.notify('Układ zmienisz po połączeniu z internetem — zapisuje się na koncie (CRM, Mac, telefon, iPad).', true); return; }
    if (home.personal !== true) { notice.notify('Własny układ prezentacji będzie dostępny po aktualizacji CRM i bazy.', true); return; }
    setArrangeId(selected?.id ?? null);
    setArranging(true);
  };

  /** Zmiana układu od razu na liście, zapis w tle; błąd — lista z serwera. */
  const applyLayout = (next: ShowcaseHome, message: string) => {
    setHome(next);
    void saveShowcaseLayout(next, user)
      .then(() => notice.notify(message))
      .catch((cause) => {
        notice.notify(cause instanceof Error ? cause.message : 'Nie udało się zapisać układu.', true);
        void load();
      });
  };

  const moveIds = <T extends { id: string }>(rows: T[], from: number, to: number) => {
    const ids = rows.map((row) => row.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    return ids;
  };

  const moveSection = (from: number, to: number) => {
    if (home) applyLayout(showcaseLayoutReorder(home, null, moveIds(allSections, from, to)), 'Zmieniono kolejność działów w Twoim układzie');
  };
  const moveItem = (from: number, to: number) => {
    if (home && arrangeSection) applyLayout(showcaseLayoutReorder(home, arrangeSection.id, moveIds(arrangeItems, from, to)), 'Zmieniono kolejność kart w Twoim układzie');
  };
  const toggleHidden = (kind: 'section' | 'item', id: string, hidden: boolean) => {
    if (!home) return;
    const section = kind === 'section';
    applyLayout(showcaseLayoutHide(home, kind, id, hidden), hidden
      ? `${section ? 'Dział ukryty' : 'Karta ukryta'} w Twoim układzie (inni widzą swój układ).`
      : `${section ? 'Dział znów widoczny' : 'Karta znów widoczna'} w Twoim układzie.`);
  };
  const resetLayout = async () => {
    const result = await notice.run('Przywracam układ domyślny…', () => resetShowcaseLayout(user), 'Przywrócono układ domyślny');
    if (result) {
      setHome(result.home);
      setOffline(result.offline);
    }
  };

  if (!home) {
    return (
      <View style={styles.center}>
        {error ? <Text style={[styles.muted, styles.centerText]}>{error}</Text> : <ActivityIndicator color={colors.primary.gold} />}
        {error ? <TouchableOpacity onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>Spróbuj ponownie</Text></TouchableOpacity> : null}
      </View>
    );
  }

  const eye = (hidden: boolean, label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} hitSlop={8} style={styles.eye} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={hidden ? 'eye-off' : 'eye'} size={18} color={hidden ? colors.text.tertiary : colors.primary.gold} />
    </TouchableOpacity>
  );

  if (arranging) {
    const wide = width >= 900;
    const sectionRow = (section: ShowcaseSectionView, _: number, handle: React.ReactNode) => {
      const count = home.items.filter((item) => item.sectionId === section.id).length;
      const active = section.id === arrangeSection?.id;
      return (
        <View style={[styles.arrangeRow, active && styles.arrangeRowActive]}>
          {handle}
          <TouchableOpacity style={[styles.flex, section.hiddenForMe && styles.dim]} onPress={() => setArrangeId(section.id)}
            accessibilityRole="button" accessibilityLabel={`Karty działu ${section.title}`} accessibilityState={{ selected: active }}>
            <Text style={[styles.rowTitle, active && styles.rowTitleActive]} numberOfLines={1}>{section.title}</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {cardsLabel(count)}{section.isActive ? '' : ' · ukryty dla wszystkich'}{section.hiddenForMe ? ' · ukryty u Ciebie' : ''}
            </Text>
          </TouchableOpacity>
          {eye(Boolean(section.hiddenForMe), section.hiddenForMe ? `Pokaż dział ${section.title} w swoim układzie` : `Ukryj dział ${section.title} w swoim układzie`,
            () => toggleHidden('section', section.id, !section.hiddenForMe))}
        </View>
      );
    };
    const itemRow = (item: ShowcaseItemSummary, _: number, handle: React.ReactNode) => {
      const thumb = item.thumbKey ? home.urls[item.thumbKey]?.thumb : null;
      return (
        <View style={styles.arrangeRow}>
          {handle}
          <View style={[styles.arrangeBody, item.hiddenForMe && styles.dim]}>
            {thumb ? <Image source={{ uri: thumb }} style={styles.arrangeThumb} /> : <View style={[styles.arrangeThumb, styles.thumbEmpty]}><Feather name="image" size={16} color={colors.primary.gold} /></View>}
            <View style={styles.flex}>
              <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
              {item.hiddenForMe || !item.isActive ? (
                <Text style={styles.muted} numberOfLines={1}>{[!item.isActive && 'ukryta dla wszystkich', item.hiddenForMe && 'ukryta u Ciebie'].filter(Boolean).join(' · ')}</Text>
              ) : null}
            </View>
          </View>
          {eye(Boolean(item.hiddenForMe), item.hiddenForMe ? `Pokaż kartę ${item.title} w swoim układzie` : `Ukryj kartę ${item.title} w swoim układzie`,
            () => toggleHidden('item', item.id, !item.hiddenForMe))}
        </View>
      );
    };
    return (
      <View style={styles.container}>
        <View style={styles.arrangeBar}>
          <View style={styles.flex}>
            <Text style={styles.arrangeTitle}>Twój układ</Text>
            <Text style={styles.muted}>Przeciągnij za uchwyt, żeby zmienić kolejność; oko ukrywa u Ciebie. Inni widzą swój układ.</Text>
          </View>
          {home.layout ? (
            <TouchableOpacity onPress={() => void resetLayout()} style={styles.barButton} accessibilityRole="button" accessibilityLabel="Przywróć układ domyślny">
              <Feather name="rotate-ccw" size={15} color={colors.text.secondary} />
              {width >= 500 ? <Text style={styles.barButtonText}>Układ domyślny</Text> : null}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => setArranging(false)} style={[styles.barButton, styles.barButtonPrimary]} accessibilityRole="button">
            <Feather name="check" size={15} color={colors.background.primary} />
            <Text style={[styles.barButtonText, styles.barButtonTextPrimary]}>Gotowe</Text>
          </TouchableOpacity>
        </View>
        <ScrollView scrollEnabled={!dragging} contentContainerStyle={[styles.arrange, wide && styles.arrangeWide]}>
          <View style={wide ? styles.arrangeColumn : undefined}>
            <Text style={styles.groupTitle}>Działy</Text>
            {allSections.length ? (
              <ReorderableList items={allSections} keyOf={(section) => section.id} onMove={moveSection} onDragChange={setDragging} gap={spacing.sm} renderItem={sectionRow} />
            ) : <Text style={styles.empty}>Brak działów.</Text>}
          </View>
          <View style={wide ? styles.arrangeColumn : styles.arrangeCards}>
            <Text style={styles.groupTitle} numberOfLines={2}>{arrangeSection ? `Karty działu „${arrangeSection.title}”` : 'Karty'}</Text>
            {arrangeSection?.hiddenForMe ? <Text style={styles.note}>Dział jest ukryty u Ciebie — jego karty nie pokazują się na Twoich spotkaniach.</Text> : null}
            {!wide && allSections.length > 1 ? <Text style={styles.note}>Dotknij działu powyżej, żeby ułożyć jego karty.</Text> : null}
            {arrangeItems.length ? (
              <ReorderableList items={arrangeItems} keyOf={(item) => item.id} onMove={moveItem} onDragChange={setDragging} gap={spacing.sm} renderItem={itemRow} />
            ) : <Text style={styles.empty}>Ten dział nie ma jeszcze kart.</Text>}
          </View>
        </ScrollView>
        {notice.overlay}
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

  const syncing = sync?.state === 'syncing';
  const status = offline ? (
    <View style={styles.status}>
      <Feather name="wifi-off" size={14} color={colors.primary.gold} />
      <Text style={[styles.statusText, styles.flex]}>Bez internetu — pokaz z pamięci urządzenia.</Text>
    </View>
  ) : syncing && sync ? (
    <View style={styles.status}>
      <ActivityIndicator size="small" color={colors.primary.gold} />
      <View style={styles.flex}>
        <Text style={styles.statusText} numberOfLines={1}>{sync.message}{sync.total ? ` ${Math.min(sync.done, sync.total)}/${sync.total}` : ''}</Text>
        {sync.total ? <View style={styles.progress}><View style={[styles.progressFill, { width: `${Math.round((Math.min(sync.done, sync.total) / sync.total) * 100)}%` }]} /></View> : null}
      </View>
    </View>
  ) : sync?.state === 'error' ? (
    <View style={styles.status}>
      <Feather name="alert-triangle" size={14} color={colors.status.error} />
      <Text style={[styles.statusText, styles.flex]}>{sync.message}</Text>
    </View>
  ) : sync && sync.itemsTotal > 0 && sync.itemsSaved >= sync.itemsTotal ? (
    <View style={styles.status}>
      <Feather name="check-circle" size={14} color={colors.status.success} />
      <Text style={[styles.statusText, styles.flex]}>{`Zapisano w pamięci urządzenia — działa bez internetu${sync.bytes ? ` (${formatBytes(sync.bytes)})` : ''}.`}</Text>
    </View>
  ) : null;

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <View style={styles.searchBox}>
          <Feather name="search" size={16} color={colors.text.tertiary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Szukaj we wszystkich kartach" placeholderTextColor={colors.text.tertiary}
            style={styles.search} autoCorrect={false} />
          {query ? <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}><Feather name="x" size={16} color={colors.text.tertiary} /></TouchableOpacity> : null}
        </View>
        <TouchableOpacity onPress={openArrange} style={[styles.barButton, offline && styles.dim]} accessibilityRole="button" accessibilityLabel="Twój układ prezentacji">
          <Feather name="sliders" size={15} color={colors.primary.gold} />
          <Text style={[styles.barButtonText, { color: colors.primary.gold }]}>Układ</Text>
        </TouchableOpacity>
      </View>
      {status}
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
        ListEmptyComponent={<Text style={styles.empty}>{needle ? 'Brak kart pasujących do wyszukiwania.'
          : sections.length ? 'Ten dział nie ma jeszcze kart (albo wszystkie są ukryte w Twoim układzie).'
          : home.sections.length ? 'Wszystkie działy są ukryte w Twoim układzie — „Układ”, żeby je pokazać.'
          : 'Brak działów — prezentacje przygotowuje się w CRM albo na Macu.'}</Text>}
        ListFooterComponent={home.access.manage ? <Text style={styles.footer}>Działy i karty przygotujesz w CRM (Strefa sprzedawcy → Prezentacje) albo w aplikacji na Maca.</Text> : null}
      />
      {notice.overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.background.primary, padding: spacing.lg },
  centerText: { textAlign: 'center' },
  retry: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.hover },
  retryText: { color: colors.primary.gold },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, marginBottom: spacing.sm },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default,
  },
  search: { flex: 1, color: colors.text.primary, paddingVertical: 10, fontSize: typography.fontSizes.md },
  barButton: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colors.border.hover,
  },
  barButtonPrimary: { backgroundColor: colors.primary.gold, borderColor: colors.primary.gold },
  barButtonText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  barButtonTextPrimary: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.sm },
  statusText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  progress: { height: 3, borderRadius: 2, backgroundColor: shade(0.3), marginTop: 4, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: colors.primary.gold },
  chipsBar: { flexGrow: 0 },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border.hover },
  chipActive: { backgroundColor: 'rgba(211,187,115,0.2)', borderColor: colors.primary.gold },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  chipTextActive: { color: colors.primary.gold },
  list: { padding: spacing.md, paddingTop: spacing.xs, gap: spacing.md },
  subtitle: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, marginBottom: spacing.sm },
  card: { borderRadius: borderRadius.lg, overflow: 'hidden', backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default },
  thumb: { width: '100%', aspectRatio: 16 / 10, backgroundColor: shade(0.3) },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: spacing.md, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  tagline: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  empty: { color: colors.text.tertiary, textAlign: 'center', padding: spacing.xl },
  footer: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textAlign: 'center', paddingVertical: spacing.lg },
  dim: { opacity: 0.5 },
  arrangeBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.default,
  },
  arrangeTitle: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.medium },
  arrange: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  arrangeWide: { flexDirection: 'row', alignItems: 'flex-start' },
  arrangeColumn: { flex: 1, minWidth: 0 },
  arrangeCards: { marginTop: spacing.sm },
  groupTitle: { color: colors.text.secondary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, marginBottom: spacing.sm },
  note: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, marginBottom: spacing.sm },
  arrangeRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs,
    borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default,
  },
  arrangeRowActive: { borderColor: colors.primary.gold },
  arrangeBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  arrangeThumb: { width: 56, height: 36, borderRadius: 6, backgroundColor: shade(0.3) },
  rowTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  rowTitleActive: { color: colors.primary.gold },
  eye: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
