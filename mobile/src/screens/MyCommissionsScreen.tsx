import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { navigateToEvent } from '../navigation/navigationRef';
import {
  COMMISSION_ENTRY_KIND_LABELS,
  COMMISSION_PAYMENT_LABELS,
  COMMISSION_STATUS_LABELS,
  type MyCommissionRow,
  type MyCommissions,
  SETTLEMENT_STATUS_LABELS,
  formatPercent,
  formatPln,
} from '../lib/eventSettlement';
import { SETTLEMENT_DATABASE_UPDATE_MESSAGE, fetchMyCommissions } from '../lib/eventSettlementApi';
import { COMMISSION_STATUS_COLORS, formatSettlementDate } from '../components/Events/EventDetailScreen/SummaryTab';

/*
 * „Moje prowizje” zalogowanego pracownika — RPC get_my_commissions (konto prowizji pracownika, to samo co w CRM).
 * Sumy, statusy, podstawy i stawki pochodzą z bazy; aplikacja tylko je wyświetla. Dotknięcie wpisu otwiera
 * wydarzenie na zakładce „Podsumowanie” (gdy osoba ma obszar „kwoty” tego wydarzenia; inaczej „Szczegóły”).
 */

type LoadStatus = 'loading' | 'ready' | 'missing' | 'denied' | 'error';

const ERROR_TEXT = '#ff9999';

const TOTAL_TILES: { key: keyof MyCommissions['totals']; label: string }[] = [
  { key: 'forecast', label: 'Prognoza' },
  { key: 'to_pay', label: 'Do wypłaty' },
  { key: 'paid', label: 'Wypłacone' },
  { key: 'to_offset', label: 'Do potrącenia' },
];

const joinMeta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

function termsLabel(data: MyCommissions): string {
  if (!data.enabled) {
    return 'Prowizja od sprzedaży jest wyłączona. Warunki ustawia administrator w karcie pracownika.';
  }
  return (
    `Prowizja od sprzedaży: ${formatPercent(data.standard_rate)} zysku netto, ` +
    `${formatPercent(data.own_client_rate)} przy kliencie własnym · ${COMMISSION_PAYMENT_LABELS[data.payment_method] || 'Inny sposób'}`
  );
}

export default function MyCommissionsScreen() {
  const { employee } = useAuth();
  const focused = useIsFocused();
  const canOpenEvents = canView(employee, 'events');
  const [data, setData] = useState<MyCommissions | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const readVersion = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current;
    const result = await fetchMyCommissions();
    if (signal?.aborted || version !== readVersion.current) return;
    if (result.status === 'ready') {
      setData(result.data);
      setStatus('ready');
      setMessage('');
    } else if (result.status === 'error') {
      // Ostatnie poprawne dane zostają widoczne z komunikatem o błędzie odświeżenia.
      setStatus('error');
      setMessage(result.message);
    } else {
      setData(null);
      setStatus(result.status);
      setMessage(result.status === 'denied' ? result.message : '');
    }
  }, []);

  useForegroundEffect(
    (signal) => {
      if (!focused) return;
      void load(signal);
      return () => {
        readVersion.current++;
      };
    },
    [focused, load],
  );

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const renderContent = () => {
    if (!data) {
      if (status === 'missing') {
        return (
          <View style={styles.notice} accessibilityRole="alert">
            <Feather name="database" size={16} color={colors.primary.gold} />
            <View style={{ flex: 1 }}>
              <Text style={styles.noticeTitle}>{SETTLEMENT_DATABASE_UPDATE_MESSAGE}</Text>
              <Text style={styles.noticeText}>Moje prowizje będą dostępne po wdrożeniu migracji w bazie.</Text>
            </View>
          </View>
        );
      }
      if (status === 'denied') {
        return (
          <View style={styles.notice} accessibilityRole="alert">
            <Feather name="shield" size={16} color={colors.primary.gold} />
            <Text style={[styles.noticeText, { flex: 1 }]}>{message || 'Wymagane konto pracownika.'}</Text>
          </View>
        );
      }
      if (status === 'error') {
        return (
          <View style={styles.block}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {message || 'Nie udało się pobrać Twoich prowizji.'}
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => void refresh()}>
              <Text style={styles.link}>Spróbuj ponownie</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      );
    }

    return (
      <>
        <View style={styles.terms}>
          <Feather name="info" size={15} color={colors.primary.gold} style={{ marginTop: 1 }} />
          <Text style={styles.termsText}>{termsLabel(data)}</Text>
        </View>

        <View style={styles.tiles}>
          {TOTAL_TILES.map((tile) => {
            const value = data.totals[tile.key];
            return (
              <View key={tile.key} style={styles.tile}>
                <Text style={styles.tileLabel}>{tile.label}</Text>
                <Text
                  style={[
                    styles.tileValue,
                    tile.key === 'to_pay' && styles.tileValueGold,
                    tile.key === 'to_offset' && value > 0 && { color: ERROR_TEXT },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatPln(value)}
                </Text>
              </View>
            );
          })}
        </View>

        {status === 'error' && !!message && (
          <Text accessibilityRole="alert" style={[styles.errorText, styles.block]}>
            {message}
          </Text>
        )}

        <Text style={styles.sectionTitle}>Prowizje z wydarzeń ({data.commissions.length})</Text>
        {data.commissions.length === 0 && <Text style={styles.empty}>Nie masz jeszcze prowizji z wydarzeń.</Text>}
        {data.commissions.map((row) => (
          <CommissionRow
            key={row.id}
            row={row}
            onOpen={canOpenEvents && row.event_id ? () => navigateToEvent(row.event_id, 'summary') : undefined}
          />
        ))}
      </>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary.gold} />
      }
    >
      {renderContent()}
    </ScrollView>
  );
}

