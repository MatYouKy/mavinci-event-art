'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  Bot,
  CheckCircle2,
  ExternalLink,
  Eye,
  Facebook,
  Gauge,
  Inbox,
  MousePointerClick,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Target,
  WalletCards,
} from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { hasPermission, isAdmin } from '@/lib/permissions';
import type {
  MarketingAIInsightDTO,
  MarketingCampaignDTO,
  MarketingOverviewDTO,
} from '@/lib/marketing/types';
import { useSnackbar } from '@/contexts/SnackbarContext';

type WorkspaceTab = 'overview' | 'campaigns' | 'messages' | 'ai';

const formatNumber = (value: number, digits = 0) =>
  new Intl.NumberFormat('pl-PL', { maximumFractionDigits: digits }).format(value || 0);
const formatCompactNumber = (value: number) =>
  new Intl.NumberFormat('pl-PL', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value || 0);
const formatMoney = (value: number) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value || 0);
const formatPercent = (value: number) => `${formatNumber(value, 2)}%`;
const formatDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString('pl-PL') : 'Jeszcze nie synchronizowano';

const statusLabel = (status: string) => {
  const value = status.toUpperCase();
  if (['ACTIVE', 'ENABLED'].includes(value)) return 'Aktywna';
  if (value === 'PAUSED') return 'Wstrzymana';
  if (value === 'CONNECTED') return 'Połączona';
  if (value === 'SYNCING') return 'Synchronizacja';
  if (value === 'ERROR') return 'Wymaga uwagi';
  return status || 'Brak danych';
};

type MarketingChartKey = 'meta' | 'google' | 'organic';
type MarketingChartRow = {
  date: string;
  meta: number;
  google: number;
  organic: number;
};
type MarketingChartSeries = {
  key: MarketingChartKey;
  label: string;
  colorClass: string;
  markerClass: string;
};

const MARKETING_CHART_SERIES: MarketingChartSeries[] = [
  {
    key: 'meta',
    label: 'Meta Ads',
    colorClass: 'bg-[#d94c75] hover:bg-[#ed6f94] focus-visible:bg-[#ed6f94]',
    markerClass: 'bg-[#d94c75]',
  },
  {
    key: 'google',
    label: 'Google Ads',
    colorClass: 'bg-[#6ea8fe] hover:bg-[#91bdff] focus-visible:bg-[#91bdff]',
    markerClass: 'bg-[#6ea8fe]',
  },
  {
    key: 'organic',
    label: 'Search Console',
    colorClass: 'bg-[#d3bb73] hover:bg-[#e2cd8d] focus-visible:bg-[#e2cd8d]',
    markerClass: 'bg-[#d3bb73]',
  },
];

