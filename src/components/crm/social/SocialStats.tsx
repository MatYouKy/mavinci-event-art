'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BarChart3, Clock, ExternalLink, FileText, Images, Lightbulb, RefreshCw, Sparkles, TrendingUp,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';
import {
  SOCIAL_CHANNEL_LABELS, SOCIAL_KPI_METRICS, SOCIAL_METRIC_HINTS, SOCIAL_METRIC_LABELS, SOCIAL_RECOMMENDATION_PRIORITY_LABELS,
  SOCIAL_STATS_RANGES, SOCIAL_TIME_BANDS, SOCIAL_WEEKDAYS_SHORT, formatSocialNumber, formatSocialPercent,
  socialPeriodLabel, socialPlural, type SocialMetricKey,
} from '@/lib/social/socialShared';
import { socialGet, socialPost, type SocialReport, type SocialStats as SocialStatsData, type SocialTotals } from './socialApi';
import { ChangeBadge, cardClass, dateTimeLabel, errorMessage, primaryButton, secondaryButton, shortDate } from './socialUi';
import SocialBrandInterestCard from './SocialBrandInterest';

/*
 * Social media → „Statystyki” (Etap 3): wyniki postów opublikowanych w okresie (7 / 28 / 90 dni) wobec poprzedniego okresu,
 * przyrosty dzienne, kanały, najlepsze posty, najlepsze pory publikacji z własnych wyników, „Zainteresowanie marką”
 * (wyszukiwania nazwy w Google, wejścia na profile Facebook i Instagram) i raport tygodniowy „Trendy i rekomendacje”.
 * Te same dane co na Macu i w telefonie (`op=stats`).
 */

function MetricsLine({ metrics }: { metrics: Partial<Record<SocialMetricKey, number>> }) {
  const parts = (['views', 'reach', 'interactions', 'saves'] as SocialMetricKey[])
    .filter((key) => metrics[key] != null).map((key) => `${SOCIAL_METRIC_LABELS[key]}: ${formatSocialNumber(metrics[key])}`);
  return <span className="block text-xs text-[#e5e4e2]/55">{parts.length ? parts.join(' · ') : 'Brak wyników z Meta'}</span>;
}

