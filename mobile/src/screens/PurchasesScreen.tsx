import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { NoticeScope, Segmented, afterModal, useNotice } from '../components/Inquiries/InquiryKit';
import PurchaseFormSheet from '../components/Purchases/PurchaseFormSheet';
import {
  PurchaseDecisionSheet, PurchaseReviewSheet, PurchaseSubmitSheet, type PurchaseDecisionTarget,
} from '../components/Purchases/PurchaseSheets';
import { PurchaseMonthSections, PurchaseStatusBadge, openPurchaseUrl, pui } from '../components/Purchases/purchasesUi';
import { canOpenPurchases } from '../lib/permissions';
import {
  purchaseCurrentMonth, purchaseDay, purchaseErrorMessage, purchaseMonthLabel, purchaseShiftMonth, purchaseTotals,
  purchaseTotalsText, type PurchaseDocument, type PurchaseMonth, type PurchaseMonthCompany, type PurchaseReviewRow, type PurchaseState,
} from '../lib/purchaseShared';
import { deletePurchase, loadPurchaseReview, loadPurchaseState, purchaseFileUrl } from '../lib/purchasesApi';
import { borderRadius, colors, spacing, typography, withAlpha } from '../theme';

/*
 * Zakupy w telefonie — jak `/crm/purchases` i ekran na Macu (`docs/purchases.md`): „Moje wydatki” (miesiąc, nierozliczone
 * miesiące, dokumenty działalności, „Dodaj zakup” ze zdjęciem paragonu z aparatu i odczytem AI, poprawka, usunięcie,
 * „Wyślij rozliczenie”) i „Rozliczenia pracowników” (zatwierdzający: rozliczenie pracownika, zatwierdzenie, zwrot do poprawy,
 * cofnięcie zatwierdzenia). Link z powiadomienia: `employee` + `year` + `month` — rozliczenie pracownika, `year` + `month` —
 * własny miesiąc. Dostęp sprawdzają funkcje bazy `purchase_*`.
 */

type Tab = 'mine' | 'review';
type Params = { employee?: string; year?: number; month?: number; requestId?: number } | undefined;

