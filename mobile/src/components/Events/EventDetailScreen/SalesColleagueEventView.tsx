import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../../theme';
import { STATUS_COLORS, STATUS_LABELS } from '../../../screens/EventsScreen';
import {
  EVENT_ACCESS_ROLE_LABELS,
  type EventAccess,
  type EventSalesOverview,
  eventAccessSummary,
  salesOverviewProductLabel,
} from '../../../lib/eventAccess';
import { InfoRow } from './InfoRow';

/*
 * Wydarzenie innego sprzedawcy (obszar sales_overview bez realizacji, migracja 20261105110000) — tylko podgląd
 * „Szczegóły”: termin, miejsce, kategoria, status, klient, kto sprzedał i sprzedane usługi, bez kwot. Dane pochodzą
 * wyłącznie z RPC get_event_sales_overview (jak w CRM); zakładki, kroki, zespół, flota, pliki i czynności są ukryte.
 */

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pl-PL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export function SalesColleagueEventView({
  overview,
  access,
  fallbackName,
  refreshing,
  onRefresh,
  onBack,
}: {
  /** null — nie udało się pobrać podglądu. */
  overview: EventSalesOverview | null;
  access: EventAccess | null;
  fallbackName?: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onBack: () => void;
}) {
  const event = overview?.event ?? null;
  const name = event?.name?.trim() || fallbackName || 'Wydarzenie';
  const status = event?.status ? String(event.status).trim().toLowerCase() : '';
  const statusColor = STATUS_COLORS[status] || '#6b7280';
  const statusLabel = STATUS_LABELS[status] || 'Wydarzenie';
  const start = formatDateTime(event?.event_date);
  const end = formatDateTime(event?.event_end_date);
  const soldBy = overview?.sold_by ?? [];
  const products = overview?.products ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBackBtn} accessibilityRole="button" accessibilityLabel="Wróć">
          <Feather name="arrow-left" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.headerMeta}>
            {Boolean(event?.category) && <Text style={styles.headerCategory}>{event?.category}</Text>}
            <View style={styles.colleagueBadge}>
              <Text style={styles.colleagueBadgeText}>{EVENT_ACCESS_ROLE_LABELS.colleague}</Text>
            </View>
          </View>
        </View>
        {Boolean(event) && (
          <View style={[styles.headerStatus, { backgroundColor: `${statusColor}20` }]}>
            <Text style={[styles.headerStatusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        )}
      </View>

      <View style={styles.tabBar}>
        <View style={[styles.tab, styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: true }}>
          <Feather name="info" size={14} color={colors.primary.gold} />
          <Text style={styles.tabTextActive}>Szczegóły</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary.gold} />}
      >
        <View style={styles.notice}>
          <Feather name="eye" size={16} color={colors.text.secondary} />
          <Text style={styles.noticeText}>{eventAccessSummary(access)}</Text>
        </View>

        {!overview ? (
          <View style={styles.errorBox}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              Nie udało się pobrać podglądu wydarzenia.
            </Text>
            <TouchableOpacity accessibilityRole="button" onPress={onRefresh} disabled={refreshing}>
              <Text style={styles.link}>{refreshing ? 'Odświeżanie…' : 'Spróbuj ponownie'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Termin i miejsce</Text>
              <View style={styles.infoGrid}>
                <InfoRow icon="calendar" label="Rozpoczęcie" value={start || 'Termin nieustalony'} />
                {Boolean(end) && <InfoRow icon="clock" label="Zakończenie" value={end ?? ''} />}
                <InfoRow icon="map-pin" label="Miejsce" value={event?.location?.trim() || 'Nie wskazano'} />
                {Boolean(event?.category) && <InfoRow icon="tag" label="Kategoria" value={event?.category ?? ''} />}
                {Boolean(event) && <InfoRow icon="activity" label="Status" value={statusLabel} />}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sprzedaż</Text>
              <View style={styles.infoGrid}>
                <InfoRow icon="briefcase" label="Klient" value={overview.client_name || 'Nie wskazano'} />
                <InfoRow icon="user" label="Sprzedał(a)" value={soldBy.length ? soldBy.join(', ') : 'Nie wskazano'} />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sprzedane usługi</Text>
              {products.length === 0 ? (
                <Text style={styles.emptyText}>Brak usług z zaakceptowanej oferty.</Text>
              ) : (
                <View style={styles.infoGrid}>
                  {products.map((product, index) => (
                    <View key={`${product.name}-${index}`} style={styles.productRow}>
                      <Feather name="check" size={14} color={colors.primary.gold} />
                      <Text style={styles.productText}>{salesOverviewProductLabel(product)}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerContent: { flex: 1 },
  headerTitle: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  headerMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  headerCategory: { fontSize: 11, color: colors.text.secondary },
  headerStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginLeft: 8 },
  headerStatusText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  colleagueBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: colors.background.tertiary,
  },
  colleagueBadgeText: { fontSize: 10, color: colors.text.tertiary, fontWeight: '600' },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.background.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  tab: {
    minWidth: 104,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.primary.gold },
  tabTextActive: { fontSize: 11, color: colors.primary.gold, fontWeight: '700' },
  scrollView: { flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.background.secondary,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.text.secondary },
  errorBox: { padding: spacing.md, gap: 4 },
  errorText: { color: '#ff9999', fontSize: 14 },
  link: { color: colors.primary.gold, paddingVertical: 8 },
  section: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  sectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  infoGrid: { gap: 8 },
  emptyText: { fontSize: 13, color: colors.text.tertiary },
  productRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  productText: { flex: 1, fontSize: 13, color: colors.text.primary, lineHeight: 18 },
});
