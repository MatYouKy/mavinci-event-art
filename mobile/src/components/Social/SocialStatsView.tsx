import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import {
  SOCIAL_CHANNEL_LABELS, SOCIAL_KPI_METRICS, SOCIAL_METRIC_LABELS, SOCIAL_RECOMMENDATION_PRIORITY_LABELS, SOCIAL_STATS_RANGES,
  SOCIAL_TIME_BANDS, SOCIAL_WEEKDAYS_SHORT, formatSocialNumber, formatSocialPercent, socialChangeLabel, socialPeriodLabel,
  socialPlural, type SocialMetricKey, type SocialMetricValues,
} from '../../lib/socialShared';
import { socialErrorMessage, socialGet, socialPost, type SocialStats, type SocialTotals } from '../../lib/socialApi';
import SocialBrandInterestCard from './SocialBrandInterestCard';

/*
 * Social media → „Statystyki” w aplikacji (jak w CRM i na Macu): wyniki postów opublikowanych w okresie (7 / 28 / 90 dni)
 * wobec poprzedniego okresu, przyrost dzienny, kanały, najlepsze posty, najlepsze pory publikacji z własnych wyników
 * i raport tygodniowy „Trendy i rekomendacje”. „Odśwież z Meta” — każdy z dostępem, „Raport za poprzedni tydzień” — twórca treści.
 * Na górze „Zainteresowanie marką” (`SocialBrandInterestCard`): wyszukiwania nazwy w Google i wejścia na profile.
 */

type Props = { companyId: string; initialReportId?: string | null; refreshKey?: number; onOpenPost: (id: string) => void };

function Change({ current, previous }: { current: number | null | undefined; previous: number | null | undefined }) {
  const label = socialChangeLabel(current, previous);
  if (!label) return null;
  const color = label === '0%' ? colors.text.tertiary : label.startsWith('−') ? colors.status.error : colors.status.success;
  return <Text style={[styles.change, { color }]}>{label}</Text>;
}

function metricsLine(metrics: SocialMetricValues) {
  const parts = (['views', 'reach', 'interactions', 'saves'] as SocialMetricKey[])
    .filter((key) => metrics[key] != null).map((key) => `${SOCIAL_METRIC_LABELS[key]}: ${formatSocialNumber(metrics[key])}`);
  return parts.length ? parts.join(' · ') : 'Brak wyników z Meta';
}

function Tiles({ totals, previous }: { totals: SocialTotals; previous: SocialTotals | null }) {
  return (
    <View style={styles.tiles}>
      <View style={styles.tile}>
        <Text style={styles.tileLabel}>Posty</Text>
        <Text style={styles.tileValue}>{totals.posts}</Text>
        {previous ? <Change current={totals.posts} previous={previous.posts} /> : null}
      </View>
      {SOCIAL_KPI_METRICS.map((key) => (
        <View key={key} style={styles.tile}>
          <Text style={styles.tileLabel} numberOfLines={1}>{SOCIAL_METRIC_LABELS[key]}</Text>
          <Text style={styles.tileValue}>{formatSocialNumber(totals[key])}</Text>
          {previous ? <Change current={totals[key]} previous={previous[key]} /> : null}
        </View>
      ))}
    </View>
  );
}

