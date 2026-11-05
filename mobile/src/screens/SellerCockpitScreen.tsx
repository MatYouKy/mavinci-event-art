import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { navigateToEvent, navigateToSellerChat, openInCrmWeb } from '../navigation/navigationRef';
import {
  SELLER_EVENT_TYPE_LABELS,
  SELLER_INQUIRY_STATUS_LABELS,
  SELLER_PIPELINE_LABELS,
  SELLER_PORTAL_ACCOUNT_LABELS,
  SELLER_REALIZATION_STEP_LABELS,
  SELLER_WARNING_LABELS,
  type SellerCockpit,
  type SellerCockpitSeller,
  type SellerPortalAccount,
  type SellerWarningCode,
  formatWaitingHours,
  sellerCockpitTodayCount,
} from '../lib/sellerCockpit';
import { SELLER_COCKPIT_DATABASE_UPDATE_MESSAGE, fetchSellerCockpit, sellerCockpitCrmPath } from '../lib/sellerCockpitApi';
import { STATUS_LABELS as EVENT_STATUS_LABELS } from './EventsScreen';

/*
 * „Moi sprzedawcy” — kokpit opiekuna sprzedawców zewnętrznych (RPC get_my_seller_cockpit, to samo co CRM).
 * Tylko odczyt: „Dziś” (sprawy czekające na opiekuna), lista sprzedawców i najbliższe wydarzenia. Zakres liczy baza
 * (opiekun / zastępca; administrator widzi wszystkich). Rozmowa otwiera się w aplikacji, wydarzenie — w szczegółach
 * wydarzenia; decyzje (sprawdzenie oferty, potwierdzenie wydarzenia, odpowiedź na zapytanie, opiekun, prowizje)
 * podejmuje się w CRM, więc pozostałe sprawy otwierają CRM w przeglądarce.
 */

type LoadStatus = 'loading' | 'ready' | 'missing' | 'denied' | 'error';
type IconName = keyof typeof Feather.glyphMap;

const ERROR_TEXT = '#ff9999';

const formatDate = (value: string | null | undefined, withTime = false): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return withTime
    ? date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const joinMeta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

const PORTAL_ACCOUNT_COLORS: Record<SellerPortalAccount, string> = {
  active: colors.status.success,
  invited: colors.status.warning,
  none: colors.text.tertiary,
};

/** Ostrzeżenie sprzedawcy: kod z bazy → polska etykieta; nieznany kod nigdy nie trafia na ekran. */
function warningLabel(value: string): string {
  const label = SELLER_WARNING_LABELS[value as SellerWarningCode];
  if (label) return label;
  return /^[a-z0-9_]+$/.test(value) ? 'Wymaga uwagi' : value;
}

type TodayRow = {
  key: string;
  icon: IconName;
  kind: string;
  title: string;
  meta: string;
  detail?: string;
  /** true = otwiera ekran w aplikacji; false = CRM w przeglądarce. */
  inApp: boolean;
  urgent?: boolean;
  onPress: () => void;
};

