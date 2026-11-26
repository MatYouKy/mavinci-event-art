import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, BackHandler, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { NoticeScope, useNotice } from '../components/Inquiries/InquiryKit';
import RentalDetailView from '../components/Rental/RentalDetailView';
import { RentalFormSheet } from '../components/Rental/RentalSheets';
import { RentalPill, RentalStatusBadge, ui } from '../components/Rental/rentalUi';
import { hasPermission, RENTAL_PERMISSIONS } from '../lib/permissions';
import { supabase } from '../lib/supabase';
import {
  listRentals, loadRentalAccess, rentalDateTime, rentalErrorMessage, rentalMoney, type RentalAccess, type RentalListRow, type RentalStatus,
} from '../lib/rental';
import { borderRadius, colors, spacing, typography, withAlpha } from '../theme';

/*
 * Rental → Wypożyczenia klientom w telefonie — jak `/crm/rental` i ekran na Macu: zakładki W toku / Szkice / Do rozliczenia /
 * Archiwum / Wszystkie (z licznikami), wyszukiwanie (numer, nazwa, klient), „Tylko moje” (sprzedaż), „Nowe wypożyczenie”;
 * wiersz: termin, status, po terminie, rozbieżności, sprzęt u klienta, brutto (tylko sprzedaż). Karta — `RentalDetailView`
 * (magazyn: protokoły wydania i odbioru ze zdjęciami z aparatu, skan podpisanego protokołu, rozbieżności). Dostęp liczy baza.
 */

type Tab = 'active' | 'draft' | 'returned' | 'archive' | 'all';
const TABS: Array<{ id: Tab; label: string; statuses: RentalStatus[] | null }> = [
  { id: 'active', label: 'W toku', statuses: ['reserved', 'issued'] },
  { id: 'draft', label: 'Szkice', statuses: ['draft'] },
  { id: 'returned', label: 'Do rozliczenia', statuses: ['returned'] },
  { id: 'archive', label: 'Archiwum', statuses: ['settled', 'cancelled'] },
  { id: 'all', label: 'Wszystkie', statuses: null },
];

type Params = { rentalId?: string; requestId?: number } | undefined;