export default function SocialStats({ companyId, initialReportId, onOpenPost }: {
  companyId: string; initialReportId?: string | null; onOpenPost: (id: string) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [days, setDays] = useState<number>(28);
  const [reportId, setReportId] = useState<string | null>(initialReportId || null);
  const [data, setData] = useState<SocialStatsData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [chartMetric, setChartMetric] = useState<'views' | 'interactions'>('views');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await socialGet<SocialStatsData>('stats', { company: companyId, days, report: reportId }));
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się pobrać statystyk.'));
    } finally {
      setLoading(false);
    }
  }, [companyId, days, reportId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (title: string, action: () => Promise<SocialStatsData>, success: string) => {
    showLoader(title, 'Pobieram wyniki z Meta — to może potrwać do minuty.');
    try {
      const result = await action();
      setData(result);
      if (result.report) setReportId(result.report.id);
      showSnackbar(success, 'success');
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Operacja nie powiodła się.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const chartData = useMemo(() => (data?.timeline || []).map((item) => ({
    day: `${item.date.slice(8, 10)}.${item.date.slice(5, 7)}`, value: item[chartMetric],
  })), [data?.timeline, chartMetric]);
  const maxRate = useMemo(() => Math.max(0, ...(data?.bestTimes.cells || []).map((cell) => cell.rate)), [data?.bestTimes.cells]);

  if (!data) {
    return (
      <section className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/60`}>
        {error ? (
          <>
            <p>{error}</p>
            <button type="button" className={`${secondaryButton} mt-4`} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Spróbuj ponownie</button>
          </>
        ) : <span className="inline-flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" />Wczytuję statystyki…</span>}
      </section>
    );
  }

  const { totals, previous, insights, sync } = data;
  const report = data.report;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {SOCIAL_STATS_RANGES.map((value) => (
            <button key={value} type="button" onClick={() => setDays(value)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${days === value ? 'border-[#d3bb73]/50 bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/10 bg-[#1c1f33] text-[#e5e4e2]/70'}`}>
              {value} dni
            </button>
          ))}
          {loading && <RefreshCw className="h-4 w-4 animate-spin text-[#d3bb73]" />}
        </div>
        <p className="text-xs text-[#e5e4e2]/45 lg:flex-1">
          Wyniki postów opublikowanych w ostatnich {days} dniach (stan na dziś) wobec {days} dni wcześniej.
          {sync.lastSyncedAt ? ` Ostatnie pobranie z Meta: ${dateTimeLabel(sync.lastSyncedAt)}.` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {data.canRefresh && (
            <button type="button" className={secondaryButton} onClick={() => void run('Odświeżam statystyki',
              () => socialPost<SocialStatsData>('metricsRefresh', { companyId, days, report: reportId }), 'Odświeżono statystyki')}>
              <RefreshCw className="h-4 w-4" />Odśwież z Meta
            </button>
          )}
          {data.canGenerate && (
            <button type="button" className={primaryButton} onClick={() => void run('Przygotowuję raport tygodniowy',
              () => socialPost<SocialStatsData>('reportGenerate', { companyId, days }), 'Przygotowano raport za poprzedni tydzień')}>
              <FileText className="h-4 w-4" />Raport za poprzedni tydzień
            </button>
          )}
        </div>
      </div>

      {(!insights.connected || insights.missingScopes.length > 0 || sync.problems.length > 0) && (
        <div className={`${cardClass} flex gap-2 border-amber-400/30 p-3 text-xs text-amber-100`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div className="space-y-1">
            {!insights.connected && <p>Meta nie jest połączona z marką — statystyki pojawią się po połączeniu konta w ustawieniach marketingu marki.</p>}
            {insights.connected && insights.missingScopes.length > 0 && (
              <p>Brakuje uprawnień Meta do statystyk: {insights.missingScopes.join(', ')}. Bez nich: Facebook — tylko reakcje, komentarze i udostępnienia; Instagram — tylko polubienia i komentarze. Dodaj je w konfiguracji logowania aplikacji Meta i kliknij „Odśwież dostęp” przy Meta.</p>
            )}
            {sync.problems.map((problem) => <p key={problem}>{problem}</p>)}
          </div>
        </div>
      )}

      {data.brand && (
        <SocialBrandInterestCard brand={data.brand} companyId={companyId} days={days} reportId={reportId} onStats={setData} />
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className={`${cardClass} p-4`}>
          <div className="text-xs text-[#e5e4e2]/50">Opublikowane posty</div>
          <div className="mt-1 text-2xl font-light">{totals.posts}</div>
          <ChangeBadge current={totals.posts} previous={previous.posts} />
        </div>
        {SOCIAL_KPI_METRICS.map((key) => (
          <div key={key} className={`${cardClass} p-4`} title={SOCIAL_METRIC_HINTS[key]}>
            <div className="text-xs text-[#e5e4e2]/50">{SOCIAL_METRIC_LABELS[key]}</div>
            <div className="mt-1 text-2xl font-light">{formatSocialNumber(totals[key])}</div>
            <ChangeBadge current={totals[key]} previous={previous[key]} />
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className={`${cardClass} p-4`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium"><BarChart3 className="h-4 w-4 text-[#d3bb73]" />Przyrost dzienny</h3>
            <span className="flex-1" />
            {(['views', 'interactions'] as const).map((key) => (
              <button key={key} type="button" onClick={() => setChartMetric(key)}
                className={`rounded-md border px-2 py-1 text-xs ${chartMetric === key ? 'border-[#d3bb73]/50 bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/10 text-[#e5e4e2]/60'}`}>
                {SOCIAL_METRIC_LABELS[key]}
              </button>
            ))}
            <span className="text-xs text-[#e5e4e2]/45">Zaangażowanie: {formatSocialPercent(totals.rate)} <ChangeBadge current={totals.rate} previous={previous.rate} /></span>
          </div>
          <CrmCartesianChart data={chartData} categoryKey="day" kind="bar" height={240} showLegend={false}
            series={[{ key: 'value', label: SOCIAL_METRIC_LABELS[chartMetric], color: '#d3bb73' }]}
            valueFormatter={(value) => formatSocialNumber(value)} ariaLabel={`${SOCIAL_METRIC_LABELS[chartMetric]} — przyrost dzienny`}
            emptyMessage="Brak wyników w tym okresie." />
          {data.channels.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-xs text-[#e5e4e2]/45">
                  <tr>
                    <th className="py-1.5 font-normal">Kanał</th>
                    <th className="py-1.5 text-right font-normal">Posty</th>
                    {(['views', 'reach', 'interactions', 'saves'] as SocialMetricKey[]).map((key) => <th key={key} className="py-1.5 text-right font-normal">{SOCIAL_METRIC_LABELS[key]}</th>)}
                    <th className="py-1.5 text-right font-normal">Zaangażowanie</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#d3bb73]/5">
                  {data.channels.map((item) => (
                    <tr key={item.channel}>
                      <td className="py-1.5">{SOCIAL_CHANNEL_LABELS[item.channel]}</td>
                      <td className="py-1.5 text-right tabular-nums">{item.totals.publications}</td>
                      {(['views', 'reach', 'interactions', 'saves'] as SocialMetricKey[]).map((key) => <td key={key} className="py-1.5 text-right tabular-nums">{formatSocialNumber(item.totals[key])}</td>)}
                      <td className="py-1.5 text-right tabular-nums">{formatSocialPercent(item.totals.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={`${cardClass} space-y-3 p-4`}>
          <h3 className="flex items-center gap-2 text-sm font-medium"><Clock className="h-4 w-4 text-[#d3bb73]" />Najlepsze pory publikacji</h3>
          <p className="text-xs text-[#e5e4e2]/45">Z własnych wyników z 6 miesięcy (posty w feedzie, bez relacji): średni wskaźnik zaangażowania posta opublikowanego w danej porze.</p>
          {data.bestTimes.top.length ? (
            <ol className="space-y-1.5">
              {data.bestTimes.top.map((slot, index) => (
                <li key={`${slot.weekday}-${slot.band}`} className="flex items-center gap-2 rounded-lg bg-[#0f1119]/60 px-3 py-2 text-sm">
                  <span className="text-[#d3bb73]">{index + 1}.</span>
                  <span className="flex-1 capitalize">{slot.label}</span>
                  <span className="tabular-nums">{formatSocialPercent(slot.rate)}</span>
                  <span className="text-xs text-[#e5e4e2]/45">{slot.posts} {socialPlural(slot.posts, 'post', 'posty', 'postów')}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-lg bg-[#0f1119]/60 p-3 text-xs text-[#e5e4e2]/55">
              Za mało danych: {data.bestTimes.sample} z {data.bestTimes.minSample} postów z wynikami (i co najmniej 2 posty w jednej porze).
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[340px] border-separate border-spacing-0.5 text-[10px]">
              <thead>
                <tr>
                  <th />
                  {SOCIAL_TIME_BANDS.map((band) => <th key={band.id} className="font-normal text-[#e5e4e2]/40">{band.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {SOCIAL_WEEKDAYS_SHORT.map((day, weekday) => (
                  <tr key={day}>
                    <th className="pr-1 text-right font-normal text-[#e5e4e2]/45">{day}</th>
                    {SOCIAL_TIME_BANDS.map((band, bandIndex) => {
                      const cell = data.bestTimes.cells.find((item) => item.weekday === weekday && item.band === bandIndex);
                      const strength = cell && maxRate > 0 ? 0.15 + 0.85 * (cell.rate / maxRate) : 0;
                      return (
                        <td key={band.id} className="h-6 rounded text-center tabular-nums"
                          style={{ background: cell ? `rgba(211,187,115,${strength.toFixed(2)})` : 'rgba(229,228,226,0.04)', color: strength > 0.6 ? '#1c1f33' : undefined }}
                          title={cell ? `${cell.label}: ${formatSocialPercent(cell.rate)}, ${cell.posts} ${socialPlural(cell.posts, 'post', 'posty', 'postów')}, śr. zasięg ${formatSocialNumber(cell.avgReach)}` : 'Brak postów'}>
                          {cell ? cell.posts : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className={`${cardClass} p-4`}>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><TrendingUp className="h-4 w-4 text-[#d3bb73]" />Najlepsze posty okresu</h3>
        {data.topPosts.length === 0 && <p className="text-sm text-[#e5e4e2]/45">W tym okresie nie opublikowano postów.</p>}
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
          {data.topPosts.map((post) => (
            <button key={post.postId} type="button" onClick={() => onOpenPost(post.postId)}
              className="flex gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/60 p-2 text-left hover:border-[#d3bb73]/35">
              {post.thumbnailUrl ? <img src={post.thumbnailUrl} alt="" className="h-20 w-16 shrink-0 rounded object-cover" />
                : <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded bg-[#1c1f33] text-[#d3bb73]/40"><Images className="h-5 w-5" /></span>}
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block truncate text-sm">{post.title}</span>
                <span className="block text-[11px] text-[#e5e4e2]/45">{post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(' · ')}{post.publishedAt ? ` · ${shortDate(post.publishedAt)}` : ''}</span>
                <MetricsLine metrics={post.metrics} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <ReportCard data={data} report={report} onSelect={(id) => setReportId(id)} onOpenPost={onOpenPost} />
    </section>
  );
}

function TotalsRow({ totals, previous }: { totals: SocialTotals; previous: SocialTotals | null }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <div className="rounded-lg bg-[#0f1119]/60 p-2">
        <div className="text-[11px] text-[#e5e4e2]/45">Posty</div>
        <div className="text-lg font-light">{totals.posts}</div>
        {previous && <ChangeBadge current={totals.posts} previous={previous.posts} />}
      </div>
      {SOCIAL_KPI_METRICS.map((key) => (
        <div key={key} className="rounded-lg bg-[#0f1119]/60 p-2">
          <div className="text-[11px] text-[#e5e4e2]/45">{SOCIAL_METRIC_LABELS[key]}</div>
          <div className="text-lg font-light">{formatSocialNumber(totals[key])}</div>
          {previous && <ChangeBadge current={totals[key]} previous={previous[key]} />}
        </div>
      ))}
    </div>
  );
}

const PRIORITY_CLASSES: Record<string, string> = {
  high: 'border-red-400/30 bg-red-500/10 text-red-200',
  medium: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  low: 'border-[#e5e4e2]/20 bg-[#e5e4e2]/5 text-[#e5e4e2]/60',
};

function ReportCard({ data, report, onSelect, onOpenPost }: {
  data: SocialStatsData; report: SocialReport | null; onSelect: (id: string) => void; onOpenPost: (id: string) => void;
}) {
  return (
    <div className={`${cardClass} space-y-4 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Lightbulb className="h-4 w-4 text-[#d3bb73]" />Trendy i rekomendacje — raport tygodniowy</h3>
        {report?.aiUsed && <span className="inline-flex items-center gap-1 rounded-full border border-[#d3bb73]/30 px-2 py-0.5 text-[11px] text-[#d3bb73]"><Sparkles className="h-3 w-3" />Analiza AI</span>}
        <span className="flex-1" />
        {data.reports.length > 0 && (
          <select value={report?.id || ''} onChange={(event) => onSelect(event.target.value)} aria-label="Tydzień raportu"
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm">
            {data.reports.map((item) => <option key={item.id} value={item.id}>{socialPeriodLabel(item.periodStart, item.periodEnd)}</option>)}
          </select>
        )}
      </div>
      {!report && (
        <p className="text-sm text-[#e5e4e2]/50">
          Raport przygotowuje się automatycznie w poniedziałek rano za poprzedni tydzień (gdy marka publikowała w ostatnich 5 tygodniach).
          {data.canGenerate ? ' Możesz też przygotować go teraz przyciskiem „Raport za poprzedni tydzień”.' : ''}
          {data.settings.aiReportsEnabled ? '' : ' Analizę AI włącza akceptujący w „Szablony i AI”.'}
        </p>
      )}
      {report && (
        <>
          <div>
            <div className="text-xs text-[#e5e4e2]/45">
              Tydzień {socialPeriodLabel(report.periodStart, report.periodEnd)} · przygotowano {dateTimeLabel(report.updatedAt || report.createdAt)}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#e5e4e2]/85">{report.summary}</p>
            {report.aiNote && <p className="mt-2 text-xs text-[#e5e4e2]/45">{report.aiNote}</p>}
          </div>
          {report.totals && <TotalsRow totals={report.totals} previous={report.previous} />}
          <div className="grid gap-4 lg:grid-cols-2">
            {report.trends.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Trendy</h4>
                <ul className="list-disc space-y-1 pl-4 text-sm text-[#e5e4e2]/80">{report.trends.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {report.recommendations.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Rekomendacje</h4>
                <ul className="space-y-2">
                  {report.recommendations.map((item) => (
                    <li key={item.title} className="rounded-lg bg-[#0f1119]/60 p-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${PRIORITY_CLASSES[item.priority] || PRIORITY_CLASSES.low}`}>{SOCIAL_RECOMMENDATION_PRIORITY_LABELS[item.priority] || item.priority}</span>
                        <span className="font-medium">{item.title}</span>
                        {item.channel && <span className="text-xs text-[#e5e4e2]/40">{item.channel}</span>}
                      </div>
                      {item.rationale && <p className="mt-1 text-xs text-[#e5e4e2]/60">{item.rationale}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.risks.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Ryzyka</h4>
                <ul className="list-disc space-y-1 pl-4 text-sm text-red-100/80">{report.risks.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {report.opportunities.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Szanse</h4>
                <ul className="list-disc space-y-1 pl-4 text-sm text-emerald-100/80">{report.opportunities.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
          </div>
          {report.topPosts.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Najlepsze posty tygodnia</h4>
              <div className="grid gap-2 md:grid-cols-3">
                {report.topPosts.map((post) => (
                  <div key={post.postId} className="flex gap-2 rounded-lg bg-[#0f1119]/60 p-2">
                    {post.thumbnailUrl ? <img src={post.thumbnailUrl} alt="" className="h-16 w-12 shrink-0 rounded object-cover" /> : null}
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => onOpenPost(post.postId)} className="block max-w-full truncate text-left text-sm hover:text-[#d3bb73]">{post.title}</button>
                      <span className="block text-[11px] text-[#e5e4e2]/45">{post.channels.map((channel) => SOCIAL_CHANNEL_LABELS[channel]).join(' · ')}</span>
                      <MetricsLine metrics={post.metrics} />
                      {post.permalink && <a href={post.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#d3bb73] hover:underline">Otwórz w Meta<ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#e5e4e2]/50">
            {report.bestTimes.length > 0 && <span>Najlepsze pory: {report.bestTimes.map((slot) => `${slot.label} (${formatSocialPercent(slot.rate)})`).join(', ')}</span>}
            {report.comments && <span>Komentarze w tygodniu: {report.comments.received} · bez odpowiedzi teraz: {report.comments.unanswered}</span>}
            {report.scheduledNext != null && <span>Zaplanowane na kolejne 7 dni (w chwili raportu): {report.scheduledNext}</span>}
          </div>
        </>
      )}
    </div>
  );
}
