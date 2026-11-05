import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';
import { navigateToInquiry, navigateToSellerChat, navigateToTenders, openInCrmWeb } from '../navigation/navigationRef';
import { colors, spacing, typography, borderRadius } from '../theme';
import { parseSalesDaySellers, type SalesDaySellers, type SalesDaySellersItemKind } from '../lib/sellerCockpit';
import { getSellerChatTarget } from '../lib/sellerChatTarget';

/*
 * „Mój dzień” sprzedawcy — te same dane co panel w CRM (get_my_sales_day): kontakty do wykonania,
 * oferty bez odpowiedzi, przetargi z terminem w 7 dni i lejek. Ukryty, gdy nie ma nic do zrobienia.
 * Karta „Sprzedawcy — do zrobienia” (klucz `sellers`, migracja 20261105150000_seller_manager_cockpit.sql): sprawy
 * sprzedawców zewnętrznych, których pracownik jest opiekunem — zakres liczy baza. Rozmowa otwiera się w aplikacji,
 * pozostałe sprawy (sprawdzenie oferty, potwierdzenie, zapytanie) w CRM w przeglądarce — decyzje zostają w CRM.
 * Starsza baza bez klucza `sellers` → karta ukryta.
 */

type FollowUp = { id: string; title: string; next_action_at: string; overdue: boolean };
type WaitingOffer = { id: string; title: string | null; offer_number: string | null; days_waiting: number; inquiry_id: string | null; viewed_at: string | null };
type TenderItem = { id: string; title: string; submission_deadline: string; mine: boolean };
type Stage = { stage: string; count: number; value: number; weighted_value: number };
type SalesDay = {
  followups: FollowUp[];
  unscheduled_inquiries: number;
  waiting_offers: WaitingOffer[];
  tenders: TenderItem[];
  pipeline: Stage[];
  /** Brak klucza (null) = baza sprzed kokpitu opiekuna sprzedawców. */
  sellers?: unknown;
};

const time = (value: string) => new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
const day = (value: string) => new Date(value).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
const money = (value: number) => `${Math.round(value).toLocaleString('pl-PL')} zł`;
const when = (value: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toDateString() === new Date().toDateString() ? time(value) : day(value);
};

type SellerCountKey = Exclude<keyof SalesDaySellers, 'items'>;
const SELLER_COUNTS: { key: SellerCountKey; label: string }[] = [
  { key: 'reviews', label: 'Do sprawdzenia' },
  { key: 'chats_waiting', label: 'Rozmowy bez odpowiedzi' },
  { key: 'inquiries', label: 'Zapytania' },
  { key: 'wizard_steps', label: 'Kroki realizacji' },
  { key: 'events_pending', label: 'Wydarzenia do potwierdzenia' },
  { key: 'guest_acceptances', label: 'Akceptacje gości' },
];
const SELLER_ITEM: Record<SalesDaySellersItemKind, { icon: keyof typeof Feather.glyphMap; label: string }> = {
  review: { icon: 'file-text', label: 'Oferta do sprawdzenia' },
  chat: { icon: 'message-circle', label: 'Rozmowa bez odpowiedzi' },
  inquiry: { icon: 'inbox', label: 'Zapytanie sprzedawcy' },
  wizard: { icon: 'clipboard', label: 'Krok realizacji' },
  event: { icon: 'calendar', label: 'Wydarzenie do potwierdzenia' },
  guest: { icon: 'check-circle', label: 'Akceptacja gościa' },
};

/** Rozmowa → ekran rozmowy ze sprzedawcą w aplikacji; pozostałe sprawy → CRM w przeglądarce (decyzje w CRM). */
function openSellerItem(item: SalesDaySellers['items'][number]) {
  if (item.kind === 'chat') {
    const conversationId = getSellerChatTarget({ action_url: item.url });
    if (conversationId) { navigateToSellerChat(conversationId); return; }
  }
  if (item.url) openInCrmWeb(item.url);
}

