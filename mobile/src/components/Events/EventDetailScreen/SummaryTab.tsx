import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../../theme';
import { openInCrmWeb } from '../../../navigation/navigationRef';
import {
  COMMISSION_ENTRY_KIND_LABELS,
  COMMISSION_PAYMENT_LABELS,
  COMMISSION_SOURCE_LABELS,
  COMMISSION_STATUS_LABELS,
  type CommissionStatus,
  type EventSettlement,
  SALES_SHARE_SOURCE_LABELS,
  SETTLEMENT_SOURCE_LABELS,
  SETTLEMENT_STATUS_LABELS,
  SETTLEMENT_TOTAL_ROWS,
  SETTLEMENT_VERSION_ACTION_LABELS,
  type SettlementLine,
  type SettlementStatus,
  type SettlementTotals,
  formatPercent,
  formatPln,
  internalCommissionLabel,
  settlementLinesBySection,
  settlementTotalValue,
} from '../../../lib/eventSettlement';
import { SETTLEMENT_DATABASE_UPDATE_MESSAGE, submitEventSettlement } from '../../../lib/eventSettlementApi';

/*
 * Zakładka „Podsumowanie” wydarzenia — podgląd tylko do odczytu (RPC get_event_settlement, obszar „kwoty”).
 * Wszystkie kwoty, braki i uprawnienia (can_submit…) pochodzą z bazy; aplikacja niczego nie przelicza.
 * Z aplikacji: „Wyślij do zatwierdzenia” (submit_event_settlement z source_key) i „Edytuj w CRM”.
 * Edycja pozycji, przypisywanie faktur kosztowych i zatwierdzanie zostają w CRM.
 */

/** Stan zakładki prowadzony przez ekran wydarzenia (odczyt razem z resztą ekranu i po pociągnięciu w dół). */
export type EventSummaryState = {
  /** Ostatnie poprawnie odczytane podsumowanie (zostaje widoczne przy chwilowym błędzie odświeżenia). */
  data: EventSettlement | null;
  status: 'idle' | 'ready' | 'missing' | 'denied' | 'error';
  message: string | null;
  loading: boolean;
};

const ERROR_TEXT = '#ff9999';
const WARNING_TEXT = '#fbbf24';

export const SETTLEMENT_STATUS_COLORS: Record<SettlementStatus, string> = {
  draft: colors.primary.gold,
  submitted: '#60a5fa',
  approved: '#4ade80',
};

export const COMMISSION_STATUS_COLORS: Record<CommissionStatus, string> = {
  planned: colors.text.secondary,
  approved: colors.primary.gold,
  paid: '#4ade80',
  cancelled: colors.text.tertiary,
};

/**
 * Dopisek pod wierszem wyniku (wiersze i etykiety: SETTLEMENT_TOTAL_ROWS ze wspólnego pliku) — składniki sumy
 * i kwota prowizji pracowników obok kosztu firmy; same wartości z bazy, bez przeliczeń.
 */
function totalHint(keys: (keyof SettlementTotals)[], totals: SettlementTotals): string | null {
  if (keys.includes('external_commission_lines') && keys.includes('external_commission_auto')) {
    return totals.external_commission_lines !== 0 && totals.external_commission_auto !== 0
      ? `pozycje ${formatPln(totals.external_commission_lines)} · naliczone ${formatPln(totals.external_commission_auto)}`
      : null;
  }
  if (keys.includes('internal_commissions_cost')) {
    return totals.internal_commissions !== totals.internal_commissions_cost
      ? `kwota prowizji ${formatPln(totals.internal_commissions)}`
      : null;
  }
  return null;
}

export function formatSettlementDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return withTime
    ? date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const joinMeta = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');