export default function RentalScreen() {
  const route = useRoute<{ key: string; name: string; params?: Params }>();
  const { employee } = useAuth();
  const notice = useNotice();
  const allowed = RENTAL_PERMISSIONS.some((scope) => hasPermission(employee, scope));
  const [rentals, setRentals] = useState<RentalListRow[]>([]);
  const [access, setAccess] = useState<RentalAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** Wypożyczenie utworzone przed chwilą — karta otwiera od razu katalog magazynu. */
  const [catalogFor, setCatalogFor] = useState<string | null>(null);

  // Powiadomienie / link: karta wskazanego wypożyczenia (albo lista).
  useEffect(() => {
    if (route.params?.rentalId) setOpenedId(route.params.rentalId);
    else if (route.params?.requestId) setOpenedId(null);
  }, [route.params?.rentalId, route.params?.requestId]);

  const load = useCallback(async (pull = false, signal?: AbortSignal) => {
    if (!allowed) return;
    if (pull) setRefreshing(true);
    try {
      const [nextAccess, rows] = await Promise.all([loadRentalAccess(supabase), listRentals(supabase, mine ? { mine: true } : {})]);
      if (signal?.aborted) return;
      setAccess(nextAccess);
      setRentals(rows);
      setError(null);
    } catch (cause) {
      if (!signal?.aborted) setError(rentalErrorMessage(cause, 'Nie udało się pobrać wypożyczeń.'));
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [allowed, mine]);

  useForegroundEffect((signal) => {
    void load(false, signal);
    const timer = setInterval(() => { if (!signal.aborted) void load(false, signal); }, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // Android: „wstecz” z karty wraca do listy.
  useEffect(() => {
    if (!openedId) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setOpenedId(null); return true; });
    return () => subscription.remove();
  }, [openedId]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((item) => [
    item.id, rentals.filter((row) => !item.statuses || item.statuses.includes(row.status)).length,
  ])) as Record<Tab, number>, [rentals]);

  const visible = useMemo(() => {
    const statuses = TABS.find((item) => item.id === tab)?.statuses ?? null;
    const text = search.trim().toLocaleLowerCase('pl-PL');
    return rentals.filter((row) => (!statuses || statuses.includes(row.status))
      && (!text || `${row.number} ${row.title} ${row.client_name}`.toLocaleLowerCase('pl-PL').includes(text)));
  }, [rentals, tab, search]);

  if (!allowed) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Feather name="lock" size={40} color={colors.text.tertiary} />
        <Text style={[ui.muted, styles.emptyText]}>Rental wymaga dostępu do ofert (sprzedaż) albo magazynu.</Text>
      </View>
    );
  }

  const renderRow = ({ item }: { item: RentalListRow }) => (
    <TouchableOpacity style={styles.row} onPress={() => setOpenedId(item.id)} accessibilityRole="button" accessibilityLabel={`Wypożyczenie ${item.number}`}>
      <View style={ui.between}>
        <View style={ui.flex}>
          <Text style={styles.number}>{item.number}</Text>
          {item.title ? <Text style={ui.muted} numberOfLines={1}>{item.title}</Text> : null}
        </View>
        <RentalStatusBadge status={item.status} />
      </View>
      <Text style={ui.text} numberOfLines={1}>{item.client_name}</Text>
      <View style={ui.row}>
        {item.handover === 'delivery' ? <Feather name="truck" size={13} color={colors.primary.gold} /> : null}
        <Text style={[ui.muted, item.overdue && ui.danger]}>{rentalDateTime(item.starts_at)} – {rentalDateTime(item.ends_at)}</Text>
      </View>
      <View style={ui.wrap}>
        {item.overdue ? <RentalPill label="Po terminie" color="#fca5a5" /> : null}
        {item.open_issues > 0 ? <RentalPill label={`Rozbieżności: ${item.open_issues}`} color="#f59e0b" /> : null}
        <Text style={ui.mutedXs}>{item.items_count} poz. · {item.quantity} szt.{item.out_qty > 0 ? ` · u klienta ${item.out_qty}` : ''}</Text>
        {item.seller_name ? <Text style={ui.mutedXs}>· {item.seller_name}</Text> : null}
      </View>
      {access?.sales_view && item.sales ? <Text style={[ui.money, styles.gross]}>{rentalMoney(item.sales.totals.gross)} brutto</Text> : null}
    </TouchableOpacity>
  );

  return (
    <NoticeScope value={notice.scope}>
      <View style={styles.container}>
        {openedId ? (
          <RentalDetailView id={openedId} notice={notice} openCatalog={catalogFor === openedId} onCatalogOpened={() => setCatalogFor(null)}
            onBack={() => setOpenedId(null)} onChanged={() => void load()} />
        ) : (
          <>
            <View style={styles.filters}>
              <View style={styles.searchRow}>
                <View style={styles.searchBox}>
                  <Feather name="search" size={16} color={colors.text.tertiary} />
                  <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="Numer, nazwa lub klient"
                    placeholderTextColor={colors.text.tertiary} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" />
                </View>
                {access?.create ? (
                  <TouchableOpacity style={styles.newButton} onPress={() => setCreating(true)} accessibilityRole="button" accessibilityLabel="Nowe wypożyczenie">
                    <Feather name="plus" size={18} color={colors.background.primary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {TABS.map((item) => (
                  <TouchableOpacity key={item.id} onPress={() => setTab(item.id)} style={[styles.chip, tab === item.id && styles.chipActive]}
                    accessibilityRole="tab" accessibilityState={{ selected: tab === item.id }}>
                    <Text style={[styles.chipText, tab === item.id && styles.chipTextActive]}>{item.label} {counts[item.id]}</Text>
                  </TouchableOpacity>
                ))}
                {access?.sales_view ? (
                  <TouchableOpacity onPress={() => setMine((value) => !value)} style={[styles.chip, mine && styles.chipActive]}
                    accessibilityRole="checkbox" accessibilityState={{ checked: mine }}>
                    <Feather name={mine ? 'check-square' : 'square'} size={13} color={mine ? colors.primary.gold : colors.text.secondary} />
                    <Text style={[styles.chipText, mine && styles.chipTextActive]}>Tylko moje</Text>
                  </TouchableOpacity>
                ) : null}
              </ScrollView>
            </View>
            {loading && !rentals.length ? (
              <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.gold} /></View>
            ) : (
              <FlatList
                data={visible}
                keyExtractor={(item) => item.id}
                renderItem={renderRow}
                keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary.gold} />}
                contentContainerStyle={visible.length ? styles.listContent : styles.emptyContent}
                ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
                ListEmptyComponent={(
                  <View style={styles.empty}>
                    <Feather name="repeat" size={44} color={colors.text.tertiary} />
                    <Text style={[ui.muted, styles.emptyText]}>{search.trim() ? 'Nie znaleziono wypożyczeń.' : 'Brak wypożyczeń w tej zakładce.'}</Text>
                  </View>
                )}
              />
            )}
          </>
        )}
        <RentalFormSheet visible={creating} rental={null} access={access} notice={notice} onClose={() => setCreating(false)}
          onSaved={(id) => { setCreating(false); void load(); setCatalogFor(id); setOpenedId(id); }} />
        {notice.overlay}
      </View>
    </NoticeScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  filters: { backgroundColor: colors.background.secondary, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginBottom: spacing.xs },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: borderRadius.md,
    backgroundColor: colors.layer.well,
  },
  search: { flex: 1, paddingVertical: 9, fontSize: 14, color: colors.text.primary },
  newButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary.gold },
  chips: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: borderRadius.full,
    borderWidth: 1, borderColor: colors.border.default,
  },
  chipActive: { backgroundColor: withAlpha(colors.primary.gold, 0.15), borderColor: colors.primary.gold },
  chipText: { color: colors.text.secondary, fontSize: 13 },
  chipTextActive: { color: colors.primary.gold, fontWeight: '600' },
  listContent: { padding: spacing.md, gap: spacing.sm },
  emptyContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  empty: { alignItems: 'center', gap: spacing.sm },
  emptyText: { textAlign: 'center' },
  error: { color: colors.status.error, marginBottom: spacing.sm },
  row: {
    gap: 4, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary, borderWidth: 1,
    borderColor: colors.border.default,
  },
  number: { color: colors.text.primary, fontSize: 15, fontWeight: typography.fontWeights.semibold },
  gross: { alignSelf: 'flex-end', color: colors.primary.gold },
});
