import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useIsFocused, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors, spacing, borderRadius, typography, tone } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { canView } from '../lib/permissions';
import { useForegroundEffect } from '../hooks/useForegroundEffect';
import { CRM_WEB_URL, navigateToEvent, navigateToSellerChat, openInCrmWeb } from '../navigation/navigationRef';
import {
  type SellerDetail,
  type SellerDetailOffer,
  fetchSellerDetail,
  resendSellerInvite,
  sellerCockpitCrmPath,
} from '../lib/sellerCockpitApi';
import {
  SELLER_JOURNEY_ACTOR_LABELS,
  SELLER_JOURNEY_FILTERS,
  SELLER_JOURNEY_STAGES,
  type SellerJourneyTone,
  sellerJourneyMatches,
} from '../lib/offerJourney';
import type { SellerReadinessAction, SellerReadinessState, SellerReadinessStep } from '../lib/sellerReadiness';
import { SELLER_PORTAL_ACCOUNT_LABELS, type SellerPortalAccount } from '../lib/sellerCockpit';
import { sellerConversationLabel } from '../lib/sellerChat';
import { STATUS_LABELS as EVENT_STATUS_LABELS } from './EventsScreen';

/*
 * Karta sprzedawcy w aplikacji („Moi sprzedawcy” → sprzedawca) — jak karta w CRM i na Macu:
 * „Gotowość do pracy” (kroki z sellerReadiness.ts), oferty na osi w 5 etapach (offerJourney.ts, widok opiekuna),
 * rozmowy i wydarzenia. Rozmowy i wydarzenia otwierają się w aplikacji; ustawienia sprzedawcy, sale w lokalizacji,
 * wygląd ofert i ocena oferty — w CRM w przeglądarce. „Wyślij zaproszenie ponownie” działa w aplikacji
 * (ta sama trasa co w CRM i na Macu).
 */

type DetailRoute = RouteProp<RootStackParamList, 'SellerDetail'>;
type LoadStatus = 'loading' | 'ready' | 'denied' | 'error';
type IconName = keyof typeof Feather.glyphMap;

const ERROR_TEXT = tone('#ff9999');