export default function PurchasesScreen() {
  const route = useRoute<{ key: string; name: string; params?: Params }>();
  const navigation = useNavigation<any>();
  const { employee } = useAuth();
  const notice = useNotice();
  const allowed = canOpenPurchases(employee);
  const now = purchaseCurrentMonth();
  const [period, setPeriod] = useState(now);
  const [state, setState] = useState<PurchaseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('mine');
  const [rows, setRows] = useState<PurchaseReviewRow[] | null>(null);
  const [editing, setEditing] = useState<PurchaseDocument | 'new' | null>(null);
  const [submitting, setSubmitting] = useState<PurchaseMonthCompany | null>(null);
  const [reviewing, setReviewing] = useState<PurchaseMonth | null>(null);
  const [decision, setDecision] = useState<PurchaseDecisionTarget | null>(null);
  /** Rozliczenie pracownika do ponownego otwarcia po powrocie z podglądu pliku (iOS). */
  const resumeReview = useRef<PurchaseMonth | null>(null);
  const request = useRef(0);

  const load = useCallback(async (pull = false, signal?: AbortSignal) => {
    if (!allowed) return;
    const id = ++request.current;
    if (pull) setRefreshing(true);
    try {
      const next = await loadPurchaseState(period.year, period.month);
      if (signal?.aborted || id !== request.current) return;
      setState(next);
      setError(null);
      if (!next.access.record && next.access.approve) setTab('review');
      if (next.access.approve) {
        const review = await loadPurchaseReview().catch((cause) => {
          notice.notify(purchaseErrorMessage(cause, 'Nie udało się wczytać rozliczeń.'), true);
          return [] as PurchaseReviewRow[];
        });
        if (!signal?.aborted && id === request.current) setRows(review);
      }
    } catch (cause) {
      if (!signal?.aborted && id === request.current) setError(purchaseErrorMessage(cause, 'Nie udało się wczytać zakupów.'));
    } finally {
      if (!signal?.aborted && id === request.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // `notice` zmienia się przy każdym renderze — tylko komunikat błędu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, period.year, period.month]);

  useForegroundEffect((signal) => {
    void load(false, signal);
  }, [load]);

  const openReview = useCallback(async (employeeId: string, year: number, month: number) => {
    const data = await notice.run('Wczytywanie rozliczenia…', () => loadPurchaseState(year, month, employeeId));
    if (data?.month) setReviewing(data.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Link z powiadomienia: rozliczenie pracownika albo własny miesiąc.
  useEffect(() => {
    const params = route.params;
    if (!params?.requestId) return;
    const year = Number(params.year);
    const month = Number(params.month);
    if (!(year >= 2000 && month >= 1 && month <= 12)) return;
    if (params.employee && params.employee !== employee?.id) {
      setTab('review');
      void openReview(params.employee, year, month);
    } else {
      setTab('mine');
      setPeriod({ year, month });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.requestId]);

  // iOS: po powrocie z podglądu pliku — z powrotem okno rozliczenia pracownika.
  useEffect(() => navigation.addListener('focus', () => {
    const month = resumeReview.current;
    if (!month) return;
    resumeReview.current = null;
    setReviewing(month);
  }), [navigation]);

  const month = state?.month || null;
  const recordCompanies = state?.access.record_companies || [];
  const futureMonth = period.year * 12 + period.month > now.year * 12 + now.month;
  const lastMonth = period.year * 12 + period.month >= now.year * 12 + now.month;
  const waiting = useMemo(() => (rows || []).filter((row) => row.status === 'submitted').length, [rows]);
  const showTabs = Boolean(state?.access.record && state?.access.approve);
  const showReview = tab === 'review' || (!!state && !month);

  const openFile = async (document: PurchaseDocument, fromReview: PurchaseMonth | null) => {
    const file = await notice.run('Otwieranie pliku…', () => purchaseFileUrl(document.id));
    if (!file) return;
    const title = `${document.seller_name} ${document.number}`.trim();
    if (fromReview && Platform.OS === 'ios') {
      // Okno rozliczenia zakryłoby podgląd — zamykamy je i otwieramy ponownie po powrocie.
      resumeReview.current = fromReview;
      setReviewing(null);
      afterModal(() => openPurchaseUrl(navigation, file.url, title));
    } else {
      openPurchaseUrl(navigation, file.url, title);
    }
  };

  const remove = (document: PurchaseDocument) => {
    Alert.alert('Usunąć zakup?', `${document.seller_name} · ${document.number} · ${purchaseDay(document.date)}. Dokument i jego plik znikną${document.event ? ', a z eventu zniknie koszt' : ''}.`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń', style: 'destructive', onPress: () => void (async () => {
          const done = await notice.run('Usuwanie zakupu…', async () => { await deletePurchase(document.id); return true; }, 'Zakup usunięty.');
          if (done) void load();
        })(),
      },
    ]);
  };

  /** Dokument z listy: plik, poprawka, usunięcie (w otwartym albo zwróconym miesiącu; powiązany z wyciągiem — bez usuwania). */
  const documentActions = (document: PurchaseDocument, editable: boolean) => {
    if (!editable) {
      if (document.has_file) void openFile(document, null);
      else notice.notify('Ten dokument nie ma jeszcze pliku.', true);
      return;
    }
    Alert.alert(`${document.seller_name} · ${document.number}`, undefined, [
      ...(document.has_file ? [{ text: 'Pokaż plik', onPress: () => void openFile(document, null) }] : []),
      { text: 'Popraw', onPress: () => afterModal(() => setEditing(document)) },
      ...(!document.bank_matched ? [{ text: 'Usuń', style: 'destructive' as const, onPress: () => afterModal(() => remove(document)) }] : []),
      { text: 'Anuluj', style: 'cancel' as const },
    ]);
  };

  const saved = (document: PurchaseDocument) => {
    setEditing(null);
    const [year, monthNumber] = document.date.split('-').map(Number);
    if (year && monthNumber && (year !== period.year || monthNumber !== period.month)) {
      afterModal(() => notice.notify(`Zakup ma datę ${purchaseDay(document.date)} — jest w miesiącu ${purchaseMonthLabel(year, monthNumber)}.`));
      setPeriod({ year, month: monthNumber });
    } else {
      void load();
    }
  };

  if (!allowed) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Feather name="lock" size={40} color={colors.text.tertiary} />
        <Text style={[pui.muted, styles.centerText]}>Zakupy wymagają uprawnienia „Zakupy — własne wydatki” albo „Finanse — zarządzanie” w działalności.</Text>
      </View>
    );
  }

  const renderReviewRow = ({ item }: { item: PurchaseReviewRow }) => (
    <TouchableOpacity style={pui.card} onPress={() => void openReview(item.employee_id, item.year, item.month)} accessibilityRole="button"
      accessibilityLabel={`Rozliczenie ${item.employee_name || 'pracownika'}, ${purchaseMonthLabel(item.year, item.month)}`}>
      <View style={pui.between}>
        <View style={pui.flex}>
          <Text style={[pui.text, pui.bold]} numberOfLines={1}>{item.employee_name || 'Pracownik'}</Text>
          <Text style={pui.muted} numberOfLines={1}>{purchaseMonthLabel(item.year, item.month)} · {item.company_name}</Text>
        </View>
        <PurchaseStatusBadge status={item.status} />
      </View>
      <View style={pui.between}>
        <Text style={pui.mutedXs}>
          {item.documents} dok.{item.submitted_at && item.status === 'submitted' ? ` · wysłane ${purchaseDay(item.submitted_at)}` : ''}
        </Text>
        <Text style={pui.money}>{item.totals ? purchaseTotalsText(item.totals) : '—'}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <NoticeScope value={notice.scope}>
      <View style={styles.container}>
        {showTabs ? (
          <View style={styles.tabs}>
            <Segmented<Tab> value={tab} onChange={setTab}
              options={[{ id: 'mine', label: 'Moje wydatki' }, { id: 'review', label: waiting ? `Rozliczenia (${waiting})` : 'Rozliczenia' }]} />
          </View>
        ) : null}
        {loading && !state ? (
          <View style={styles.centered}><ActivityIndicator size="large" color={colors.primary.gold} /></View>
        ) : !state ? (
          <View style={styles.centered}>
            <Feather name="shopping-cart" size={40} color={colors.text.tertiary} />
            <Text style={[pui.muted, styles.centerText]}>{error || 'Nie udało się wczytać zakupów.'}</Text>
            <TouchableOpacity style={styles.retry} onPress={() => { setLoading(true); void load(); }} accessibilityRole="button">
              <Text style={styles.retryText}>Spróbuj ponownie</Text>
            </TouchableOpacity>
          </View>
        ) : showReview ? (
          <FlatList
            data={rows || []}
            keyExtractor={(item) => `${item.employee_id}-${item.company_id}-${item.year}-${item.month}`}
            renderItem={renderReviewRow}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary.gold} />}
            contentContainerStyle={rows?.length ? styles.list : styles.emptyList}
            ListEmptyComponent={rows === null ? <ActivityIndicator color={colors.primary.gold} /> : (
              <View style={styles.centered}>
                <Feather name="shopping-cart" size={40} color={colors.text.tertiary} />
                <Text style={[pui.muted, styles.centerText]}>Brak zakupów pracowników do rozliczenia.</Text>
              </View>
            )}
          />
        ) : month ? (
          <ScrollView contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary.gold} />}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.monthBar}>
              <TouchableOpacity onPress={() => setPeriod((current) => purchaseShiftMonth(current.year, current.month, -1))} style={styles.arrow}
                accessibilityRole="button" accessibilityLabel="Poprzedni miesiąc">
                <Feather name="chevron-left" size={22} color={colors.primary.gold} />
              </TouchableOpacity>
              <View style={styles.monthTitle}>
                <Text style={styles.monthText}>{purchaseMonthLabel(period.year, period.month).toLocaleUpperCase('pl-PL')}</Text>
                <Text style={pui.mutedXs}>Razem: {purchaseTotalsText(purchaseTotals(month.documents))}</Text>
              </View>
              <TouchableOpacity onPress={() => setPeriod((current) => purchaseShiftMonth(current.year, current.month, 1))} disabled={lastMonth}
                style={[styles.arrow, lastMonth && styles.disabled]} accessibilityRole="button" accessibilityLabel="Następny miesiąc">
                <Feather name="chevron-right" size={22} color={colors.primary.gold} />
              </TouchableOpacity>
            </View>
            {period.year !== now.year || period.month !== now.month ? (
              <TouchableOpacity onPress={() => setPeriod(now)} style={styles.current} accessibilityRole="button">
                <Text style={styles.currentText}>Bieżący miesiąc</Text>
              </TouchableOpacity>
            ) : null}

            {recordCompanies.length ? (
              <TouchableOpacity style={styles.add} onPress={() => setEditing('new')} accessibilityRole="button">
                <Feather name="camera" size={18} color={colors.background.primary} />
                <Text style={styles.addText}>Dodaj zakup — zdjęcie paragonu</Text>
              </TouchableOpacity>
            ) : null}

            {month.pending_months.length ? (
              <View style={pui.warnWell}>
                <View style={pui.row}>
                  <Feather name="alert-triangle" size={14} color={colors.status.warning} />
                  <Text style={pui.warning}>Nierozliczone miesiące:</Text>
                </View>
                <View style={pui.wrap}>
                  {month.pending_months.map((pending) => (
                    <TouchableOpacity key={`${pending.year}-${pending.month}-${pending.company_id}`} onPress={() => setPeriod({ year: pending.year, month: pending.month })}
                      style={styles.pending} accessibilityRole="button">
                      <Text style={pui.warning}>
                        {purchaseMonthLabel(pending.year, pending.month)} ({pending.count} dok.{pending.status === 'returned' ? ', do poprawy' : ''})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : null}

            <PurchaseMonthSections month={month} futureMonth={futureMonth} onDocument={documentActions} onSubmit={(company) => setSubmitting(company)} />
          </ScrollView>
        ) : null}

        <PurchaseFormSheet visible={editing !== null} document={editing === 'new' ? null : editing} companies={recordCompanies}
          categories={state?.categories || { finance: [], event: [] }} notice={notice} onClose={() => setEditing(null)} onSaved={saved} />
        <PurchaseSubmitSheet month={month} company={submitting} notice={notice} onClose={() => setSubmitting(null)}
          onSubmitted={(next) => { setSubmitting(null); setState((current) => (current ? { ...current, month: next } : current)); }} />
        <PurchaseReviewSheet month={reviewing} notice={notice} onClose={() => setReviewing(null)}
          onDocument={(document) => {
            if (!document.has_file) notice.notify('Ten dokument nie ma jeszcze pliku.', true);
            else if (reviewing) void openFile(document, reviewing);
          }}
          onDecide={(target) => { setReviewing(null); afterModal(() => setDecision(target)); }} />
        <PurchaseDecisionSheet target={decision} notice={notice}
          onClose={() => { const back = decision?.month || null; setDecision(null); if (back) afterModal(() => setReviewing(back)); }}
          onDecided={(next) => { setDecision(null); void load(); afterModal(() => setReviewing(next)); }} />
        {notice.overlay}
      </View>
    </NoticeScope>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  centerText: { textAlign: 'center' },
  tabs: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.background.secondary },
  list: { padding: spacing.md, gap: spacing.md, width: '100%', maxWidth: 900, alignSelf: 'center' },
  emptyList: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  error: { color: colors.status.error },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.md, backgroundColor: colors.background.secondary },
  disabled: { opacity: 0.35 },
  monthTitle: { flex: 1, alignItems: 'center', gap: 2 },
  monthText: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontFamily: typography.fontFamilies.heading, fontWeight: '400', letterSpacing: 0.4 },
  current: { alignSelf: 'center', paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.border.default },
  currentText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: colors.primary.gold,
  },
  addText: { color: colors.background.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  pending: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full, backgroundColor: withAlpha('#f59e0b', 0.12) },
  retry: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1, borderColor: colors.border.hover },
  retryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
});