export default function SocialStatsView({ companyId, initialReportId, refreshKey = 0, onOpenPost }: Props) {
  const [days, setDays] = useState<number>(28);
  const [reportId, setReportId] = useState<string | null>(initialReportId || null);
  const [data, setData] = useState<SocialStats | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [chart, setChart] = useState<'views' | 'interactions'>('views');

  const load = useCallback(async () => {
    try {
      setData(await socialGet<SocialStats>('stats', { company: companyId, days: String(days), report: reportId }));
      setError('');
    } catch (cause) {
      setError(socialErrorMessage(cause, 'Nie udało się pobrać statystyk.'));
    }
  }, [companyId, days, reportId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const run = async (label: string, op: 'metricsRefresh' | 'reportGenerate' | 'brandRefresh', success: string) => {
    setBusy(label);
    try {
      const result = await socialPost<SocialStats>(op, { companyId, days, ...(op !== 'reportGenerate' && reportId ? { report: reportId } : {}) });
      setData(result);
      if (result.report) setReportId(result.report.id);
      Alert.alert('Statystyki', success);
    } catch (cause) {
      Alert.alert('Statystyki', socialErrorMessage(cause, 'Operacja nie powiodła się.'));
    } finally {
      setBusy(null);
    }
  };

  /** „Frazy marki” — błąd jako wyjątek (komunikat w oknie fraz). */
  const saveBrandTerms = async (terms: string[]) => {
    const result = await socialPost<SocialStats>('brandTerms', { companyId, days, terms, ...(reportId ? { report: reportId } : {}) });
    setData(result);
  };

  const values = useMemo(() => (data?.timeline || []).map((item) => item[chart]), [data?.timeline, chart]);
  const top = Math.max(1, ...values);
  const maxRate = Math.max(0, ...(data?.bestTimes.cells || []).map((cell) => cell.rate));

  if (!data) {
    return (
      <View style={{ alignItems: 'center', padding: spacing.lg, gap: spacing.md }}>
        {error ? (
          <>
            <Text style={styles.muted}>{error}</Text>
            <TouchableOpacity style={styles.secondary} onPress={() => void load()}><Text style={styles.secondaryText}>Spróbuj ponownie</Text></TouchableOpacity>
          </>
        ) : <ActivityIndicator color={colors.primary.gold} />}
      </View>
    );
  }

  const report = data.report;
  const { insights, sync } = data;

  return (
    <View style={{ gap: spacing.md }}>
      <View style={styles.chips}>
        {SOCIAL_STATS_RANGES.map((value) => (
          <TouchableOpacity key={value} style={[styles.chip, days === value && styles.chipActive]} onPress={() => setDays(value)}>
            <Text style={[styles.chipText, days === value && styles.chipTextActive]}>{value} dni</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.muted}>
        Wyniki postów opublikowanych w ostatnich {data.range.days} dniach (stan na dziś) wobec {data.range.days} dni wcześniej.
        {sync.lastSyncedAt ? ` Ostatnie pobranie z Meta: ${new Date(sync.lastSyncedAt).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.` : ''}
      </Text>
      {(data.canRefresh || data.canGenerate) && (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {data.canRefresh && (
            <TouchableOpacity style={styles.secondary} onPress={() => void run('Pobieram wyniki z Meta', 'metricsRefresh', 'Odświeżono statystyki.')}>
              <Feather name="refresh-cw" size={14} color={colors.primary.gold} /><Text style={styles.secondaryText}>Odśwież z Meta</Text>
            </TouchableOpacity>
          )}
          {data.canGenerate && (
            <TouchableOpacity style={styles.primary} onPress={() => void run('Przygotowuję raport tygodniowy', 'reportGenerate', 'Przygotowano raport za poprzedni tydzień.')}>
              <Feather name="file-text" size={14} color={colors.background.primary} /><Text style={styles.primaryText}>Raport tygodniowy</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {(!insights.connected || insights.missingScopes.length > 0 || sync.problems.length > 0) && (
        <View style={[styles.card, { borderColor: colors.status.warning, borderWidth: 1 }]}>
          {!insights.connected && <Text style={styles.warning}>Meta nie jest połączona z marką — statystyki pojawią się po połączeniu konta w ustawieniach marketingu marki (CRM).</Text>}
          {insights.connected && insights.missingScopes.length > 0 && (
            <Text style={styles.warning}>Brakuje uprawnień Meta do statystyk: {insights.missingScopes.join(', ')}. Bez nich: Facebook — tylko reakcje, komentarze i udostępnienia; Instagram — tylko polubienia i komentarze.</Text>
          )}
          {sync.problems.map((problem) => <Text key={problem} style={styles.warning}>{problem}</Text>)}
        </View>
      )}

      {data.brand ? (
        <SocialBrandInterestCard brand={data.brand} days={data.range.days} errorText={socialErrorMessage}
          onRefresh={() => void run('Pobieram liczby z Google i Meta', 'brandRefresh', 'Odświeżono zainteresowanie marką.')}
          saveTerms={saveBrandTerms} />
      ) : null}

      <Tiles totals={data.totals} previous={data.previous} />

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>Przyrost dzienny</Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {(['views', 'interactions'] as const).map((key) => (
              <TouchableOpacity key={key} style={[styles.chipSmall, chart === key && styles.chipActive]} onPress={() => setChart(key)}>
                <Text style={[styles.chipText, chart === key && styles.chipTextActive]}>{SOCIAL_METRIC_LABELS[key]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.chart}>
          {values.map((value, index) => (
            <View key={index} style={[styles.bar, { height: Math.max(2, (value / top) * 120), opacity: value > 0 ? 0.9 : 0.2 }]} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.muted}>{data.timeline[0] ? `${data.timeline[0].date.slice(8, 10)}.${data.timeline[0].date.slice(5, 7)}` : ''}</Text>
          <Text style={styles.muted}>najwięcej: {formatSocialNumber(Math.max(0, ...values))}</Text>
          <Text style={styles.muted}>{data.timeline.length ? `${data.timeline[data.timeline.length - 1].date.slice(8, 10)}.${data.timeline[data.timeline.length - 1].date.slice(5, 7)}` : ''}</Text>
        </View>
        <Text style={styles.muted}>Zaangażowanie (interakcje / zasięg): {formatSocialPercent(data.totals.rate)}</Text>
        {data.channels.map((item) => (
          <View key={item.channel} style={styles.channelRow}>
            <Text style={styles.body}>{SOCIAL_CHANNEL_LABELS[item.channel]} · {item.totals.publications} {socialPlural(item.totals.publications, 'post', 'posty', 'postów')}</Text>
            <Text style={styles.muted}>{metricsLine(item.totals)} · zaangażowanie {formatSocialPercent(item.totals.rate)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Najlepsze pory publikacji</Text>
        <Text style={styles.muted}>Z własnych wyników z 6 miesięcy (posty w feedzie, bez relacji).</Text>
        {data.bestTimes.top.length ? data.bestTimes.top.map((slot, index) => (
          <View key={`${slot.weekday}-${slot.band}`} style={styles.slot}>
            <Text style={[styles.body, { color: colors.primary.gold }]}>{index + 1}.</Text>
            <Text style={[styles.body, { flex: 1 }]}>{slot.label}</Text>
            <Text style={styles.body}>{formatSocialPercent(slot.rate)}</Text>
            <Text style={styles.muted}>{slot.posts} {socialPlural(slot.posts, 'post', 'posty', 'postów')}</Text>
          </View>
        )) : (
          <Text style={styles.muted}>Za mało danych: {data.bestTimes.sample} z {data.bestTimes.minSample} postów z wynikami (i co najmniej 2 posty w jednej porze).</Text>
        )}
        <View style={{ gap: 2 }}>
          <View style={styles.heatRow}>
            <Text style={styles.heatLabel} />
            {SOCIAL_TIME_BANDS.map((band) => <Text key={band.id} style={styles.heatHead}>{band.label}</Text>)}
          </View>
          {SOCIAL_WEEKDAYS_SHORT.map((day, weekday) => (
            <View key={day} style={styles.heatRow}>
              <Text style={styles.heatLabel}>{day}</Text>
              {SOCIAL_TIME_BANDS.map((band, bandIndex) => {
                const cell = data.bestTimes.cells.find((item) => item.weekday === weekday && item.band === bandIndex);
                const strength = cell && maxRate > 0 ? 0.15 + 0.85 * (cell.rate / maxRate) : 0;
                return (
                  <View key={band.id} style={[styles.heatCell, { backgroundColor: cell ? `rgba(211,187,115,${strength.toFixed(2)})` : colors.background.tertiary }]}>
                    {cell ? <Text style={[styles.heatText, strength > 0.6 && { color: colors.background.primary }]}>{cell.posts}</Text> : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Najlepsze posty okresu</Text>
        {!data.topPosts.length && <Text style={styles.muted}>W tym okresie nie opublikowano postów.</Text>}
        {data.topPosts.map((post) => (
          <TouchableOpacity key={post.postId} style={styles.postRow} onPress={() => onOpenPost(post.postId)}>
            {post.thumbnailUrl ? <Image source={{ uri: post.thumbnailUrl }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]}><Feather name="image" size={16} color={colors.text.tertiary} /></View>}
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.body} numberOfLines={1}>{post.title}</Text>
              <Text style={styles.muted} numberOfLines={1}>{post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(' · ')}</Text>
              <Text style={styles.muted} numberOfLines={2}>{metricsLine(post.metrics)}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Trendy i rekomendacje{report?.aiUsed ? ' · analiza AI' : ''}</Text>
        {data.reports.length > 0 && (
          <View style={styles.chips}>
            {data.reports.slice(0, 6).map((item) => (
              <TouchableOpacity key={item.id} style={[styles.chipSmall, report?.id === item.id && styles.chipActive]} onPress={() => setReportId(item.id)}>
                <Text style={[styles.chipText, report?.id === item.id && styles.chipTextActive]}>{socialPeriodLabel(item.periodStart, item.periodEnd)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {!report ? (
          <Text style={styles.muted}>
            Raport przygotowuje się automatycznie w poniedziałek rano za poprzedni tydzień (gdy marka publikowała w ostatnich 5 tygodniach).
            {data.canGenerate ? ' Możesz też przygotować go teraz przyciskiem „Raport tygodniowy”.' : ''}
          </Text>
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Text style={styles.muted}>Tydzień {socialPeriodLabel(report.periodStart, report.periodEnd)}</Text>
            <Text style={styles.body}>{report.summary}</Text>
            {report.aiNote ? <Text style={styles.muted}>{report.aiNote}</Text> : null}
            {report.totals ? <Tiles totals={report.totals} previous={report.previous} /> : null}
            {report.trends.length > 0 && (
              <View style={{ gap: 2 }}>
                <Text style={styles.sectionLabel}>TRENDY</Text>
                {report.trends.map((item) => <Text key={item} style={styles.body}>• {item}</Text>)}
              </View>
            )}
            {report.recommendations.length > 0 && (
              <View style={{ gap: spacing.xs }}>
                <Text style={styles.sectionLabel}>REKOMENDACJE</Text>
                {report.recommendations.map((item) => (
                  <View key={item.title} style={styles.recommendation}>
                    <Text style={[styles.priority, { color: item.priority === 'high' ? colors.status.error : item.priority === 'low' ? colors.text.tertiary : colors.status.warning }]}>
                      {SOCIAL_RECOMMENDATION_PRIORITY_LABELS[item.priority] || item.priority}{item.channel ? ` · ${item.channel}` : ''}
                    </Text>
                    <Text style={[styles.body, { fontWeight: typography.fontWeights.semibold }]}>{item.title}</Text>
                    {item.rationale ? <Text style={styles.muted}>{item.rationale}</Text> : null}
                  </View>
                ))}
              </View>
            )}
            {report.risks.length > 0 && (
              <View style={{ gap: 2 }}>
                <Text style={styles.sectionLabel}>RYZYKA</Text>
                {report.risks.map((item) => <Text key={item} style={[styles.body, { color: colors.status.error }]}>• {item}</Text>)}
              </View>
            )}
            {report.opportunities.length > 0 && (
              <View style={{ gap: 2 }}>
                <Text style={styles.sectionLabel}>SZANSE</Text>
                {report.opportunities.map((item) => <Text key={item} style={[styles.body, { color: colors.status.success }]}>• {item}</Text>)}
              </View>
            )}
            {report.topPosts.map((post) => (
              <TouchableOpacity key={post.postId} style={styles.postRow} onPress={() => onOpenPost(post.postId)}>
                {post.thumbnailUrl ? <Image source={{ uri: post.thumbnailUrl }} style={styles.thumb} /> : null}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.body} numberOfLines={1}>{post.title}</Text>
                  <Text style={styles.muted} numberOfLines={2}>{metricsLine(post.metrics)}</Text>
                  {post.permalink ? <Text style={styles.link} onPress={() => void Linking.openURL(post.permalink!)}>Otwórz w Meta ↗</Text> : null}
                </View>
              </TouchableOpacity>
            ))}
            {report.bestTimes.length > 0 && (
              <Text style={styles.muted}>Najlepsze pory: {report.bestTimes.map((slot) => `${slot.label} (${formatSocialPercent(slot.rate)})`).join(', ')}</Text>
            )}
            {report.comments && <Text style={styles.muted}>Komentarze w tygodniu: {report.comments.received} · bez odpowiedzi teraz: {report.comments.unanswered}</Text>}
          </View>
        )}
      </View>

      <Modal visible={busy !== null} transparent animationType="fade">
        <View style={styles.backdrop}><View style={styles.modal}><ActivityIndicator color={colors.primary.gold} size="large" /><Text style={styles.body}>{busy}…</Text></View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm, lineHeight: 20 },
  warning: { color: colors.status.warning, fontSize: typography.fontSizes.xs },
  change: { fontSize: 11 },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.background.secondary },
  chipSmall: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: borderRadius.full, backgroundColor: colors.background.tertiary },
  chipActive: { backgroundColor: 'rgba(211,187,115,0.18)' },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.xs },
  chipTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  primary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.primary.gold, paddingVertical: spacing.sm, borderRadius: borderRadius.md },
  primaryText: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.sm },
  secondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: colors.border.hover, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: borderRadius.md },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tile: { width: '32%', flexGrow: 1, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.secondary, gap: 2 },
  tileLabel: { color: colors.text.tertiary, fontSize: 11 },
  tileValue: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  cardTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium },
  sectionLabel: { color: colors.text.tertiary, fontSize: 11, fontWeight: typography.fontWeights.semibold },
  chart: { height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 1 },
  bar: { flex: 1, backgroundColor: colors.primary.gold, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  channelRow: { gap: 2, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.default },
  slot: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  heatRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  heatLabel: { width: 28, color: colors.text.tertiary, fontSize: 10 },
  heatHead: { flex: 1, textAlign: 'center', color: colors.text.tertiary, fontSize: 8 },
  heatCell: { flex: 1, height: 20, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  heatText: { color: colors.text.primary, fontSize: 9 },
  postRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.xs, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  thumb: { width: 44, height: 56, borderRadius: borderRadius.sm },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background.primary },
  recommendation: { gap: 2, padding: spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.background.tertiary },
  priority: { fontSize: 11, fontWeight: typography.fontWeights.semibold },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.background.elevated, borderRadius: borderRadius.xl, padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
});