const formatDate = (value: string | null | undefined, withTime = false): string => {
  if (!value) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return '';
  return withTime
    ? date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const formatPln = (value: number | null) =>
  value == null ? '' : `${Math.round(value).toLocaleString('pl-PL')} zł netto`;

const joinMeta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

const TONE_COLORS: Record<SellerJourneyTone, string> = {
  action: colors.primary.gold,
  waiting: colors.text.secondary,
  success: colors.status.success,
  danger: colors.status.error,
  neutral: colors.text.tertiary,
};

const READINESS_ICONS: Record<SellerReadinessState, { icon: IconName; color: string; label: string }> = {
  done: { icon: 'check-circle', color: colors.status.success, label: 'Gotowe' },
  todo: { icon: 'alert-circle', color: colors.status.warning, label: 'Do zrobienia' },
  waiting: { icon: 'clock', color: colors.primary.gold, label: 'Czeka na hotel' },
  optional: { icon: 'circle', color: colors.text.tertiary, label: 'Zalecane' },
};

const PORTAL_ACCOUNT_COLORS: Record<SellerPortalAccount, string> = {
  active: colors.status.success,
  invited: colors.status.warning,
  none: colors.text.tertiary,
};

export default function SellerDetailScreen() {
  const route = useRoute<DetailRoute>();
  const { sellerId, contactId, name, organization } = route.params;
  const { employee } = useAuth();
  const focused = useIsFocused();
  const canOpenEvents = canView(employee, 'events');
  const [data, setData] = useState<SellerDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [resending, setResending] = useState(false);
  const readVersion = useRef(0);
  const card = { id: sellerId, contact_id: contactId };

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current;
    const result = await fetchSellerDetail(sellerId);
    if (signal?.aborted || version !== readVersion.current) return;
    if (result.status === 'ready') {
      setData(result.data);
      setStatus('ready');
      setMessage('');
    } else {
      // Ostatnie poprawne dane zostają widoczne z komunikatem o błędzie odświeżenia.
      setStatus(result.status);
      setMessage(result.message);
    }
  }, [sellerId]);

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

  const resend = () => {
    if (resending) return;
    Alert.alert(
      'Wysłać zaproszenie ponownie?',
      'Sprzedawca dostanie e-mail z nowym linkiem do ustawienia hasła w portalu. Poprzedni link przestanie działać.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Wyślij',
          onPress: async () => {
            setResending(true);
            try {
              const result = await resendSellerInvite(CRM_WEB_URL, sellerId);
              Alert.alert(
                result.emailSent ? 'Zaproszenie wysłane' : 'Konto jest już połączone',
                result.emailSent
                  ? `Zaproszenie wysłano ponownie${result.email ? ` na ${result.email}` : ''}.`
                  : `Konto ${result.email || 'sprzedawcy'} jest już połączone z portalem.`,
              );
              void load();
            } catch (error) {
              Alert.alert('Nie udało się wysłać zaproszenia', error instanceof Error ? error.message : 'Spróbuj ponownie.');
            } finally {
              setResending(false);
            }
          },
        },
      ],
    );
  };

  const runAction = (action: SellerReadinessAction) => {
    if (action.kind === 'resend') resend();
    else if (action.kind === 'link') openInCrmWeb(action.href);
    else if (action.kind === 'branding') openInCrmWeb(sellerCockpitCrmPath.sellerCard(card, 'branding'));
    // Sekcje ustawień (organizacja, marki, dostęp, opiekun) są na karcie sprzedawcy w CRM.
    else openInCrmWeb(sellerCockpitCrmPath.sellerCard(card, 'settings'));
  };

  const header = (
    <View style={styles.row}>
      <Text style={styles.name}>{name}</Text>
      {!!organization && <Text style={styles.meta}>{organization}</Text>}
      {data && (
        <>
          <View style={styles.chipRow}>
            <Chip
              text={SELLER_PORTAL_ACCOUNT_LABELS[data.portal.account as SellerPortalAccount] || 'Bez konta w portalu'}
              color={PORTAL_ACCOUNT_COLORS[data.portal.account as SellerPortalAccount] || colors.text.tertiary}
            />
            {!data.manager.ok && <Chip text={data.manager.name ? 'Opiekun bez uprawnień' : 'Brak opiekuna'} color={colors.status.warning} />}
          </View>
          <Text style={styles.metaMuted}>
            {joinMeta(
              `Opiekun: ${data.manager.name || 'brak'}`,
              data.manager.backupName ? `zastępca: ${data.manager.backupName}` : null,
              data.portal.lastSignInAt ? `logowanie ${formatDate(data.portal.lastSignInAt, true)}` : null,
            )}
          </Text>
        </>
      )}
      <View style={styles.actions}>
        <ActionButton icon="external-link" label="Karta w CRM" onPress={() => openInCrmWeb(sellerCockpitCrmPath.sellerCard(card))} />
        <ActionButton icon="settings" label="Ustawienia" onPress={() => openInCrmWeb(sellerCockpitCrmPath.sellerCard(card, 'settings'))} />
      </View>
    </View>
  );

  const renderBody = () => {
    if (!data) {
      if (status === 'loading') {
        return (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.primary.gold} />
          </View>
        );
      }
      return (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.errorText}>{message || 'Nie udało się pobrać karty sprzedawcy.'}</Text>
          {status === 'error' && (
            <TouchableOpacity accessibilityRole="button" onPress={() => void refresh()}>
              <Text style={styles.link}>Spróbuj ponownie</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    const offers = data.offers.filter((offer) => sellerJourneyMatches(offer.journey, filter));
    const mine = data.offers.filter((offer) => offer.journey.needsAction).length;

    return (
      <>
        {status === 'error' && !!message && <Text accessibilityRole="alert" style={[styles.errorText, styles.block]}>{message}</Text>}

        {/* Gotowość do pracy */}
        <Text style={styles.sectionTitle}>Gotowość do pracy</Text>
        {data.readinessError && <Text style={styles.metaMuted}>{data.readinessError}</Text>}
        {data.readiness && (
          <View style={styles.row}>
            <View style={styles.rowHeader}>
              <Feather
                name={data.readiness.summary.ready ? 'check-circle' : 'alert-circle'}
                size={18}
                color={data.readiness.summary.ready ? colors.status.success : colors.status.warning}
                style={{ marginTop: 1 }}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.rowTitle}>
                  {data.readiness.summary.complete
                    ? 'Wszystko ustawione'
                    : data.readiness.summary.ready
                      ? 'Hotel może zaczynać'
                      : `Brakuje ${data.readiness.summary.requiredTotal - data.readiness.summary.requiredDone} z ${data.readiness.summary.requiredTotal} wymaganych kroków`}
                </Text>
                <Text style={styles.metaMuted}>
                  Wymagane: {data.readiness.summary.requiredDone}/{data.readiness.summary.requiredTotal} · wszystkie: {data.readiness.summary.done}/{data.readiness.summary.total}
                </Text>
              </View>
            </View>
            <View style={styles.progress}>
              <View style={[styles.progressFill, { width: `${Math.round((data.readiness.summary.done / Math.max(1, data.readiness.summary.total)) * 100)}%` }]} />
            </View>
            {data.readiness.steps.map((step) => (
              <ReadinessRow key={step.key} step={step} busy={resending && step.action?.kind === 'resend'} onAction={runAction} />
            ))}
          </View>
        )}

        {/* Oferty na osi */}
        <Text style={styles.sectionTitle}>Oferty na osi ({data.offers.length})</Text>
        {!data.canViewOffers && <Text style={styles.empty}>Nie masz dostępu do ofert tego sprzedawcy.</Text>}
        {data.canViewOffers && data.offers.length === 0 && <Text style={styles.empty}>Sprzedawca nie ma jeszcze ofert.</Text>}
        {data.offers.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {SELLER_JOURNEY_FILTERS.map((item) => {
              const active = filter === item.value;
              const label = item.value === 'mine' ? `${item.label} (${mine})` : item.label;
              return (
                <TouchableOpacity
                  key={item.value}
                  onPress={() => setFilter(item.value)}
                  style={[styles.filter, active && styles.filterActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {data.offers.length > 0 && offers.length === 0 && <Text style={styles.empty}>Brak ofert w tym etapie.</Text>}
        {offers.map((offer) => (
          <OfferRow key={offer.id} offer={offer} />
        ))}

        {/* Rozmowy */}
        {data.conversations.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Rozmowy ({data.conversations.length})</Text>
            {data.conversations.map((conversation) => (
              <TouchableOpacity
                key={conversation.id}
                style={styles.row}
                onPress={() => navigateToSellerChat(conversation.id)}
                accessibilityRole="button"
                accessibilityLabel={`${sellerConversationLabel(conversation)}: ${conversation.title}`}
                accessibilityHint="Otwiera rozmowę ze sprzedawcą"
              >
                <View style={styles.rowHeader}>
                  <Feather name="message-circle" size={16} color={colors.primary.gold} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.kindText}>{sellerConversationLabel(conversation)}</Text>
                    <Text style={styles.rowTitle} numberOfLines={2}>{conversation.title}</Text>
                    {!!conversation.last_message && <Text style={styles.metaMuted} numberOfLines={2}>{conversation.last_message}</Text>}
                    {!!conversation.last_at && <Text style={styles.meta}>{formatDate(conversation.last_at, true)}</Text>}
                  </View>
                  {conversation.unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{conversation.unread}</Text>
                    </View>
                  )}
                  <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* Wydarzenia */}
        <Text style={styles.sectionTitle}>Wydarzenia ({data.events.length})</Text>
        {data.events.length === 0 && <Text style={styles.empty}>Sprzedawca nie ma jeszcze wydarzeń.</Text>}
        {data.events.map((event) => {
          const onOpen = canOpenEvents ? () => navigateToEvent(event.id) : undefined;
          return (
            <TouchableOpacity
              key={event.id}
              style={styles.row}
              disabled={!onOpen}
              activeOpacity={onOpen ? 0.7 : 1}
              onPress={onOpen}
              accessibilityRole={onOpen ? 'button' : undefined}
              accessibilityLabel={`${event.name}, ${formatDate(event.event_date)}`}
              accessibilityHint={onOpen ? 'Otwiera szczegóły wydarzenia' : undefined}
            >
              <View style={styles.rowHeader}>
                <View style={styles.dateBadge}>
                  <Text style={styles.dateBadgeText}>{formatDate(event.event_date).slice(0, 5) || '—'}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowTitle} numberOfLines={2}>{event.name}</Text>
                  <Text style={styles.meta}>{joinMeta(EVENT_STATUS_LABELS[event.status] || null, event.brand_name)}</Text>
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
      {header}
      {renderBody()}
    </ScrollView>
  );
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.chip, { backgroundColor: `${color}26` }]}>
      <Text style={[styles.chipText, { color }]}>{text}</Text>
    </View>
  );
}

function ActionButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionButton} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon} size={14} color={colors.primary.gold} />
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function ReadinessRow({ step, busy, onAction }: { step: SellerReadinessStep; busy: boolean; onAction: (action: SellerReadinessAction) => void }) {
  const look = READINESS_ICONS[step.state];
  const action = step.action;
  return (
    <View style={styles.step}>
      <View style={styles.rowHeader}>
        <Feather name={look.icon} size={16} color={look.color} style={{ marginTop: 2 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.stepTitle}>
            {step.label}
            {!step.required && <Text style={styles.metaMuted}> · zalecane</Text>}
          </Text>
          <Text style={styles.meta}>{step.detail}</Text>
          {step.state !== 'done' && <Text style={[styles.kindText, { color: look.color }]}>{look.label}</Text>}
        </View>
      </View>
      {!!action && (
        <TouchableOpacity
          style={[styles.stepAction, busy && { opacity: 0.5 }]}
          disabled={busy}
          onPress={() => onAction(action)}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.kind === 'resend' ? 'Wysyła e-mail z nowym linkiem do portalu' : 'Otwiera CRM w przeglądarce'}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary.gold} />
          ) : (
            <Feather name={action.kind === 'resend' ? 'send' : 'external-link'} size={13} color={colors.primary.gold} />
          )}
          <Text style={styles.actionText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function OfferRow({ offer }: { offer: SellerDetailOffer }) {
  const journey = offer.journey;
  const tone = TONE_COLORS[journey.tone];
  const actor = SELLER_JOURNEY_ACTOR_LABELS[journey.actor].manager;
  return (
    <TouchableOpacity
      style={[styles.row, journey.needsAction && styles.rowAction]}
      onPress={() => openInCrmWeb(sellerCockpitCrmPath.offer(offer.id))}
      accessibilityRole="button"
      accessibilityLabel={`${offer.title}, etap ${journey.stageLabel}: ${journey.state}`}
      accessibilityHint="Otwiera ofertę w CRM w przeglądarce"
    >
      <View style={styles.rowHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.rowTitle} numberOfLines={2}>{offer.title}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {joinMeta(offer.number, offer.client, offer.eventDate ? formatDate(offer.eventDate) : null)}
          </Text>
          <Text style={styles.metaMuted} numberOfLines={1}>{joinMeta(offer.brand, formatPln(offer.net))}</Text>
        </View>
        <Feather name="external-link" size={16} color={colors.text.tertiary} />
      </View>
      <View style={styles.journeyBar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {SELLER_JOURNEY_STAGES.map((stage, index) => (
          <View
            key={stage.key}
            style={[
              styles.journeySegment,
              index < journey.index && { backgroundColor: 'rgba(211, 187, 115, 0.45)' },
              index === journey.index && { backgroundColor: journey.ended ? colors.text.tertiary : tone },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.journeyState, { color: tone }]}>
        {journey.index + 1}. {journey.stageLabel} · {journey.state}
      </Text>
      <Text style={styles.metaMuted}>
        {journey.now}
        {journey.actor !== 'none' ? ` Działa: ${actor}.` : ''}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  loading: { paddingVertical: spacing.xxl, alignItems: 'center' },
  block: { paddingVertical: spacing.sm },
  errorText: { color: ERROR_TEXT, fontSize: 13, lineHeight: 18 },
  link: { color: colors.primary.gold, paddingVertical: 8 },
  name: { color: colors.text.primary, fontSize: 18, fontWeight: typography.fontWeights.semibold },
  sectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '400',
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
  rowAction: { borderColor: 'rgba(211, 187, 115, 0.35)' },
  rowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowTitle: { color: colors.text.primary, fontSize: 15, fontWeight: '600' },
  kindText: { color: colors.text.tertiary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  meta: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, lineHeight: 17 },
  metaMuted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, lineHeight: 17 },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.sm },
  chipText: { fontSize: 11, fontWeight: typography.fontWeights.semibold },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(211, 187, 115, 0.1)',
  },
  actionText: { color: colors.primary.gold, fontSize: 12, fontWeight: typography.fontWeights.semibold },
  progress: { height: 4, borderRadius: 2, backgroundColor: colors.background.tertiary, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: colors.primary.gold },
  step: { paddingTop: 8, gap: 6, borderTopWidth: 1, borderTopColor: colors.border.default },
  stepTitle: { color: colors.text.primary, fontSize: 14, fontWeight: typography.fontWeights.semibold },
  stepAction: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 24,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(211, 187, 115, 0.1)',
  },
  filters: { gap: 6, paddingVertical: 2 },
  filter: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  filterActive: { backgroundColor: 'rgba(211, 187, 115, 0.15)', borderColor: 'transparent' },
  filterText: { color: colors.text.secondary, fontSize: 12 },
  filterTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  journeyBar: { flexDirection: 'row', gap: 3 },
  journeySegment: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.background.tertiary },
  journeyState: { fontSize: 12, fontWeight: typography.fontWeights.semibold },
  badge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.primary.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.background.primary, fontSize: 11, fontWeight: typography.fontWeights.bold },
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