export function SummaryTab({
  eventId,
  state,
  onReload,
  onUpdated,
}: {
  eventId: string;
  state: EventSummaryState;
  /** Ponowny odczyt podsumowania z bazy. */
  onReload: () => void;
  /** Nowy stan po wysłaniu (wynik RPC). */
  onUpdated: (next: EventSettlement) => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const lock = useRef(false);

  useEffect(() => {
    setNote('');
    setActionError('');
  }, [eventId]);

  const { data } = state;

  if (!data) {
    if (state.status === 'missing') {
      return (
        <View style={styles.notice} accessibilityRole="alert">
          <Feather name="database" size={16} color={colors.primary.gold} />
          <View style={{ flex: 1 }}>
            <Text style={styles.noticeTitle}>{SETTLEMENT_DATABASE_UPDATE_MESSAGE}</Text>
            <Text style={styles.noticeText}>Podsumowanie wydarzenia i prowizje będą dostępne po wdrożeniu migracji w bazie.</Text>
          </View>
        </View>
      );
    }
    if (state.status === 'denied') {
      return (
        <View style={styles.notice} accessibilityRole="alert">
          <Feather name="shield" size={16} color={colors.primary.gold} />
          <Text style={[styles.noticeText, { flex: 1 }]}>
            {state.message || 'Podsumowanie wydarzenia widzi osoba z dostępem do kwot tego wydarzenia.'}
          </Text>
        </View>
      );
    }
    if (state.status === 'error' && !state.loading) {
      return (
        <View style={styles.section}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {state.message || 'Nie udało się pobrać podsumowania wydarzenia.'}
          </Text>
          <TouchableOpacity accessibilityRole="button" onPress={onReload}>
            <Text style={styles.link}>Spróbuj ponownie</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary.gold} />
      </View>
    );
  }

  const totals = data.totals;
  const sections = settlementLinesBySection(data.lines).filter((section) => section.lines.length > 0);
  const statusColor = SETTLEMENT_STATUS_COLORS[data.status];
  const crmLabel = data.can_edit
    ? 'Edytuj w CRM'
    : data.can_approve || data.can_return || data.can_reopen
      ? 'Zatwierdzanie w CRM'
      : 'Otwórz w CRM';

  const doSubmit = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setActionError('');
    try {
      const next = await submitEventSettlement(eventId, note, data.source_key);
      setNote('');
      if (next) onUpdated(next);
      else onReload();
      Alert.alert('Wysłano do zatwierdzenia', 'Podsumowanie czeka na zatwierdzenie administratora.');
    } catch (cause) {
      setActionError(cause instanceof Error && cause.message ? cause.message : 'Nie udało się wysłać podsumowania. Spróbuj ponownie.');
      // Dane mogły się zmienić w międzyczasie — pokazujemy aktualny stan z bazy.
      onReload();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const confirmSubmit = () => {
    if (!data.can_submit || lock.current) return;
    Alert.alert(
      'Wysłać do zatwierdzenia?',
      `Zysk netto: ${formatPln(totals.profit_net)}\nProwizje pracowników: ${formatPln(totals.internal_commissions)}\n\n` +
        'Po wysłaniu podsumowania nie można edytować, dopóki administrator go nie zatwierdzi albo nie zwróci do poprawy.',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Wyślij', onPress: () => void doSubmit() },
      ],
    );
  };

  return (
    <View>
      {/* Status */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Podsumowanie wydarzenia</Text>
        <View style={styles.chipRow}>
          <View style={[styles.chip, { backgroundColor: `${statusColor}26` }]}>
            <Text style={[styles.chipText, { color: statusColor }]}>{SETTLEMENT_STATUS_LABELS[data.status]}</Text>
          </View>
          {data.revision > 0 && <Text style={styles.meta}>wersja {data.revision}</Text>}
          {state.loading && <ActivityIndicator size="small" color={colors.primary.gold} />}
        </View>
        {!!data.submitted && (
          <Text style={styles.meta}>
            {joinMeta(`Wysłane ${formatSettlementDate(data.submitted.at, true)}`, data.submitted.by_name)}
          </Text>
        )}
        {!!data.submitted?.note && <Text style={styles.note}>{data.submitted.note}</Text>}
        {!!data.approved && (
          <Text style={styles.meta}>
            {joinMeta(`Zatwierdzone ${formatSettlementDate(data.approved.at, true)}`, data.approved.by_name)}
          </Text>
        )}
        {!!data.returned && (
          <View style={styles.returned}>
            <Text style={[styles.meta, { color: WARNING_TEXT }]}>
              {joinMeta(`Zwrócone do poprawy ${formatSettlementDate(data.returned.at, true)}`, data.returned.by_name)}
            </Text>
            {!!data.returned.note && <Text style={styles.note}>{data.returned.note}</Text>}
          </View>
        )}
        {data.submitted_stale && (
          <Text style={[styles.meta, { color: WARNING_TEXT }]}>
            Dane wydarzenia zmieniły się od wysłania — przed zatwierdzeniem podsumowanie wraca do poprawy.
          </Text>
        )}
        {data.stale && (
          <Text style={[styles.meta, { color: WARNING_TEXT }]}>
            Dane wydarzenia zmieniły się po zatwierdzeniu — prowizje mają zamrożoną podstawę do ponownego otwarcia podsumowania.
          </Text>
        )}
        {state.status === 'error' && !!state.message && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {state.message}
          </Text>
        )}
      </View>

      {/* Braki i ostrzeżenia */}
      {data.issues.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: ERROR_TEXT }]}>Do uzupełnienia przed wysłaniem</Text>
          {data.issues.map((issue, index) => (
            <View key={`issue-${index}`} style={styles.bulletRow}>
              <Feather name="alert-circle" size={13} color={ERROR_TEXT} style={styles.bulletIcon} />
              <Text style={[styles.bulletText, { color: ERROR_TEXT }]}>{issue}</Text>
            </View>
          ))}
        </View>
      )}
      {data.warnings.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: WARNING_TEXT }]}>Uwagi</Text>
          {data.warnings.map((warning, index) => (
            <View key={`warning-${index}`} style={styles.bulletRow}>
              <Feather name="alert-triangle" size={13} color={WARNING_TEXT} style={styles.bulletIcon} />
              <Text style={styles.bulletText}>{warning}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Wynik */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Wynik</Text>
        {SETTLEMENT_TOTAL_ROWS.map((row) => {
          const value = settlementTotalValue(totals, row.keys);
          const hint = totalHint(row.keys, totals);
          return (
            <View key={row.label} style={[styles.totalRow, row.strong && styles.totalRowStrong]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.totalLabel, row.strong && styles.totalLabelStrong]}>{row.label}</Text>
                {!!hint && <Text style={styles.meta}>{hint}</Text>}
              </View>
              <Text
                style={[
                  styles.totalValue,
                  row.strong && styles.totalValueStrong,
                  row.strong && value < 0 && { color: ERROR_TEXT },
                ]}
              >
                {formatPln(value)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Czynności */}
      <View style={styles.section}>
        {data.can_submit && (
          <>
            <Text style={styles.inputLabel}>Notatka dla administratora (opcjonalnie)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              editable={!busy}
              multiline
              maxLength={2000}
              placeholder="Np. czego dotyczy pozycja dopisana ręcznie"
              placeholderTextColor={colors.text.tertiary}
              style={styles.input}
            />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={confirmSubmit}
              style={[styles.primaryBtn, busy && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.background.primary} />
              ) : (
                <>
                  <Feather name="send" size={15} color={colors.background.primary} />
                  <Text style={styles.primaryBtnText}>Wyślij do zatwierdzenia</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
        {!!actionError && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {actionError}
          </Text>
        )}
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityHint="Otwiera CRM w przeglądarce"
          onPress={() => openInCrmWeb(`/crm/events/${eventId}?tab=summary`)}
          style={styles.secondaryBtn}
        >
          <Feather name="external-link" size={15} color={colors.primary.gold} />
          <Text style={styles.secondaryBtnText}>{crmLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Edycja pozycji, przypisywanie faktur kosztowych i zatwierdzanie są w CRM.</Text>
      </View>

      {/* Pozycje według sekcji */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pozycje</Text>
        {sections.length === 0 && <Text style={styles.empty}>Brak pozycji.</Text>}
        {sections.map((section) => (
          <View key={section.id} style={styles.group}>
            <Text style={styles.groupTitle}>
              {section.label} ({section.lines.length})
            </Text>
            {section.lines.map((line) => (
              <LineRow key={line.key} line={line} />
            ))}
          </View>
        ))}
      </View>

      {/* Prowizje pracowników */}
      {data.internal.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prowizje pracowników</Text>
          {data.internal.map((item) => (
            <View key={item.employee_id || item.name} style={[styles.card, !item.enabled && styles.dimmed]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardAmount}>{formatPln(item.amount)}</Text>
              </View>
              <Text style={styles.meta}>{internalCommissionLabel(item)}</Text>
              {!!item.rate_reason && <Text style={styles.meta}>{item.rate_reason}</Text>}
              <Text style={styles.meta}>
                {joinMeta(
                  SALES_SHARE_SOURCE_LABELS[item.source] || null,
                  COMMISSION_PAYMENT_LABELS[item.payment_method] || null,
                  item.company_cost !== item.amount && item.company_cost > 0 ? `koszt firmy ${formatPln(item.company_cost)}` : null,
                )}
              </Text>
              {!item.enabled && <Text style={[styles.meta, { color: WARNING_TEXT }]}>Prowizja od sprzedaży wyłączona.</Text>}
              {!!item.blocked_reason && <Text style={[styles.meta, { color: WARNING_TEXT }]}>{item.blocked_reason}</Text>}
            </View>
          ))}
        </View>
      )}

      {/* Prowizje sprzedawców zewnętrznych */}
      {data.external.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prowizje sprzedawców zewnętrznych</Text>
          {data.external.map((item) => (
            <View key={item.partner_id || item.name} style={[styles.card, !item.eligible && styles.dimmed]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardAmount}>{formatPln(item.amount)}</Text>
              </View>
              {!!COMMISSION_SOURCE_LABELS[item.source] && <Text style={styles.meta}>{COMMISSION_SOURCE_LABELS[item.source]}</Text>}
              {item.eligible ? (
                <>
                  <Text style={styles.meta}>
                    {formatPercent(item.rate)} od {formatPln(item.base)}
                  </Text>
                  {!!item.rate_reason && <Text style={styles.meta}>{item.rate_reason}</Text>}
                  <Text style={styles.meta}>
                    {joinMeta(
                      COMMISSION_PAYMENT_LABELS[item.payment_method] || null,
                      item.company_cost !== item.amount && item.company_cost > 0 ? `koszt firmy ${formatPln(item.company_cost)}` : null,
                    )}
                  </Text>
                </>
              ) : (
                <Text style={styles.meta}>{item.skip_reason || 'Bez prowizji.'}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Ewidencja prowizji (wpisy w bazie: prognoza, do wypłaty, wypłacone) */}
      {data.commissions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Ewidencja prowizji</Text>
          {data.commissions.map((row) => {
            const statusTone = COMMISSION_STATUS_COLORS[row.status] || colors.text.secondary;
            return (
              <View key={row.id} style={[styles.card, row.status === 'cancelled' && styles.dimmed]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{row.beneficiary_name}</Text>
                  <Text style={[styles.cardAmount, row.entry_kind === 'deduction' && { color: ERROR_TEXT }]}>
                    {formatPln(row.amount)}
                  </Text>
                </View>
                <View style={styles.chipRow}>
                  <View style={[styles.chip, { backgroundColor: `${statusTone}26` }]}>
                    <Text style={[styles.chipText, { color: statusTone }]}>
                      {COMMISSION_STATUS_LABELS[row.status] || row.status}
                    </Text>
                  </View>
                  {row.entry_kind !== 'accrual' && (
                    <Text style={[styles.meta, row.entry_kind === 'deduction' && { color: ERROR_TEXT }]}>
                      {COMMISSION_ENTRY_KIND_LABELS[row.entry_kind]}
                    </Text>
                  )}
                  {row.manual && <Text style={styles.meta}>wpis ręczny</Text>}
                </View>
                {!!row.base_description && <Text style={styles.meta}>{row.base_description}</Text>}
                {row.status === 'cancelled' && !!row.cancel_reason && (
                  <Text style={styles.meta}>{`Powód anulowania: ${row.cancel_reason}`}</Text>
                )}
                {row.rate != null && (
                  <Text style={styles.meta}>
                    {joinMeta(`Stawka ${formatPercent(row.rate)}`, row.rate_reason)}
                  </Text>
                )}
                {(row.paid_amount > 0 || row.offset_amount > 0) && (
                  <Text style={styles.meta}>
                    {joinMeta(
                      row.paid_amount > 0 ? `Wypłacono ${formatPln(row.paid_amount)}` : null,
                      row.offset_amount > 0 ? `rozliczono potrąceniem ${formatPln(row.offset_amount)}` : null,
                    )}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Historia wersji */}
      {data.versions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Historia wersji</Text>
          {data.versions.map((version) => (
            <View key={version.id || `${version.revision}-${version.created_at}`} style={styles.versionRow}>
              <Text style={styles.versionTitle}>
                {joinMeta(SETTLEMENT_VERSION_ACTION_LABELS[version.action] || version.action, `wersja ${version.revision}`)}
              </Text>
              <Text style={styles.meta}>{joinMeta(formatSettlementDate(version.created_at, true), version.actor_name)}</Text>
              {!!version.totals && (
                <Text style={styles.meta}>
                  {joinMeta(
                    `Zysk netto ${formatPln(version.totals.profit_net)}`,
                    `prowizje pracowników ${formatPln(version.totals.internal_commissions)}`,
                  )}
                </Text>
              )}
              {!!version.note && <Text style={styles.note}>{version.note}</Text>}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function LineRow({ line }: { line: SettlementLine }) {
  // Zmiana kwoty źródła po korekcie: baza ustawia needs_confirmation (korekta przestała obowiązywać).
  const unconfirmed = line.needs_confirmation && (!line.confirmed || line.source_changed);
  return (
    <View style={[styles.card, !line.included && styles.dimmed]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{line.name}</Text>
        <Text style={styles.cardAmount}>{formatPln(line.net_amount)}</Text>
      </View>
      <Text style={styles.meta}>
        {joinMeta(
          SETTLEMENT_SOURCE_LABELS[line.source_type] || null,
          formatSettlementDate(line.date),
          line.detail,
          line.gross_amount != null ? `brutto ${formatPln(line.gross_amount)}` : null,
        )}
      </Text>
      {(!line.included || unconfirmed) && (
        <View style={styles.chipRow}>
          {!line.included && (
            <View style={[styles.chip, { backgroundColor: `${colors.text.tertiary}33` }]}>
              <Text style={[styles.chipText, { color: colors.text.secondary }]}>wyłączone</Text>
            </View>
          )}
          {unconfirmed && (
            <View style={[styles.chip, { backgroundColor: `${WARNING_TEXT}26` }]}>
              <Text style={[styles.chipText, { color: WARNING_TEXT }]}>do potwierdzenia</Text>
            </View>
          )}
        </View>
      )}
      {line.source_changed && (
        <Text style={[styles.meta, { color: WARNING_TEXT }]}>
          {`Kwota źródła zmieniła się z ${formatPln(line.previous_source_net)} na ${formatPln(line.suggested_net ?? line.net_amount)} — potwierdź ponownie`}
        </Text>
      )}
      {!!line.auto_note && <Text style={styles.meta}>{line.auto_note}</Text>}
      {!!line.note && <Text style={styles.note}>{line.note}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
    gap: 6,
  },
  sectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  loading: { padding: spacing.xl, alignItems: 'center' },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    margin: spacing.md,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(211, 187, 115, 0.08)',
  },
  noticeTitle: { color: colors.text.primary, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  noticeText: { fontSize: 13, lineHeight: 18, color: colors.text.secondary },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.sm },
  chipText: { fontSize: 11, fontWeight: typography.fontWeights.semibold },
  meta: { color: colors.text.secondary, fontSize: typography.fontSizes.xs, lineHeight: 17 },
  note: { color: colors.text.secondary, fontSize: 13, fontStyle: 'italic', lineHeight: 18 },
  returned: { gap: 2 },
  errorText: { color: ERROR_TEXT, fontSize: 13, lineHeight: 18 },
  link: { color: colors.primary.gold, paddingVertical: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletIcon: { marginTop: 2 },
  bulletText: { flex: 1, color: colors.text.secondary, fontSize: 13, lineHeight: 18 },
  totalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 3 },
  totalRowStrong: {
    borderTopWidth: 1,
    borderTopColor: colors.border.default,
    paddingTop: 8,
    marginTop: 2,
  },
  totalLabel: { color: colors.text.secondary, fontSize: 13 },
  totalLabelStrong: { color: colors.text.primary, fontWeight: '700' },
  totalValue: { color: colors.text.primary, fontSize: 13, fontWeight: '500' },
  totalValueStrong: { color: colors.primary.gold, fontWeight: '700', fontSize: 14 },
  inputLabel: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  input: {
    minHeight: 72,
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.tertiary,
    color: colors.text.primary,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.primary.gold,
  },
  primaryBtnText: { color: colors.background.primary, fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 4,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.background.elevated,
  },
  secondaryBtnText: { color: colors.primary.gold, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  hint: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, lineHeight: 16 },
  empty: { fontSize: 13, color: colors.text.tertiary },
  group: { gap: 6, marginTop: 4 },
  groupTitle: { color: colors.text.primary, fontSize: 13, fontWeight: '600', marginTop: 4 },
  card: { padding: 12, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary, gap: 3 },
  dimmed: { opacity: 0.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.text.primary, fontSize: 14, fontWeight: '500' },
  cardAmount: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
  versionRow: {
    gap: 2,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  versionTitle: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
});