function CommissionRow({ row, onOpen }: { row: MyCommissionRow; onOpen?: () => void }) {
  const statusColor = COMMISSION_STATUS_COLORS[row.status] || colors.text.secondary;
  const deduction = row.entry_kind === 'deduction';
  const date = formatSettlementDate(row.event_date);
  return (
    <TouchableOpacity
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={`${row.event_name}: ${COMMISSION_STATUS_LABELS[row.status] || row.status}, ${formatPln(row.amount)}`}
      accessibilityHint={onOpen ? 'Otwiera podsumowanie wydarzenia' : undefined}
      activeOpacity={onOpen ? 0.7 : 1}
      disabled={!onOpen}
      onPress={onOpen}
      style={styles.row}
    >
      <View style={styles.rowHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventName} numberOfLines={2}>
            {row.event_name}
          </Text>
          {!!date && <Text style={styles.meta}>{date}</Text>}
        </View>
        <Text style={[styles.amount, deduction && { color: ERROR_TEXT }]}>{formatPln(row.amount)}</Text>
        {!!onOpen && <Feather name="chevron-right" size={18} color={colors.text.tertiary} />}
      </View>
      <View style={styles.chipRow}>
        <View style={[styles.chip, { backgroundColor: `${statusColor}26` }]}>
          <Text style={[styles.chipText, { color: statusColor }]}>{COMMISSION_STATUS_LABELS[row.status] || row.status}</Text>
        </View>
        {row.entry_kind !== 'accrual' && (
          <View style={[styles.chip, { backgroundColor: deduction ? 'rgba(239, 68, 68, 0.15)' : 'rgba(211, 187, 115, 0.15)' }]}>
            <Text style={[styles.chipText, { color: deduction ? ERROR_TEXT : colors.primary.gold }]}>
              {COMMISSION_ENTRY_KIND_LABELS[row.entry_kind]}
            </Text>
          </View>
        )}
      </View>
      {!!row.base_description && <Text style={styles.meta}>{row.base_description}</Text>}
      {(row.rate != null || !!row.rate_reason) && (
        <Text style={styles.meta}>
          {joinMeta(
            row.rate != null ? `Stawka ${formatPercent(row.rate)}` : null,
            row.rate_reason,
            row.share_percent != null && row.share_percent !== 100 ? `udział ${formatPercent(row.share_percent)}` : null,
          )}
        </Text>
      )}
      {/* Wypłaty (przelewy) i potrącenia osobno — kwoty z bazy; przy potrąceniu „pozostało” = jeszcze do potrącenia. */}
      {(row.paid_amount > 0 || row.offset_amount > 0 || row.remaining_amount > 0) && (
        <Text style={styles.meta}>
          {joinMeta(
            row.paid_amount > 0 ? `Wypłacono ${formatPln(row.paid_amount)}` : null,
            row.offset_amount > 0 ? `rozliczono potrąceniem ${formatPln(row.offset_amount)}` : null,
            row.remaining_amount > 0
              ? `${deduction ? 'do potrącenia' : 'pozostało do wypłaty'} ${formatPln(row.remaining_amount)}`
              : null,
          )}
        </Text>
      )}
      {row.payments.map((payment, index) => (
        <Text key={`${payment.payment_date ?? ''}-${index}`} style={styles.metaMuted}>
          {joinMeta(
            payment.is_offset ? 'Potrącenie' : 'Wypłata',
            formatSettlementDate(payment.payment_date),
            formatPln(payment.amount),
            payment.reference,
          )}
        </Text>
      ))}
      <Text style={styles.metaMuted}>Podsumowanie: {SETTLEMENT_STATUS_LABELS[row.settlement_status]}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  block: { paddingVertical: spacing.sm },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(211, 187, 115, 0.08)',
  },
  noticeTitle: { color: colors.text.primary, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  noticeText: { fontSize: 13, lineHeight: 18, color: colors.text.secondary },
  errorText: { color: ERROR_TEXT, fontSize: 13, lineHeight: 18 },
  link: { color: colors.primary.gold, paddingVertical: 8 },
  terms: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(211, 187, 115, 0.08)',
  },
  termsText: { flex: 1, color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: 12,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    gap: 4,
  },
  tileLabel: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', letterSpacing: 0.4 },
  tileValue: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold },
  tileValueGold: { color: colors.primary.gold },
  sectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
  },
  empty: { color: colors.text.tertiary, fontSize: 13 },
  row: {
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    gap: 4,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  eventName: { color: colors.text.primary, fontSize: 15, fontWeight: '600' },
  amount: { color: colors.text.primary, fontSize: 15, fontWeight: '700' },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.sm },
  chipText: { fontSize: 11, fontWeight: typography.fontWeights.semibold },
  meta: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, lineHeight: 17 },
  metaMuted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
});
