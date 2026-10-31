import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Modal, Alert, Linking, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PermissionGate from '../components/PermissionGate';
import { navigateToInquiry } from '../navigation/navigationRef';
import { colors, spacing, typography, borderRadius } from '../theme';

/*
 * Przetargi — to samo co /crm/tenders: lista z terminami, „Przypisz do mnie” (assign_tender)
 * i „Utwórz zapytanie” (create_inquiry_from_tender). Dostęp: uprawnienie tenders_view (RLS).
 */

type Tender = {
  id: string;
  title: string;
  contracting_authority: string | null;
  submission_deadline: string | null;
  estimated_value: number | null;
  currency: string | null;
  status: string;
  assigned_to: string | null;
  inquiry_id: string | null;
  source_url: string | null;
  location: string | null;
  is_matched: boolean | null;
  is_watched: boolean | null;
  manual_relevance: string | null;
};
type Filter = 'mine' | 'soon' | 'matched' | 'all';

const STATUS_LABELS: Record<string, string> = {
  new: 'Nowy', reviewing: 'W analizie', interested: 'Zainteresowany', preparing: 'Przygotowywanie',
  submitted: 'Oferta złożona', won: 'Wygrana', lost: 'Przegrana', ignored: 'Zignorowany',
};
const FILTERS: Array<[Filter, string]> = [['mine', 'Moje'], ['soon', 'Do 7 dni'], ['matched', 'Dopasowane'], ['all', 'Wszystkie']];