export default function MarketingWorkspace({ initialCompanyId }: { initialCompanyId?: string }) {
  const { employee } = useCurrentEmployee();
  const { showSnackbar } = useSnackbar();
  const [overview, setOverview] = useState<MarketingOverviewDTO | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialCompanyId || '');
  const [tab, setTab] = useState<WorkspaceTab>('overview');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [updatingCampaignId, setUpdatingCampaignId] = useState<string | null>(null);
  const canManage = Boolean(
    employee && (isAdmin(employee) || hasPermission(employee, 'marketing_campaigns_manage')),
  );

  const loadOverview = useCallback(async (companyId?: string) => {
    setLoading(true);
    try {
      const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
      const response = await fetch(`/bridge/marketing/overview${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Nie udało się pobrać danych.');
      setOverview(data);
      setSelectedCompanyId(data.selectedCompanyId || '');
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd wczytywania marketingu', 'error');
    } finally {
      setLoading(false);
    }
  }, [showSnackbar]);

  useEffect(() => {
    void loadOverview(initialCompanyId);
  }, [initialCompanyId, loadOverview]);

  const selectCompany = async (companyId: string) => {
    setSelectedCompanyId(companyId);
    await Promise.all([
      fetch('/bridge/marketing/overview', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      }),
      loadOverview(companyId),
    ]);
  };

  const runSync = async () => {
    if (!selectedCompanyId) return;
    setSyncing(true);
    try {
      const response = await fetch('/bridge/marketing/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId, source: 'manual' }),
      });
      const data = await response.json();
      if (!response.ok || data.failed) {
        const firstError = data?.results?.find((item: any) => !item.ok)?.error;
        throw new Error(firstError || data?.error || 'Część źródeł nie została zsynchronizowana.');
      }
      showSnackbar('Dane marketingowe zostały zsynchronizowane', 'success');
      await loadOverview(selectedCompanyId);
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd synchronizacji', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const generateAnalysis = async () => {
    if (!selectedCompanyId) return;
    setAnalysing(true);
    try {
      const response = await fetch('/bridge/marketing/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Nie udało się przygotować analizy.');
      setOverview((current) => (current ? { ...current, latestInsight: data } : current));
      showSnackbar('Nowa analiza AI jest gotowa', 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd analizy AI', 'error');
    } finally {
      setAnalysing(false);
    }
  };

  const setCampaignStatus = async (campaign: MarketingCampaignDTO) => {
    if (!selectedCompanyId) return;
    const active = ['ACTIVE', 'ENABLED'].includes(campaign.status.toUpperCase());
    setUpdatingCampaignId(campaign.id);
    try {
      const response = await fetch('/bridge/marketing/sync', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          campaignId: campaign.id,
          status: active ? 'PAUSED' : 'ACTIVE',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Nie udało się zmienić statusu.');
      await loadOverview(selectedCompanyId);
      showSnackbar(active ? 'Kampania została wstrzymana' : 'Kampania została uruchomiona', 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd zmiany kampanii', 'error');
    } finally {
      setUpdatingCampaignId(null);
    }
  };

  const chartRows = useMemo(() => {
    const rows = new Map<
      string,
      { clicks: MarketingChartRow; impressions: MarketingChartRow }
    >();
    for (const metric of overview?.metrics || []) {
      const current = rows.get(metric.metric_date) || {
        clicks: { date: metric.metric_date, meta: 0, google: 0, organic: 0 },
        impressions: { date: metric.metric_date, meta: 0, google: 0, organic: 0 },
      };
      if (metric.source === 'meta_ads') {
        current.clicks.meta += metric.clicks;
        current.impressions.meta += metric.impressions;
      } else if (metric.source === 'google_ads') {
        current.clicks.google += metric.clicks;
        current.impressions.google += metric.impressions;
      } else if (metric.source === 'google_search_console') {
        current.clicks.organic += metric.organicClicks;
        current.impressions.organic += metric.organicImpressions;
      }
      rows.set(metric.metric_date, current);
    }
    return Array.from(rows.values())
      .sort((a, b) => a.clicks.date.localeCompare(b.clicks.date))
      .slice(-14);
  }, [overview?.metrics]);
  const clickChartRows = chartRows.map((row) => row.clicks);
  const impressionChartRows = chartRows.map((row) => row.impressions);
  const channelTotals = useMemo(() => {
    const result = {
      metaAds: { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
      googleAds: { impressions: 0, clicks: 0, spend: 0, conversions: 0 },
      searchConsole: { impressions: 0, clicks: 0 },
      facebookPage: { impressions: 0, engagement: 0, messages: 0 },
    };
    for (const metric of overview?.metrics || []) {
      if (metric.source === 'meta_ads') {
        result.metaAds.impressions += metric.impressions;
        result.metaAds.clicks += metric.clicks;
        result.metaAds.spend += metric.spend;
        result.metaAds.conversions += metric.conversions;
      } else if (metric.source === 'google_ads') {
        result.googleAds.impressions += metric.impressions;
        result.googleAds.clicks += metric.clicks;
        result.googleAds.spend += metric.spend;
        result.googleAds.conversions += metric.conversions;
      } else if (metric.source === 'google_search_console') {
        result.searchConsole.impressions += metric.organicImpressions;
        result.searchConsole.clicks += metric.organicClicks;
      } else if (metric.source === 'meta_page') {
        result.facebookPage.impressions += metric.impressions;
        result.facebookPage.engagement += metric.engagement;
        result.facebookPage.messages += metric.messages;
      }
    }
    return result;
  }, [overview?.metrics]);
  const paidTotals = {
    impressions: channelTotals.metaAds.impressions + channelTotals.googleAds.impressions,
    clicks: channelTotals.metaAds.clicks + channelTotals.googleAds.clicks,
    spend: channelTotals.metaAds.spend + channelTotals.googleAds.spend,
    conversions: channelTotals.metaAds.conversions + channelTotals.googleAds.conversions,
  };
  const selectedCompany = overview?.companies.find((company) => company.id === selectedCompanyId);
  const connectedCount = overview?.integrations.filter((item) => item.status === 'connected').length || 0;

  if (loading && !overview) {
    return <div className="rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-12 text-center text-[#e5e4e2]/55">Ładowanie centrum marketingowego…</div>;
  }
  if (!overview?.companies.length) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-10 text-center">
        <h2 className="text-lg text-[#e5e4e2]">Brak dostępnej marki</h2>
        <p className="mt-2 text-sm text-[#e5e4e2]/55">Dodaj aktywną markę lub nadaj pracownikowi dostęp do firmy.</p>
        <Link href="/crm/settings/my-companies" className="mt-5 inline-flex rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#210811]">Przejdź do firm</Link>
      </div>
    );
  }

  const stats = [
    { label: 'Wyświetlenia reklam', value: formatNumber(paidTotals.impressions), icon: Eye },
    { label: 'Kliknięcia reklam', value: formatNumber(overview.totals.clicks), icon: MousePointerClick },
    { label: 'Wydatki reklamowe', value: formatMoney(overview.totals.spend), icon: WalletCards },
    { label: 'Konwersje', value: formatNumber(overview.totals.conversions, 1), icon: Target },
    { label: 'Kliknięcia organiczne', value: formatNumber(overview.totals.organicClicks), icon: Search },
    { label: 'Nowe wiadomości', value: formatNumber(overview.unreadMessages), icon: Inbox },
  ];

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#4b172f] to-[#2c0b18] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#d3bb73]"><Gauge className="h-4 w-4" /> MARKETING I ADS</div>
            <h2 className="mt-2 text-2xl text-[#e5e4e2]">{selectedCompany?.name || 'Wybrana marka'}</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/55">Facebook, kampanie reklamowe, SEO i rekomendacje w jednym miejscu.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedCompanyId} onChange={(event) => void selectCompany(event.target.value)} className="min-w-52 rounded-lg border border-[#d3bb73]/25 bg-[#210811] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]">
              {overview.companies.map((company) => <option key={company.id} value={company.id}>{company.name}{company.is_default ? ' · domyślna' : ''}</option>)}
            </select>
            {canManage && <button onClick={() => void runSync()} disabled={syncing || connectedCount === 0} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Synchronizuję' : 'Synchronizuj'}</button>}
            {selectedCompanyId && <Link href={`/crm/settings/my-companies/${selectedCompanyId}/marketing`} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] hover:bg-[#e2cd8d]"><Settings2 className="h-4 w-4" /> Integracje</Link>}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {(['overview', 'campaigns', 'messages', 'ai'] as WorkspaceTab[]).map((item) => (
            <button key={item} onClick={() => setTab(item)} className={`rounded-t-xl border px-4 py-2 text-xs transition-colors ${tab === item ? 'border-[#d3bb73]/45 bg-[#6a2340] text-white' : 'border-transparent bg-[#210811]/50 text-[#e5e4e2]/55 hover:bg-[#5a1d37] hover:text-white'}`}>
              {item === 'overview' ? 'Przegląd' : item === 'campaigns' ? 'Kampanie' : item === 'messages' ? `Wiadomości (${overview.unreadMessages})` : 'Analiza AI'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[#e5e4e2]/65">Najważniejsze wyniki marketingowe</p>
            <span className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/35">Ostatnie 30 dni</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            {stats.map((stat) => <div key={stat.label} className="rounded-xl border border-[#d3bb73]/18 bg-[#411326] p-4"><stat.icon className="h-4 w-4 text-[#d3bb73]" /><p className="mt-3 text-xs text-[#e5e4e2]/50">{stat.label}</p><p className="brand-number mt-1 text-xl text-[#e5e4e2]">{stat.value}</p></div>)}
          </div>
          <div className="rounded-xl border border-[#6ea8fe]/15 bg-[#6ea8fe]/5 px-4 py-3 text-xs leading-5 text-[#e5e4e2]/55">
            Dane pochodzą bezpośrednio z Meta Ads, Google Ads, Facebook Page i Google Search Console. To wyniki raportowane przez te platformy — nie sesje ani użytkownicy mierzeni na stronie. Pomiar wizyt na stronie wymaga osobnej integracji z Google Analytics 4.
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border border-[#d3bb73]/15 bg-[#351020] p-5">
              <div className="flex items-center justify-between"><div><h3 className="text-base text-[#e5e4e2]">Kliknięcia według źródła</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Meta Ads, Google Ads i bezpłatne wyniki Google · ostatnie 14 dni</p></div><BarChart3 className="h-5 w-5 text-[#d3bb73]" /></div>
              <MarketingBarChart rows={clickChartRows} series={MARKETING_CHART_SERIES} unit="kliknięć" emptyMessage="Źródła są zsynchronizowane, ale nie zwróciły kliknięć w ostatnich 14 dniach." />
            </div>
            <div className="space-y-3">
              {(['meta', 'google'] as const).map((provider) => {
                const integration = overview.integrations.find((item) => item.provider === provider);
                const connected = integration?.status === 'connected';
                return <div key={provider} className="rounded-xl border border-[#d3bb73]/15 bg-[#411326] p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3">{provider === 'meta' ? <Facebook className="h-5 w-5 text-[#d3bb73]" /> : <Search className="h-5 w-5 text-[#d3bb73]" />}<div><h3 className="text-sm text-[#e5e4e2]">{provider === 'meta' ? 'Meta / Facebook' : 'Google'}</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">{provider === 'meta' ? 'Wiadomości, statystyki i reklamy' : 'Search Console i Google Ads'}</p></div></div><span className={`rounded-full px-2 py-1 text-[10px] ${connected ? 'bg-emerald-400/15 text-emerald-300' : integration?.status === 'error' ? 'bg-red-400/15 text-red-300' : 'bg-[#d3bb73]/10 text-[#d3bb73]'}`}>{connected ? 'Połączona' : integration ? statusLabel(integration.status) : 'Niepołączona'}</span></div><p className="mt-4 text-[11px] text-[#e5e4e2]/40">{formatDateTime(integration?.last_synced_at)}</p>{integration?.status === 'error' && integration.last_error && <p className="mt-2 rounded border border-red-400/20 bg-red-400/10 p-2 text-xs text-red-200">{integration.last_error}</p>}</div>;
              })}
            </div>
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl border border-[#d3bb73]/15 bg-[#351020] p-5">
              <div className="flex items-center justify-between"><div><h3 className="text-base text-[#e5e4e2]">Widoczność według źródła</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Wyświetlenia reklam i wyników w wyszukiwarce · ostatnie 14 dni</p></div><Eye className="h-5 w-5 text-[#d3bb73]" /></div>
              <MarketingBarChart rows={impressionChartRows} series={MARKETING_CHART_SERIES} unit="wyświetleń" emptyMessage="Źródła są zsynchronizowane, ale nie zwróciły wyświetleń w ostatnich 14 dniach." />
            </div>
            <div className="rounded-xl border border-[#d3bb73]/15 bg-[#351020] p-5">
              <div className="flex items-center justify-between"><div><h3 className="text-base text-[#e5e4e2]">Efektywność</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Wskaźniki wyliczone z danych z ostatnich 30 dni</p></div><Gauge className="h-5 w-5 text-[#d3bb73]" /></div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <KpiMetric label="CTR reklam" value={paidTotals.impressions ? formatPercent(paidTotals.clicks / paidTotals.impressions * 100) : '—'} hint="Kliknięcia / wyświetlenia reklam" />
                <KpiMetric label="Śr. koszt kliknięcia" value={paidTotals.clicks ? formatMoney(paidTotals.spend / paidTotals.clicks) : '—'} hint="Wydatki / kliknięcia reklam" />
                <KpiMetric label="Koszt konwersji" value={paidTotals.conversions ? formatMoney(paidTotals.spend / paidTotals.conversions) : '—'} hint="Wydatki / konwersje" />
                <KpiMetric label="CTR organiczny" value={channelTotals.searchConsole.impressions ? formatPercent(channelTotals.searchConsole.clicks / channelTotals.searchConsole.impressions * 100) : '—'} hint="Kliknięcia / wyświetlenia Search Console" />
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-[#d3bb73]/15 bg-[#351020] p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-base text-[#e5e4e2]">Wyniki według kanału</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Dokładne źródło każdej grupy danych</p></div><span className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">Ostatnie 30 dni</span></div>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ChannelSummaryCard title="Meta Ads" subtitle="Reklamy Facebook i Instagram" icon={<Facebook className="h-4 w-4" />} metrics={[['Wyświetlenia', formatNumber(channelTotals.metaAds.impressions)], ['Kliknięcia', formatNumber(channelTotals.metaAds.clicks)], ['Wydatki', formatMoney(channelTotals.metaAds.spend)], ['Konwersje', formatNumber(channelTotals.metaAds.conversions, 1)]]} />
              <ChannelSummaryCard title="Google Ads" subtitle="Płatne kampanie Google" icon={<MousePointerClick className="h-4 w-4" />} metrics={[['Wyświetlenia', formatNumber(channelTotals.googleAds.impressions)], ['Kliknięcia', formatNumber(channelTotals.googleAds.clicks)], ['Wydatki', formatMoney(channelTotals.googleAds.spend)], ['Konwersje', formatNumber(channelTotals.googleAds.conversions, 1)]]} />
              <ChannelSummaryCard title="Search Console" subtitle="Bezpłatne wyniki wyszukiwarki" icon={<Search className="h-4 w-4" />} metrics={[['Wyświetlenia', formatNumber(channelTotals.searchConsole.impressions)], ['Kliknięcia', formatNumber(channelTotals.searchConsole.clicks)], ['CTR', channelTotals.searchConsole.impressions ? formatPercent(channelTotals.searchConsole.clicks / channelTotals.searchConsole.impressions * 100) : '—'], ['Śr. pozycja', overview.totals.averagePosition ? formatNumber(overview.totals.averagePosition, 1) : '—']]} />
              <ChannelSummaryCard title="Facebook Page" subtitle="Organiczna aktywność strony" icon={<Facebook className="h-4 w-4" />} metrics={[['Wyświetlenia strony', formatNumber(channelTotals.facebookPage.impressions)], ['Zaangażowania', formatNumber(channelTotals.facebookPage.engagement)], ['Nowe rozmowy', formatNumber(channelTotals.facebookPage.messages)]]} />
            </div>
          </div>
        </>
      )}

      {tab === 'campaigns' && <CampaignList campaigns={overview.campaigns} canManage={canManage} updatingId={updatingCampaignId} onToggle={setCampaignStatus} />}
      {tab === 'messages' && <MessageList overview={overview} onRead={async (messageId) => { await fetch('/bridge/marketing/messages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId: selectedCompanyId, messageId, isRead: true }) }); await loadOverview(selectedCompanyId); }} />}
      {tab === 'ai' && <AIAnalysis insight={overview.latestInsight} enabled={overview.settings.aiAnalysisEnabled} canManage={canManage} analysing={analysing} onGenerate={generateAnalysis} settingsHref={`/crm/settings/my-companies/${selectedCompanyId}/marketing`} />}
    </section>
  );
}

function MarketingBarChart({
  rows,
  series,
  unit,
  emptyMessage,
}: {
  rows: MarketingChartRow[];
  series: MarketingChartSeries[];
  unit: string;
  emptyMessage: string;
}) {
  const rawMax = Math.max(1, ...rows.flatMap((row) => series.map((item) => row[item.key])));
  const roughStep = rawMax / 4;
  const stepMagnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / stepMagnitude;
  const step = (normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10) * stepMagnitude;
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from(
    { length: Math.round(max / step) + 1 },
    (_, index) => max - index * step,
  );
  const axisDigits = step < 1 ? Math.min(2, Math.ceil(-Math.log10(step))) : 0;
  const totals = series.map((item) => ({
    ...item,
    total: rows.reduce((sum, row) => sum + row[item.key], 0),
  }));
  const hasValues = totals.some((item) => item.total > 0);

  if (!rows.length || !hasValues) {
    return (
      <div className="mt-6 flex h-52 items-center justify-center rounded-lg border border-dashed border-[#d3bb73]/20 px-6 text-center text-sm leading-6 text-[#e5e4e2]/40">
        {rows.length ? emptyMessage : 'Połącz źródła i uruchom pierwszą synchronizację.'}
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2">
        <div className="relative h-44" aria-hidden="true">
          {ticks.map((value) => (
            <span
              key={value}
              className="absolute right-0 -translate-y-1/2 text-[9px] tabular-nums text-[#e5e4e2]/35"
              style={{ top: `${(1 - value / max) * 100}%` }}
            >
              {step < 1 ? formatNumber(value, axisDigits) : formatCompactNumber(value)}
            </span>
          ))}
        </div>
        <div className="relative h-44">
          {ticks.map((value) => (
            <span
              key={value}
              className="pointer-events-none absolute inset-x-0 border-t border-[#d3bb73]/10"
              style={{ top: `${(1 - value / max) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
            {rows.map((row) => {
              const dateLabel = new Date(`${row.date}T12:00:00`).toLocaleDateString('pl-PL', {
                day: '2-digit',
                month: '2-digit',
              });
              return (
                <div key={row.date} className="flex h-full min-w-0 flex-1 items-end gap-px">
                  {series.map((item) => (
                    <MarketingBar
                      key={item.key}
                      date={dateLabel}
                      label={item.label}
                      value={row[item.key]}
                      max={max}
                      unit={unit}
                      colorClass={item.colorClass}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <div />
        <div className="mt-2 flex gap-1.5 sm:gap-2" aria-hidden="true">
          {rows.map((row, index) => (
            <span key={row.date} className="min-w-0 flex-1 text-center text-[9px] tabular-nums text-[#e5e4e2]/35">
              {(index % 2 === 0 || index === rows.length - 1)
                ? new Date(`${row.date}T12:00:00`).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
                : ''}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 text-right text-[10px] text-[#e5e4e2]/30">Najedź na słupek, aby zobaczyć dokładną wartość.</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[#e5e4e2]/55">
        {totals.map((item) => (
          <span key={item.key}>
            <i className={`mr-1 inline-block h-2 w-2 rounded-full ${item.markerClass}`} />
            {item.label}: <strong className="font-medium text-[#e5e4e2]">{formatNumber(item.total)}</strong>
          </span>
        ))}
        <span className="text-[#e5e4e2]/40">Razem: <strong className="font-medium text-[#e5e4e2]/70">{formatNumber(totals.reduce((sum, item) => sum + item.total, 0))}</strong></span>
      </div>
    </div>
  );
}

function MarketingBar({
  date,
  label,
  value,
  max,
  unit,
  colorClass,
}: {
  date: string;
  label: string;
  value: number;
  max: number;
  unit: string;
  colorClass: string;
}) {
  const height = value > 0 ? Math.max(2, (value / max) * 100) : 0;

  return (
    <button
      type="button"
      aria-label={`${date}, ${label}: ${formatNumber(value)}`}
      className={`group relative min-w-0 flex-1 appearance-none rounded-t border-0 p-0 outline-none transition-colors ${colorClass}`}
      style={{ height: `${height}%` }}
    >
      <span className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-20 hidden min-w-max -translate-x-1/2 rounded-lg border border-[#d3bb73]/25 bg-[#210811] px-3 py-2 text-left shadow-xl group-hover:block group-focus-visible:block">
        <span className="block text-[10px] font-normal text-[#e5e4e2]/45">{date} · {label}</span>
        <span className="mt-0.5 block text-sm font-semibold tabular-nums text-[#e5e4e2]">{formatNumber(value)} {unit}</span>
      </span>
    </button>
  );
}

function KpiMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg bg-[#411326] p-4">
      <p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">{label}</p>
      <p className="brand-number mt-1 text-lg text-[#e5e4e2]">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-[#e5e4e2]/35">{hint}</p>
    </div>
  );
}

function ChannelSummaryCard({
  title,
  subtitle,
  icon,
  metrics,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  metrics: Array<[string, string]>;
}) {
  return (
    <div className="rounded-lg bg-[#411326] p-4">
      <div className="flex items-center gap-2 text-[#d3bb73]">{icon}<h4 className="text-sm text-[#e5e4e2]">{title}</h4></div>
      <p className="mt-1 text-[10px] text-[#e5e4e2]/35">{subtitle}</p>
      <dl className="mt-4 space-y-2">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[11px] text-[#e5e4e2]/45">{label}</dt>
            <dd className="text-xs font-medium tabular-nums text-[#e5e4e2]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CampaignList({ campaigns, canManage, updatingId, onToggle }: { campaigns: MarketingCampaignDTO[]; canManage: boolean; updatingId: string | null; onToggle: (campaign: MarketingCampaignDTO) => void }) {
  return <div className="overflow-hidden rounded-xl border border-[#d3bb73]/18 bg-[#351020]"><div className="border-b border-[#d3bb73]/15 px-5 py-4"><h3 className="text-base text-[#e5e4e2]">Kampanie reklamowe</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Wyniki z ostatnich 30 dni. Uruchomienie i pauza są zapisywane bezpośrednio u dostawcy.</p></div>{campaigns.length ? <div className="divide-y divide-[#d3bb73]/15">{campaigns.map((campaign) => { const active = ['ACTIVE', 'ENABLED'].includes(campaign.status.toUpperCase()); const ctr = campaign.impressions ? campaign.clicks / campaign.impressions * 100 : 0; return <div key={campaign.id} className="grid gap-3 px-5 py-4 transition-colors hover:bg-[#5a1d37] lg:grid-cols-[minmax(240px,1fr)_100px_110px_110px_110px_120px] lg:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded bg-[#d3bb73]/10 px-2 py-1 text-[10px] text-[#d3bb73]">{campaign.provider === 'meta_ads' ? 'META' : 'GOOGLE'}</span><p className="truncate text-sm text-[#e5e4e2]">{campaign.name}</p></div><p className="mt-1 text-xs text-[#e5e4e2]/40">{campaign.objective || 'Kampania reklamowa'}</p></div><Metric label="Status" value={statusLabel(campaign.status)} /><Metric label="Wydatki" value={formatMoney(campaign.spend)} /><Metric label="Kliknięcia" value={formatNumber(campaign.clicks)} /><Metric label="CTR" value={`${formatNumber(ctr, 2)}%`} /><div className="flex justify-end">{canManage && <button onClick={() => onToggle(campaign)} disabled={updatingId === campaign.id} className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/12 disabled:opacity-40">{updatingId === campaign.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{active ? 'Wstrzymaj' : 'Uruchom'}</button>}</div></div>; })}</div> : <div className="p-10 text-center text-sm text-[#e5e4e2]/40">Brak zsynchronizowanych kampanii.</div>}</div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">{label}</p><p className="mt-1 text-xs text-[#e5e4e2]">{value}</p></div>; }

function MessageList({ overview, onRead }: { overview: MarketingOverviewDTO; onRead: (id: string) => Promise<void> }) {
  return <div className="rounded-xl border border-[#d3bb73]/18 bg-[#351020] p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="text-base text-[#e5e4e2]">Nowe wiadomości Facebook</h3><p className="mt-1 text-xs text-[#e5e4e2]/45">Powiadomienia są tworzone automatycznie przez webhook Meta.</p></div><Inbox className="h-5 w-5 text-[#d3bb73]" /></div>{overview.messages.length ? <div className="space-y-2">{overview.messages.map((message) => <button key={message.id} onClick={() => void onRead(message.id)} className={`block w-full rounded-lg border p-4 text-left transition-colors hover:bg-[#5a1d37] ${message.is_read ? 'border-[#d3bb73]/10 bg-[#2c0b18]' : 'border-[#d3bb73]/35 bg-[#4b172f]'}`}><div className="flex items-center justify-between gap-4"><p className="text-sm text-[#e5e4e2]">{message.sender_name || 'Kontakt z Facebooka'}</p><span className="text-[10px] text-[#e5e4e2]/40">{formatDateTime(message.received_at)}</span></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-[#e5e4e2]/60">{message.message_preview}</p></button>)}</div> : <div className="py-10 text-center text-sm text-[#e5e4e2]/40">Brak nowych wiadomości.</div>}</div>;
}

function AIAnalysis({ insight, enabled, canManage, analysing, onGenerate, settingsHref }: { insight: MarketingAIInsightDTO | null; enabled: boolean; canManage: boolean; analysing: boolean; onGenerate: () => void; settingsHref: string }) {
  return <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]"><div className="rounded-xl border border-[#d3bb73]/18 bg-[#351020] p-5"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-[#d3bb73]"><Bot className="h-5 w-5" /><h3 className="text-base">Kierunek rekomendowany przez AI</h3></div><p className="mt-2 text-xs leading-5 text-[#e5e4e2]/45">Analiza korzysta wyłącznie z zagregowanych wyników, bez treści wiadomości i danych klientów.</p></div>{canManage && enabled && <button onClick={onGenerate} disabled={analysing} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-xs font-medium text-[#210811] disabled:opacity-50"><Sparkles className="h-4 w-4" />{analysing ? 'Analizuję…' : 'Nowa analiza'}</button>}</div>{!enabled ? <div className="mt-6 rounded-lg border border-[#d3bb73]/20 bg-[#411326] p-5 text-sm text-[#e5e4e2]/60">Analiza AI jest domyślnie wyłączona. Administrator może świadomie włączyć przekazywanie zagregowanych wyników w <Link href={settingsHref} className="text-[#d3bb73] underline">ustawieniach marki</Link>.</div> : insight ? <div className="mt-6"><p className="text-sm leading-6 text-[#e5e4e2]/80">{insight.summary}</p><div className="mt-5 space-y-3">{insight.recommendations.map((item, index) => <div key={`${item.title}-${index}`} className="rounded-lg border border-[#d3bb73]/15 bg-[#411326] p-4"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.priority === 'high' ? 'bg-red-300' : item.priority === 'medium' ? 'bg-[#d3bb73]' : 'bg-emerald-300'}`} /><p className="text-sm text-[#e5e4e2]">{item.title}</p></div><p className="mt-2 text-xs leading-5 text-[#e5e4e2]/55">{item.rationale}</p>{item.channel && <span className="mt-2 inline-block text-[10px] text-[#d3bb73]">{item.channel}</span>}</div>)}</div><p className="mt-4 text-[10px] text-[#e5e4e2]/35">Wygenerowano {formatDateTime(insight.created_at)}</p></div> : <div className="mt-6 rounded-lg border border-dashed border-[#d3bb73]/20 p-8 text-center text-sm text-[#e5e4e2]/40">Uruchom pierwszą analizę po synchronizacji źródeł.</div>}</div><div className="space-y-4">{insight && <><InsightList title="Szanse" values={insight.opportunities} icon={<CheckCircle2 className="h-4 w-4 text-emerald-300" />} /><InsightList title="Ryzyka" values={insight.risks} icon={<Target className="h-4 w-4 text-red-300" />} /></>}<Link href={settingsHref} className="flex items-center justify-between rounded-xl border border-[#d3bb73]/18 bg-[#411326] p-4 text-sm text-[#d3bb73] hover:bg-[#5a1d37]">Ustawienia analizy i źródeł <ExternalLink className="h-4 w-4" /></Link></div></div>;
}

function InsightList({ title, values, icon }: { title: string; values: string[]; icon: ReactNode }) { return <div className="rounded-xl border border-[#d3bb73]/18 bg-[#411326] p-4"><div className="flex items-center gap-2">{icon}<h3 className="text-sm text-[#e5e4e2]">{title}</h3></div><ul className="mt-3 space-y-2 text-xs leading-5 text-[#e5e4e2]/55">{values.map((value, index) => <li key={`${value}-${index}`}>• {value}</li>)}</ul></div>; }