function buildTodayRows(cockpit: SellerCockpit): TodayRow[] {
  const t = cockpit.today;
  const rows: TodayRow[] = [];
  for (const chat of t.chats_waiting) {
    rows.push({
      key: `chat-${chat.conversation_id}`,
      icon: 'message-circle',
      kind: 'Rozmowa bez odpowiedzi',
      title: chat.title,
      meta: joinMeta(chat.seller_name, `czeka ${formatWaitingHours(chat.waiting_hours)}`),
      detail: chat.preview || undefined,
      inApp: true,
      urgent: chat.waiting_hours >= 24,
      onPress: () => navigateToSellerChat(chat.conversation_id),
    });
  }
  for (const review of t.reviews) {
    rows.push({
      key: `review-${review.offer_id}-${review.document_id ?? ''}`,
      icon: 'file-text',
      kind: 'Oferta do sprawdzenia',
      title: joinMeta(review.title, review.offer_number) || 'Oferta',
      meta: joinMeta(review.seller_name, formatDate(review.requested_at, true)),
      inApp: false,
      onPress: () => openInCrmWeb(sellerCockpitCrmPath.review(review)),
    });
  }
  for (const inquiry of t.inquiries) {
    rows.push({
      key: `inquiry-${inquiry.id}`,
      icon: 'inbox',
      kind: inquiry.source === 'qr' ? 'Zapytanie z kodu QR' : 'Zapytanie z portalu',
      title: inquiry.guest_name,
      meta: joinMeta(inquiry.seller_name, formatDate(inquiry.created_at, true)),
      detail: joinMeta(
        inquiry.event_date ? `Termin ${formatDate(inquiry.event_date)}` : null,
        inquiry.guest_count != null ? `${inquiry.guest_count} gości` : null,
        inquiry.event_type ? SELLER_EVENT_TYPE_LABELS[inquiry.event_type] || 'Inne' : null,
        SELLER_INQUIRY_STATUS_LABELS[inquiry.status] || null,
      ) || undefined,
      inApp: false,
      onPress: () => openInCrmWeb(sellerCockpitCrmPath.inquiry(inquiry.sales_partner_id, inquiry.id)),
    });
  }
  for (const step of t.wizard_steps) {
    rows.push({
      key: `wizard-${step.offer_id}-${step.step_key}`,
      icon: 'clipboard',
      kind: `Krok realizacji: ${SELLER_REALIZATION_STEP_LABELS[step.step_key] || 'ustalenia'}`,
      title: step.title,
      meta: joinMeta(step.seller_name, formatDate(step.submitted_at, true)),
      inApp: false,
      onPress: () => openInCrmWeb(step.event_id
        ? sellerCockpitCrmPath.eventArrangements(step.event_id)
        : sellerCockpitCrmPath.offer(step.offer_id)),
    });
  }
  for (const event of t.events_pending) {
    rows.push({
      key: `event-${event.event_id}`,
      icon: 'calendar',
      kind: event.confirmation_required ? 'Wydarzenie do potwierdzenia' : 'Godziny do ustalenia',
      title: event.name,
      meta: joinMeta(event.seller_name, formatDate(event.event_date)),
      detail: event.confirmation_required && event.schedule_pending ? 'Godziny są jeszcze do ustalenia.' : undefined,
      inApp: false,
      onPress: () => openInCrmWeb(sellerCockpitCrmPath.event(event.event_id)),
    });
  }
  for (const guest of t.guest_acceptances) {
    rows.push({
      key: `guest-${guest.offer_id}`,
      icon: 'check-circle',
      kind: 'Akceptacja gościa',
      title: guest.title,
      meta: joinMeta(guest.seller_name, guest.accepted_name, formatDate(guest.accepted_at, true)),
      inApp: false,
      onPress: () => openInCrmWeb(sellerCockpitCrmPath.offer(guest.offer_id)),
    });
  }
  return rows;
}

const TODAY_COUNTS: { key: keyof SellerCockpit['today']; label: string }[] = [
  { key: 'reviews', label: 'Do sprawdzenia' },
  { key: 'chats_waiting', label: 'Rozmowy bez odpowiedzi' },
  { key: 'inquiries', label: 'Zapytania' },
  { key: 'wizard_steps', label: 'Kroki realizacji' },
  { key: 'events_pending', label: 'Wydarzenia do potwierdzenia' },
  { key: 'guest_acceptances', label: 'Akceptacje gości' },
];

const OFFER_COUNTS: ('draft' | 'pdf' | 'review' | 'accepted')[] = ['draft', 'pdf', 'review', 'accepted'];

