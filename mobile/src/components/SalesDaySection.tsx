import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';
import { navigateToInquiry, navigateToTenders, openInCrmWeb } from '../navigation/navigationRef';
import { colors, spacing, typography, borderRadius } from '../theme';

/*
 * „Mój dzień” sprzedawcy — te same dane co panel w CRM (get_my_sales_day): kontakty do wykonania,
 * oferty bez odpowiedzi, przetargi z terminem w 7 dni i lejek. Ukryty, gdy nie ma nic do zrobienia.
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
};

const time = (value: string) => new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
const day = (value: string) => new Date(value).toLocaleDateString('pl-PL', { day: '2-digit', month: 'short' });
const money = (value: number) => `${Math.round(value).toLocaleString('pl-PL')} zł`;

export default function SalesDaySection({ refreshKey }: { refreshKey: number }) {
  const { employee } = useAuth();
  const [data, setData] = useState<SalesDay | null>(null);
  const enabled = canView(employee, 'inquiries');

  const load = useCallback(async () => {
    if (!enabled) return;
    const { data: result, error } = await supabase.rpc('get_my_sales_day');
    setData(error ? null : (result as SalesDay));
  }, [enabled]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (!enabled || !data) return null;
  const followups = data.followups || [];
  const offers = data.waiting_offers || [];
  const tenders = data.tenders || [];
  const weighted = (data.pipeline || []).reduce((sum, stage) => sum + Number(stage.weighted_value || 0), 0);
  if (followups.length + offers.length + tenders.length + (data.unscheduled_inquiries || 0) === 0 && weighted === 0) return null;
  const overdue = followups.filter((item) => item.overdue).length;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Mój dzień</Text>
      <View style={styles.kpis}>
        <View style={styles.kpi}><Text style={[styles.kpiValue, overdue > 0 && styles.alert]}>{followups.length}</Text><Text style={styles.kpiLabel}>Kontakty na dziś{overdue > 0 ? ` (${overdue} zaległe)` : ''}</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiValue}>{offers.length}</Text><Text style={styles.kpiLabel}>Oferty bez odpowiedzi</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiValue}>{tenders.length}</Text><Text style={styles.kpiLabel}>Przetargi w 7 dni</Text></View>
      </View>
      {data.unscheduled_inquiries > 0 && (
        <Text style={styles.note}>Zapytania bez zaplanowanego kontaktu: {data.unscheduled_inquiries}</Text>
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
});