function SellersTodoCard({ sellers }: { sellers: SalesDaySellers }) {
  const counts = SELLER_COUNTS.filter(({ key }) => sellers[key] > 0);
  return (
    <View style={styles.sellersCard}>
      <Text style={styles.sellersTitle}>Sprzedawcy — do zrobienia</Text>
      {counts.length > 0 && (
        <View style={styles.chips}>
          {counts.map(({ key, label }) => (
            <View key={key} style={styles.chip}>
              <Text style={styles.chipValue}>{sellers[key]}</Text>
              <Text style={styles.chipLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}
      {sellers.items.slice(0, 10).map((item, index) => {
        const meta = SELLER_ITEM[item.kind] || { icon: 'circle' as const, label: 'Sprawa sprzedawcy' };
        const inApp = item.kind === 'chat' && Boolean(getSellerChatTarget({ action_url: item.url }));
        const disabled = !inApp && !item.url;
        return (
          <TouchableOpacity
            key={`${item.kind}-${item.url}-${index}`}
            style={styles.row}
            disabled={disabled}
            onPress={() => openSellerItem(item)}
            accessibilityRole="button"
            accessibilityLabel={`${meta.label}: ${item.title || meta.label}, ${item.seller_name}`}
            accessibilityHint={inApp ? 'Otwiera rozmowę ze sprzedawcą' : 'Otwiera CRM w przeglądarce'}
          >
            <Feather name={meta.icon} size={15} color={colors.primary.gold} />
            <View style={styles.rowBody}>
              <Text style={styles.rowText} numberOfLines={1}>{item.title || meta.label}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{item.seller_name} · {meta.label}</Text>
            </View>
            {!!item.at && <Text style={styles.rowMeta}>{when(item.at)}</Text>}
            {!inApp && !disabled && <Feather name="external-link" size={13} color={colors.text.tertiary} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function SalesDaySection({ refreshKey }: { refreshKey: number }) {
  const { employee } = useAuth();
  const [data, setData] = useState<SalesDay | null>(null);
  const salesEnabled = canView(employee, 'inquiries');
  // Opiekun sprzedawców ma oferty (offers_manage) — karta sprzedawców bywa jedyną treścią „Mojego dnia”.
  const enabled = salesEnabled || canView(employee, 'offers');

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data: result, error } = await supabase.rpc('get_my_sales_day');
    setData(error ? null : (result as SalesDay));
  }, [enabled]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!enabled || !data) return null;
  const followups = salesEnabled ? data.followups || [] : [];
  const offers = salesEnabled ? data.waiting_offers || [] : [];
  const tenders = salesEnabled ? data.tenders || [] : [];
  const unscheduled = salesEnabled ? data.unscheduled_inquiries || 0 : 0;
  const weighted = salesEnabled ? (data.pipeline || []).reduce((sum, stage) => sum + Number(stage.weighted_value || 0), 0) : 0;
  const showSales = followups.length + offers.length + tenders.length + unscheduled > 0 || weighted > 0;
  const sellers = parseSalesDaySellers(data.sellers);
  const showSellers = Boolean(sellers && (SELLER_COUNTS.some(({ key }) => sellers[key] > 0) || sellers.items.length > 0));
  if (!showSales && !showSellers) return null;
  const overdue = followups.filter((item) => item.overdue).length;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Mój dzień</Text>
      {showSales && (<>
        <View style={styles.kpis}>
          <View style={styles.kpi}><Text style={[styles.kpiValue, overdue > 0 && styles.alert]}>{followups.length}</Text><Text style={styles.kpiLabel}>Kontakty na dziś{overdue > 0 ? ` (${overdue} zaległe)` : ''}</Text></View>
          <View style={styles.kpi}><Text style={styles.kpiValue}>{offers.length}</Text><Text style={styles.kpiLabel}>Oferty bez odpowiedzi</Text></View>
          <View style={styles.kpi}><Text style={styles.kpiValue}>{tenders.length}</Text><Text style={styles.kpiLabel}>Przetargi w 7 dni</Text></View>
        </View>
        {unscheduled > 0 && (
          <Text style={styles.note}>Zapytania bez zaplanowanego kontaktu: {unscheduled}</Text>
        )}

        {followups.slice(0, 5).map((item) => (
          <TouchableOpacity key={item.id} style={styles.row} onPress={() => navigateToInquiry(item.id)}>
            <Feather name="phone-call" size={15} color={item.overdue ? colors.status.error : colors.primary.gold} />
            <Text style={styles.rowText} numberOfLines={1}>{item.title}</Text>
            <Text style={[styles.rowMeta, item.overdue && styles.alert]}>{item.overdue ? day(item.next_action_at) : time(item.next_action_at)}</Text>
          </TouchableOpacity>
        ))}
        {offers.slice(0, 3).map((offer) => (
          <TouchableOpacity key={offer.id} style={styles.row}
            onPress={() => (offer.inquiry_id ? navigateToInquiry(offer.inquiry_id) : openInCrmWeb(`/crm/offers/${offer.id}`))}>
            <Feather name="file-text" size={15} color={colors.primary.gold} />
            <Text style={styles.rowText} numberOfLines={1}>{offer.title || offer.offer_number || 'Oferta'}</Text>
            <Text style={styles.rowMeta}>{offer.days_waiting} dni{offer.viewed_at ? ' · otwarta' : ''}</Text>
          </TouchableOpacity>
        ))}
        {tenders.slice(0, 3).map((tender) => (
          <TouchableOpacity key={tender.id} style={styles.row} onPress={() => navigateToTenders(tender.id)}>
            <Feather name="briefcase" size={15} color={colors.primary.gold} />
            <Text style={styles.rowText} numberOfLines={1}>{tender.title}</Text>
            <Text style={styles.rowMeta}>{day(tender.submission_deadline)}</Text>
          </TouchableOpacity>
        ))}
        {weighted > 0 && <Text style={styles.note}>Lejek ważony prawdopodobieństwem: {money(weighted)}</Text>}
      </>)}
      {showSellers && sellers && <SellersTodoCard sellers={sellers} />}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { margin: spacing.md, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary, gap: spacing.sm },
  title: {
    fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.lg,
    fontWeight: typography.fontWeights.semibold, color: colors.text.primary,
  },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, gap: 2 },
  kpiValue: { fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold, color: colors.text.primary },
  kpiLabel: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  alert: { color: colors.status.error },
  note: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36 },
  rowText: { flex: 1, fontSize: typography.fontSizes.sm, color: colors.text.primary },
  rowMeta: { fontSize: typography.fontSizes.xs, color: colors.text.tertiary },
  rowBody: { flex: 1, gap: 1 },
  rowSub: { fontSize: typography.fontSizes.xs, color: colors.text.secondary },
  sellersCard: { padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, gap: spacing.xs },
  sellersTitle: {
    fontFamily: 'MBFAtom', textTransform: 'uppercase', fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold, color: colors.primary.gold, letterSpacing: 0.5,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: borderRadius.sm, backgroundColor: 'rgba(211, 187, 115, 0.12)',
  },
  chipValue: { fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.bold, color: colors.primary.gold },
  chipLabel: { fontSize: 11, color: colors.text.secondary },
});