export default function SellerCockpitScreen() {
  const { employee } = useAuth();
  const focused = useIsFocused();
  const canOpenEvents = canView(employee, 'events');
  const [data, setData] = useState<SellerCockpit | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const readVersion = useRef(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current;
    const result = await fetchSellerCockpit();
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
              <Text style={styles.noticeTitle}>{SELLER_COCKPIT_DATABASE_UPDATE_MESSAGE}</Text>
              <Text style={styles.noticeText}>Kokpit sprzedawców będzie dostępny po wdrożeniu migracji w bazie.</Text>
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
              {message || 'Nie udało się pobrać danych sprzedawców.'}
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

    const todayRows = buildTodayRows(data);
    const todayTotal = sellerCockpitTodayCount(data);
    const counts = TODAY_COUNTS.filter(({ key }) => data.today[key].length > 0);
    const isAdmin = data.viewer.is_admin;

    return (
      <>
        <View style={styles.terms}>
          <Feather name="info" size={15} color={colors.primary.gold} style={{ marginTop: 1 }} />
          <Text style={styles.termsText}>
            Podgląd spraw Twoich sprzedawców. Rozmowy i wydarzenia otworzysz w aplikacji; sprawdzenie oferty,
            potwierdzenie wydarzenia i odpowiedź na zapytanie wykonasz w CRM (otwiera się przeglądarka).
          </Text>
        </View>

        {status === 'error' && !!message && (
          <Text accessibilityRole="alert" style={[styles.errorText, styles.block]}>
            {message}
          </Text>
        )}

        {/* Dziś */}
        <Text style={styles.sectionTitle}>Dziś ({todayTotal})</Text>
        {counts.length > 0 && (
          <View style={styles.chipRow}>
            {counts.map(({ key, label }) => (
              <View key={key} style={[styles.chip, styles.chipGold]}>
                <Text style={[styles.chipText, { color: colors.primary.gold }]}>
                  {data.today[key].length} · {label}
                </Text>
              </View>
            ))}
          </View>
        )}
        {todayRows.length === 0 && <Text style={styles.empty}>Nic nie czeka — sprawy sprzedawców są obsłużone.</Text>}
        {todayRows.map((row) => (
          <TouchableOpacity
            key={row.key}
            style={styles.row}
            onPress={row.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${row.kind}: ${row.title}, ${row.meta}`}
            accessibilityHint={row.inApp ? 'Otwiera rozmowę ze sprzedawcą' : 'Otwiera CRM w przeglądarce'}
          >
            <View style={styles.rowHeader}>
              <Feather name={row.icon} size={16} color={row.urgent ? colors.status.warning : colors.primary.gold} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.kindText}>{row.kind}</Text>
                <Text style={styles.rowTitle} numberOfLines={2}>{row.title}</Text>
                {!!row.meta && <Text style={[styles.meta, row.urgent && { color: colors.status.warning }]}>{row.meta}</Text>}
                {!!row.detail && <Text style={styles.metaMuted} numberOfLines={2}>{row.detail}</Text>}
              </View>
              <Feather name={row.inApp ? 'chevron-right' : 'external-link'} size={16} color={colors.text.tertiary} />
            </View>
          </TouchableOpacity>
        ))}

        {/* Moi sprzedawcy */}
        <Text style={styles.sectionTitle}>
          {isAdmin ? 'Sprzedawcy' : 'Moi sprzedawcy'} ({data.sellers.length})
        </Text>
        {data.sellers.length === 0 && (
          <Text style={styles.empty}>{isAdmin ? 'Brak sprzedawców zewnętrznych.' : 'Nie masz przypisanych sprzedawców.'}</Text>
        )}
        {data.sellers.map((seller) => (
          <SellerCard key={seller.id} seller={seller} showManager={isAdmin} />
        ))}

        {/* Najbliższe wydarzenia */}
        <Text style={styles.sectionTitle}>Najbliższe wydarzenia ({data.upcoming.length})</Text>
        {data.upcoming.length === 0 && <Text style={styles.empty}>Brak wydarzeń sprzedawców w najbliższych 14 dniach.</Text>}
        {data.upcoming.map((event) => {
          const onOpen = canOpenEvents && event.event_id ? () => navigateToEvent(event.event_id) : undefined;
          return (
            <TouchableOpacity
              key={event.event_id}
              style={styles.row}
              disabled={!onOpen}
              activeOpacity={onOpen ? 0.7 : 1}
              onPress={onOpen}
              accessibilityRole={onOpen ? 'button' : undefined}
              accessibilityLabel={`${event.name}, ${formatDate(event.event_date)}, ${event.seller_name}`}
              accessibilityHint={onOpen ? 'Otwiera szczegóły wydarzenia' : undefined}
            >
              <View style={styles.rowHeader}>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateBadgeText}>{formatDate(event.event_date).slice(0, 5) || '—'}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{event.name}</Text>
                  <Text style={styles.meta}>
                    {joinMeta(event.seller_name, EVENT_STATUS_LABELS[event.status] || null)}
                  </Text>
                </View>
                {!!onOpen && <Feather name="chevron-right" size={16} color={colors.text.tertiary} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary.gold} />}
    >
      {renderContent()}
    </ScrollView>
  );
}

function SellerCard({ seller, showManager }: { seller: SellerCockpitSeller; showManager: boolean }) {
  const accountColor = PORTAL_ACCOUNT_COLORS[seller.portal_account];
  const lastActivity = seller.last_activity_at || seller.last_sign_in_at;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => openInCrmWeb(sellerCockpitCrmPath.seller(seller.id))}
      accessibilityRole="button"
      accessibilityLabel={`${seller.name}${seller.organization_name ? `, ${seller.organization_name}` : ''}`}
      accessibilityHint="Otwiera kartę sprzedawcy w CRM w przeglądarce"
    >
      <View style={styles.rowHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>{seller.name}</Text>
          {!!seller.organization_name && <Text style={styles.meta} numberOfLines={1}>{seller.organization_name}</Text>}
        </View>
        <Feather name="external-link" size={16} color={colors.text.tertiary} />
      </View>

      <View style={styles.chipRow}>
        <View style={[styles.chip, { backgroundColor: `${accountColor}26` }]}>
          <Text style={[styles.chipText, { color: accountColor }]}>
            {seller.portal_enabled || seller.portal_account !== 'none'
              ? SELLER_PORTAL_ACCOUNT_LABELS[seller.portal_account]
              : 'Portal wyłączony'}
          </Text>
        </View>
        {seller.warnings.map((warning) => (
          <View key={warning} style={[styles.chip, styles.chipWarning]}>
            <Text style={[styles.chipText, { color: colors.status.warning }]}>{warningLabel(warning)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.meta}>
        {lastActivity ? `Ostatnia aktywność: ${formatDate(lastActivity, true)}` : 'Brak aktywności w portalu'}
      </Text>
      {showManager && (
        <Text style={styles.metaMuted}>
          {seller.manager ? `Opiekun: ${seller.manager.name}` : 'Brak opiekuna'}
          {seller.backup_manager ? ` · zastępca: ${seller.backup_manager.name}` : ''}
        </Text>
      )}

      <View style={styles.stats}>
        {OFFER_COUNTS.map((stage) => (
          <View key={stage} style={styles.stat}>
            <Text style={[styles.statValue, stage === 'review' && seller.offers.review > 0 && { color: colors.primary.gold }]}>
              {seller.offers[stage]}
            </Text>
            <Text style={styles.statLabel} numberOfLines={1}>{SELLER_PIPELINE_LABELS[stage]}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.metaMuted}>
        {joinMeta(`Oferty razem: ${seller.offers.total}`, `Nadchodzące wydarzenia: ${seller.upcoming_events}`)}
      </Text>
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
    gap: 6,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowTitle: { color: colors.text.primary, fontSize: 15, fontWeight: '600' },
  kindText: { color: colors.text.tertiary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.sm },
  chipGold: { backgroundColor: 'rgba(211, 187, 115, 0.15)' },
  chipWarning: { backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  chipText: { fontSize: 11, fontWeight: typography.fontWeights.semibold },
  meta: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, lineHeight: 17 },
  metaMuted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  stats: { flexDirection: 'row', gap: 6 },
  stat: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.background.tertiary,
    alignItems: 'center',
    gap: 1,
  },
  statValue: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.bold },
  statLabel: { color: colors.text.tertiary, fontSize: 10 },
  dateBadge: {
    minWidth: 48,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: borderRadius.sm,
    backgroundColor: 'rgba(211, 187, 115, 0.12)',
    alignItems: 'center',
  },
  dateBadgeText: { color: colors.primary.gold, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.bold },
});