const formatDeadline = (value: string | null) =>
  value ? new Date(value).toLocaleString('pl-PL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Brak terminu';
const daysLeft = (value: string | null) =>
  value ? Math.ceil((new Date(value).getTime() - Date.now()) / 86400000) : null;
const formatValue = (tender: Tender) =>
  tender.estimated_value && tender.estimated_value > 0
    ? `${Math.round(tender.estimated_value).toLocaleString('pl-PL')} ${tender.currency || 'PLN'}`
    : null;

function TendersContent() {
  const route = useRoute<any>();
  const { employee } = useAuth();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [filter, setFilter] = useState<Filter>('mine');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Tender | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('tenders')
      .select('id, title, contracting_authority, submission_deadline, estimated_value, currency, status, assigned_to, inquiry_id, source_url, location, is_matched, is_watched, manual_relevance')
      .gte('submission_deadline', new Date().toISOString())
      .eq('is_hidden', false)
      .order('submission_deadline', { ascending: true })
      .limit(200);
    if (loadError) setError('Nie udało się wczytać przetargów.');
    else setTenders((data || []) as Tender[]);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Otwarcie z powiadomienia: /crm/tenders?tender=<id>
  const requestedId = route.params?.tenderId as string | undefined;
  useEffect(() => {
    if (!requestedId) return;
    const fromList = tenders.find((tender) => tender.id === requestedId);
    if (fromList) { setSelected(fromList); return; }
    void supabase.from('tenders')
      .select('id, title, contracting_authority, submission_deadline, estimated_value, currency, status, assigned_to, inquiry_id, source_url, location, is_matched, is_watched, manual_relevance')
      .eq('id', requestedId).maybeSingle()
      .then(({ data }) => { if (data) setSelected(data as Tender); });
  }, [requestedId, route.params?.requestId, tenders]);

  const visible = useMemo(() => tenders.filter((tender) => {
    if (filter === 'mine') return tender.assigned_to === employee?.id;
    if (filter === 'soon') { const left = daysLeft(tender.submission_deadline); return left !== null && left <= 7; }
    if (filter === 'matched') return Boolean(tender.is_matched || tender.is_watched || tender.manual_relevance === 'relevant');
    return true;
  }), [tenders, filter, employee?.id]);

  const refreshSelected = async (id: string) => {
    const { data } = await supabase.from('tenders')
      .select('id, title, contracting_authority, submission_deadline, estimated_value, currency, status, assigned_to, inquiry_id, source_url, location, is_matched, is_watched, manual_relevance')
      .eq('id', id).maybeSingle();
    if (data) setSelected(data as Tender);
    void load(true);
  };

  const assignToMe = async (tender: Tender) => {
    if (!employee?.id) return;
    setBusy(true);
    const { error: assignError } = await supabase.rpc('assign_tender', { p_tender_id: tender.id, p_employee_id: employee.id });
    setBusy(false);
    if (assignError) { Alert.alert('Przetarg', assignError.message || 'Nie udało się przypisać przetargu.'); return; }
    await refreshSelected(tender.id);
  };

  const createInquiry = async (tender: Tender) => {
    setBusy(true);
    const { data, error: createError } = await supabase.rpc('create_inquiry_from_tender', { p_tender_id: tender.id });
    setBusy(false);
    if (createError || !data) { Alert.alert('Przetarg', createError?.message || 'Nie udało się utworzyć zapytania.'); return; }
    setSelected(null);
    void load(true);
    navigateToInquiry(data as string);
  };

  const renderItem = ({ item }: { item: Tender }) => {
    const left = daysLeft(item.submission_deadline);
    const urgent = left !== null && left <= 2;
    return (
      <TouchableOpacity style={styles.row} onPress={() => setSelected(item)} activeOpacity={0.7}>
        <View style={styles.rowHeader}>
          <Text style={[styles.deadline, urgent && styles.urgent]}>
            {formatDeadline(item.submission_deadline)}{left !== null ? ` · ${left <= 0 ? 'dziś' : `${left} dni`}` : ''}
          </Text>
          <Text style={styles.status}>{STATUS_LABELS[item.status] || 'Inny status'}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        {!!item.contracting_authority && <Text style={styles.meta} numberOfLines={1}>{item.contracting_authority}</Text>}
        <View style={styles.badges}>
          {item.assigned_to === employee?.id && <Text style={styles.badge}>Mój</Text>}
          {!!item.inquiry_id && <Text style={styles.badge}>Zapytanie</Text>}
          {!!formatValue(item) && <Text style={styles.meta}>{formatValue(item)}</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filtersContent}>
        {FILTERS.map(([value, label]) => (
          <TouchableOpacity key={value} onPress={() => setFilter(value)} style={[styles.chip, filter === value && styles.chipActive]}
            accessibilityRole="button" accessibilityState={{ selected: filter === value }}>
            <Text style={[styles.chipText, filter === value && styles.chipTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.gold} /></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary.gold} />}
          contentContainerStyle={visible.length === 0 ? styles.emptyContent : styles.listContent}
          ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="briefcase" size={44} color={colors.text.tertiary} />
              <Text style={styles.meta}>{filter === 'mine' ? 'Nie masz przypisanych przetargów z otwartym terminem.' : 'Brak przetargów.'}</Text>
            </View>
          }
        />
      )}

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            {selected && (
              <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
                <Text style={styles.sheetTitle}>{selected.title}</Text>
                {!!selected.contracting_authority && <Text style={styles.meta}>{selected.contracting_authority}</Text>}
                <Text style={styles.meta}>Termin składania: {formatDeadline(selected.submission_deadline)}</Text>
                {!!formatValue(selected) && <Text style={styles.meta}>Wartość szacunkowa: {formatValue(selected)}</Text>}
                {!!selected.location && <Text style={styles.meta}>Miejsce: {selected.location}</Text>}
                <Text style={styles.meta}>Status: {STATUS_LABELS[selected.status] || 'Inny status'}</Text>

                {selected.assigned_to !== employee?.id && (
                  <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void assignToMe(selected)}>
                    <Feather name="user-check" size={16} color={colors.background.primary} />
                    <Text style={styles.primaryText}>Przypisz do mnie</Text>
                  </TouchableOpacity>
                )}
                {selected.inquiry_id ? (
                  <TouchableOpacity style={styles.secondary} onPress={() => { const id = selected.inquiry_id!; setSelected(null); navigateToInquiry(id); }}>
                    <Feather name="phone-call" size={16} color={colors.primary.gold} />
                    <Text style={styles.secondaryText}>Otwórz zapytanie</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.primary} disabled={busy} onPress={() => void createInquiry(selected)}>
                    <Feather name="plus" size={16} color={colors.background.primary} />
                    <Text style={styles.primaryText}>Utwórz zapytanie</Text>
                  </TouchableOpacity>
                )}
                {!!selected.source_url && (
                  <TouchableOpacity style={styles.secondary} onPress={() => void Linking.openURL(selected.source_url!)}>
                    <Feather name="external-link" size={16} color={colors.primary.gold} />
                    <Text style={styles.secondaryText}>Ogłoszenie</Text>
                  </TouchableOpacity>
                )}
                {busy && <ActivityIndicator color={colors.primary.gold} />}
                <TouchableOpacity style={styles.close} onPress={() => setSelected(null)}>
                  <Text style={styles.meta}>Zamknij</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filters: { flexGrow: 0, backgroundColor: colors.background.secondary },
  filtersContent: { padding: spacing.md, gap: spacing.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  chipActive: { backgroundColor: colors.primary.gold + '33' },
  chipText: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  chipTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  listContent: { paddingBottom: spacing.lg },
  emptyContent: { flexGrow: 1 },
  row: { paddingHorizontal: spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border.default, gap: 4 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  deadline: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  urgent: { color: colors.status.error, fontWeight: typography.fontWeights.semibold },
  status: { fontSize: typography.fontSizes.xs, color: colors.primary.gold },
  title: { fontSize: typography.fontSizes.sm, color: colors.text.primary, fontWeight: typography.fontWeights.semibold },
  meta: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary, lineHeight: 18 },
  badges: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  badge: {
    fontSize: typography.fontSizes.xs, color: colors.primary.gold, backgroundColor: colors.primary.gold + '1A',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: borderRadius.sm, overflow: 'hidden',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: spacing.xl },
  error: { margin: spacing.md, color: colors.status.error },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '80%', padding: spacing.lg, borderTopLeftRadius: borderRadius.lg, borderTopRightRadius: borderRadius.lg,
    backgroundColor: colors.background.secondary,
  },
  sheetTitle: { fontSize: typography.fontSizes.lg, color: colors.text.primary, fontWeight: typography.fontWeights.bold },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 44,
    borderRadius: borderRadius.md, backgroundColor: colors.primary.gold, marginTop: spacing.sm,
  },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
  secondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 44,
    borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary,
  },
  secondaryText: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  close: { alignItems: 'center', padding: spacing.md },
});

export default function TendersScreen() {
  return (
    <PermissionGate module="tenders">
      <TendersContent />
    </PermissionGate>
  );
}
