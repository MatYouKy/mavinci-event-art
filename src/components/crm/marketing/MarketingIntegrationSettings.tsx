'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Copy,
  ExternalLink,
  Facebook,
  HelpCircle,
  Link2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Unplug,
  X,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { MarketingIntegrationDTO, MarketingOverviewDTO, MarketingProvider } from '@/lib/marketing/types';

type ProviderForm = Record<string, string>;
type MarketingConfigStatus = {
  security: { tokenEncryptionConfigured: boolean; missing: string[] };
  meta: { oauthConfigured: boolean; webhookConfigured: boolean; missing: string[] };
  google: { oauthConfigured: boolean; adsConfigured: boolean; missing: string[] };
};

const MARKETING_PUBLIC_BASE_URL = (
  process.env.NEXT_PUBLIC_MARKETING_BASE_URL || 'https://mavinci.pl'
).replace(/\/$/, '');

const providerDefinition = {
  meta: {
    title: 'Meta / Facebook',
    description: 'Wiadomości strony, statystyki oraz kampanie Meta Ads.',
    icon: Facebook,
  },
  google: {
    title: 'Google',
    description: 'Ruch organiczny z Search Console i kampanie Google Ads.',
    icon: Search,
  },
} as const;

export default function MarketingIntegrationSettings({ companyId }: { companyId: string }) {
  const { showSnackbar } = useSnackbar();
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<MarketingOverviewDTO | null>(null);
  const [configStatus, setConfigStatus] = useState<MarketingConfigStatus | null>(null);
  const [forms, setForms] = useState<Record<MarketingProvider, ProviderForm>>({ meta: {}, google: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<MarketingProvider | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [helpProvider, setHelpProvider] = useState<MarketingProvider | 'overview' | null>(null);
  const handledOAuthStatus = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, configResponse] = await Promise.all([
        fetch(`/bridge/marketing/overview?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' }),
        fetch('/bridge/marketing/config-status', { cache: 'no-store' }),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Nie udało się pobrać ustawień.');
      if (configResponse.ok) setConfigStatus(await configResponse.json());
      setOverview(data);
      const meta = data.integrations.find((item: MarketingIntegrationDTO) => item.provider === 'meta');
      const google = data.integrations.find((item: MarketingIntegrationDTO) => item.provider === 'google');
      setForms({
        meta: {
          page_id: String(meta?.settings?.page_id || ''),
          page_name: String(meta?.settings?.page_name || ''),
          ad_account_id: String(meta?.settings?.ad_account_id || ''),
          ad_account_name: String(meta?.settings?.ad_account_name || ''),
          currency: String(meta?.settings?.currency || 'PLN'),
        },
        google: {
          search_console_site_url: String(google?.settings?.search_console_site_url || ''),
          google_ads_customer_id: String(google?.settings?.google_ads_customer_id || ''),
          google_ads_login_customer_id: String(google?.settings?.google_ads_login_customer_id || ''),
          currency: String(google?.settings?.currency || 'PLN'),
        },
      });
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd ustawień marketingu', 'error');
    } finally {
      setLoading(false);
    }
  }, [companyId, showSnackbar]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const oauthStatus = searchParams.get('oauth');
    if (!oauthStatus || handledOAuthStatus.current === oauthStatus) return;
    handledOAuthStatus.current = oauthStatus;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('oauth');
    window.history.replaceState(window.history.state, '', cleanUrl.toString());
    if (oauthStatus.endsWith('_connected')) {
      showSnackbar('Konto zostało połączone z marką', 'success');
    } else if (oauthStatus === 'security_not_configured') {
      setHelpProvider('overview');
      showSnackbar('Najpierw skonfiguruj szyfrowanie tokenów marketingowych.', 'error');
    } else if (oauthStatus.includes('not_configured')) {
      const provider = oauthStatus.startsWith('meta_') ? 'meta' : 'google';
      setHelpProvider(provider);
      showSnackbar('Brakuje globalnych danych aplikacji OAuth. Otworzyłem instrukcję konfiguracji.', 'error');
    } else if (oauthStatus.startsWith('error_')) {
      showSnackbar(oauthStatus.slice(6) || 'Autoryzacja nie powiodła się', 'error');
    }
  }, [searchParams, showSnackbar]);
  const company = overview?.companies.find((item) => item.id === companyId);
  const integrations = useMemo(
    () => Object.fromEntries((overview?.integrations || []).map((item) => [item.provider, item])) as Partial<Record<MarketingProvider, MarketingIntegrationDTO>>,
    [overview?.integrations],
  );

  const updateForm = (provider: MarketingProvider, key: string, value: string) => {
    setForms((current) => ({ ...current, [provider]: { ...current[provider], [key]: value } }));
  };

  const saveProvider = async (provider: MarketingProvider) => {
    setSaving(provider);
    try {
      const response = await fetch(`/bridge/marketing/integrations/${provider}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, settings: forms[provider] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Nie udało się zapisać ustawień.');
      showSnackbar('Ustawienia integracji zostały zapisane', 'success');
      await load();
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd zapisu integracji', 'error');
    } finally {
      setSaving(null);
    }
  };

  const disconnect = async (provider: MarketingProvider) => {
    if (!window.confirm(`Odłączyć integrację ${providerDefinition[provider].title}? Zachowane statystyki pozostaną w CRM.`)) return;
    const response = await fetch(`/bridge/marketing/integrations/${provider}?companyId=${encodeURIComponent(companyId)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) return showSnackbar(data?.error || 'Nie udało się odłączyć konta', 'error');
    showSnackbar('Integracja została odłączona', 'success');
    await load();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/bridge/marketing/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId }) });
      const data = await response.json();
      if (!response.ok || data.failed) throw new Error(data?.results?.find((item: any) => !item.ok)?.error || data?.error || 'Synchronizacja niepełna.');
      showSnackbar('Synchronizacja zakończona', 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd synchronizacji', 'error');
    } finally { await load(); setSyncing(false); }
  };

  const toggleAutomaticSync = async (enabled: boolean) => {
    const response = await fetch('/bridge/marketing/overview', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, automaticSyncEnabled: enabled }) });
    const data = await response.json();
    if (!response.ok) return showSnackbar(data?.error || 'Nie udało się zmienić synchronizacji', 'error');
    setOverview((current) => current ? { ...current, settings: { ...current.settings, automaticSyncEnabled: enabled } } : current);
    showSnackbar(enabled ? 'Automatyczna synchronizacja włączona' : 'Automatyczna synchronizacja wyłączona', 'success');
  };

  const toggleAI = async (enabled: boolean) => {
    const response = await fetch('/bridge/marketing/ai-analysis', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, enabled }) });
    const data = await response.json();
    if (!response.ok) return showSnackbar(data?.error || 'Nie udało się zmienić ustawień AI', 'error');
    setOverview((current) => current ? { ...current, settings: { ...current.settings, aiAnalysisEnabled: enabled, aiConsentAt: enabled ? new Date().toISOString() : null } } : current);
    showSnackbar(enabled ? 'Analiza AI została włączona' : 'Analiza AI została wyłączona', 'success');
  };

  if (loading && !overview) return <div className="p-12 text-center text-[#e5e4e2]/50">Ładowanie ustawień integracji…</div>;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4"><Link href="/crm/settings/my-companies" className="mt-1 rounded-lg border border-[#d3bb73]/20 p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10"><ArrowLeft className="h-4 w-4" /></Link><div><p className="text-xs text-[#d3bb73]">MARKETING I ADS</p><h1 className="mt-1 text-2xl text-[#e5e4e2]">{company?.name || 'Ustawienia marki'}</h1><p className="mt-1 text-sm text-[#e5e4e2]/50">Połącz źródła, wskaż właściwe konta i zdecyduj o automatyzacji.</p></div></div>
        <div className="flex flex-wrap gap-2"><button data-crm-action="secondary" type="button" onClick={() => setHelpProvider('overview')} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"><BookOpen className="h-4 w-4" />Instrukcja integracji</button><Link href={`/crm/page?tab=marketing&company=${companyId}`} className="rounded-lg border border-[#d3bb73]/25 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10">Otwórz dashboard</Link><button onClick={() => void sync()} disabled={syncing || !overview?.integrations.some((item) => item.status !== 'not_connected')} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />Synchronizuj</button></div>
      </div>

      {configStatus && (
        !configStatus.security.tokenEncryptionConfigured ||
        !configStatus.meta.oauthConfigured ||
        !configStatus.meta.webhookConfigured ||
        !configStatus.google.oauthConfigured ||
        !configStatus.google.adsConfigured
      ) && (
        <div className="rounded-xl border border-[#e2cd8d]/45 bg-[#d3bb73]/10 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#e2cd8d]" /><div><h2 className="text-sm font-medium text-[#e5e4e2]">Dokończ globalną konfigurację integracji</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-[#e5e4e2]/60">Zapisane poniżej ID strony i konta reklamowego wskazują, co ma być synchronizowane. Do bezpiecznego zapisu tokenów, przycisku „Połącz”, odbierania wiadomości i synchronizacji reklam potrzebne są jeszcze serwerowe zmienne środowiskowe — nie ustawienia tej marki. Klucz <code className="text-[#d3bb73]">MARKETING_TOKEN_ENCRYPTION_KEY</code> musi pozostać niezmienny, ponieważ szyfruje zapisane poświadczenia. Po zmianie konfiguracji uruchom aplikację ponownie.</p></div></div><button type="button" onClick={() => setHelpProvider(!configStatus.security.tokenEncryptionConfigured ? 'overview' : !configStatus.meta.oauthConfigured || !configStatus.meta.webhookConfigured ? 'meta' : 'google')} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-xs font-medium text-[#210811] hover:bg-[#e2cd8d]"><BookOpen className="h-4 w-4" />Pokaż dokładną instrukcję</button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{!configStatus.security.tokenEncryptionConfigured && <MissingConfig label="Szyfrowanie tokenów" values={configStatus.security.missing} onHelp={() => setHelpProvider('overview')} />}{(!configStatus.meta.oauthConfigured || !configStatus.meta.webhookConfigured) && <MissingConfig label="Meta" values={configStatus.meta.missing} onHelp={() => setHelpProvider('meta')} />}{(!configStatus.google.oauthConfigured || !configStatus.google.adsConfigured) && <MissingConfig label="Google" values={configStatus.google.missing} onHelp={() => setHelpProvider('google')} />}</div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {(['meta', 'google'] as MarketingProvider[]).map((provider) => {
          const definition = providerDefinition[provider];
          const integration = integrations[provider];
          const connected = integration?.status === 'connected';
          const availablePages = (integration?.settings?.available_pages || []) as any[];
          const availableAdAccounts = (integration?.settings?.available_ad_accounts || []) as any[];
          const availableSites = (integration?.settings?.available_search_console_sites || []) as any[];
          const availableCustomers = (integration?.settings?.accessible_google_ads_customer_ids || []) as string[];
          return <div key={provider} className="rounded-xl border border-[#d3bb73]/22 bg-[#411326] p-5"><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><div className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#d3bb73]"><definition.icon className="h-5 w-5" /></div><div><h2 className="text-base text-[#e5e4e2]">{definition.title}</h2><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">{definition.description}</p></div></div><div className="flex items-center gap-2"><button type="button" onClick={() => setHelpProvider(provider)} className="rounded-full border border-[#d3bb73]/25 p-1.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/12" title={`Instrukcja integracji ${definition.title}`} aria-label={`Otwórz instrukcję integracji ${definition.title}`}><HelpCircle className="h-4 w-4" /></button><span className={`rounded-full px-2 py-1 text-[10px] ${connected ? 'bg-emerald-400/15 text-emerald-300' : 'bg-[#d3bb73]/10 text-[#d3bb73]'}`}>{connected ? 'Połączona' : 'Niepołączona'}</span></div></div>
            <div className="mt-5 flex gap-2">{!connected ? <a href={`/bridge/marketing/oauth/${provider}/start?companyId=${companyId}`} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-xs font-medium text-[#210811]"><Link2 className="h-4 w-4" />Połącz {definition.title}</a> : <><a href={`/bridge/marketing/oauth/${provider}/start?companyId=${companyId}`} className="rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">Odśwież dostęp</a><button onClick={() => void disconnect(provider)} className="inline-flex items-center gap-2 rounded-lg border border-red-300/20 px-3 py-2 text-xs text-red-200 hover:bg-red-400/10"><Unplug className="h-3.5 w-3.5" />Odłącz</button></>}</div>
            <div className="mt-5 space-y-4 border-t border-[#d3bb73]/15 pt-5">{provider === 'meta' ? <>
              <Field label="Strona na Facebooku" hint="Po autoryzacji wybierzesz stronę z listy. Ręczne ID jest potrzebne tylko wtedy, gdy Meta nie zwróci listy stron.">{availablePages.length ? <select value={forms.meta.page_id || ''} onChange={(event) => { const page = availablePages.find((item) => item.id === event.target.value); updateForm('meta', 'page_id', event.target.value); updateForm('meta', 'page_name', page?.name || ''); }} className="field-marketing"><option value="">Wybierz stronę</option>{availablePages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}</select> : <input value={forms.meta.page_id || ''} onChange={(event) => updateForm('meta', 'page_id', event.target.value)} className="field-marketing" placeholder="ID strony Facebook" />}</Field>
              <Field label="Konto reklamowe Meta" hint="Identyfikator znajdziesz w Menedżerze reklam lub ustawieniach firmowych Meta; CRM akceptuje zapis z prefiksem act_.">{availableAdAccounts.length ? <select value={forms.meta.ad_account_id || ''} onChange={(event) => { const account = availableAdAccounts.find((item) => item.id === event.target.value); updateForm('meta', 'ad_account_id', event.target.value); updateForm('meta', 'ad_account_name', account?.name || ''); updateForm('meta', 'currency', account?.currency || 'PLN'); }} className="field-marketing"><option value="">Wybierz konto reklamowe</option>{availableAdAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id}</option>)}</select> : <input value={forms.meta.ad_account_id || ''} onChange={(event) => updateForm('meta', 'ad_account_id', event.target.value)} className="field-marketing" placeholder="act_123456789" />}</Field>
            </> : <>
              <Field label="Usługa Search Console" hint="Konto Google musi mieć dostęp do zweryfikowanej usługi domenowej lub usługi z prefiksem URL.">{availableSites.length ? <select value={forms.google.search_console_site_url || ''} onChange={(event) => updateForm('google', 'search_console_site_url', event.target.value)} className="field-marketing"><option value="">Wybierz usługę</option>{availableSites.map((site) => <option key={site.siteUrl} value={site.siteUrl}>{site.siteUrl}</option>)}</select> : <input value={forms.google.search_console_site_url || ''} onChange={(event) => updateForm('google', 'search_console_site_url', event.target.value)} className="field-marketing" placeholder="sc-domain:example.pl" />}</Field>
              <Field label="Konto reklamowe Google Ads" hint="Wpisz 10-cyfrowy numer konta, na którym tworzysz kampanie. Lista podpowiedzi może zawierać także menedżerów; konto podrzędne możesz wpisać ręcznie."><input list="google-ads-customers" value={forms.google.google_ads_customer_id || ''} onChange={(event) => updateForm('google', 'google_ads_customer_id', event.target.value)} className="field-marketing" placeholder="123-456-7890" /><datalist id="google-ads-customers">{availableCustomers.map((customer) => <option key={customer} value={customer} />)}</datalist></Field>
              {typeof integration?.settings?.google_ads_discovery_error === 'string' && <p className="text-xs text-amber-200">{integration.settings.google_ads_discovery_error}</p>}
              <Field label="Konto menedżera Google Ads (opcjonalnie)" hint="Wypełnij tylko wtedy, gdy konto reklamowe jest obsługiwane przez konto menedżera MCC."><input value={forms.google.google_ads_login_customer_id || ''} onChange={(event) => updateForm('google', 'google_ads_login_customer_id', event.target.value)} className="field-marketing" placeholder="ID konta MCC" /></Field>
            </>}
            <button onClick={() => void saveProvider(provider)} disabled={saving === provider} className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-50"><Save className="h-4 w-4" />{saving === provider ? 'Zapisuję…' : 'Zapisz przypisanie kont'}</button>{integration?.status === 'error' && integration.last_error && <p className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-xs text-red-100">{integration.last_error}</p>}</div>
          </div>;
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SettingCard icon={<RefreshCw className="h-5 w-5" />} title="Automatyczna synchronizacja" description="CRM odświeża statystyki i kampanie co 6 godzin. Wiadomości Facebook trafiają przez webhook bez oczekiwania na harmonogram."><Toggle checked={overview?.settings.automaticSyncEnabled !== false} onChange={(checked) => void toggleAutomaticSync(checked)} /></SettingCard>
        <SettingCard icon={<Bot className="h-5 w-5" />} title="Analiza i rekomendacje AI" description="Po włączeniu do OpenAI wysyłane są wyłącznie zagregowane statystyki kampanii i SEO. Treści wiadomości oraz dane klientów nie są przekazywane."><Toggle checked={overview?.settings.aiAnalysisEnabled === true} onChange={(checked) => { if (!checked || window.confirm('Włączyć analizę AI i przekazywanie zagregowanych wyników tej marki do OpenAI?')) void toggleAI(checked); }} /></SettingCard>
      </div>

      <section className="rounded-xl border border-[#d3bb73]/25 bg-[#351020] p-5">
        <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#d3bb73]" /><div><h2 className="text-sm text-[#e5e4e2]">Konfiguracja po stronie dostawców</h2><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/50">Poniższe adresy są adresami produkcyjnymi. Wklej je dokładnie w panelach Meta i Google — nie używaj adresu localhost.</p></div></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#411326] p-4"><div className="flex items-center gap-2 text-[#d3bb73]"><Facebook className="h-4 w-4" /><h3 className="text-xs font-medium uppercase tracking-wide">Meta / Facebook</h3></div><p className="mt-4 text-xs text-[#e5e4e2]/65">Adres webhooka dla wiadomości strony</p><CopyValue value={`${MARKETING_PUBLIC_BASE_URL}/bridge/marketing/meta-webhook`} /><p className="mt-4 text-xs text-[#e5e4e2]/65">Adres przekierowania OAuth</p><CopyValue value={`${MARKETING_PUBLIC_BASE_URL}/bridge/marketing/oauth/meta/callback`} /><p className="mt-4 text-[11px] leading-5 text-[#e5e4e2]/45">Token weryfikacyjny w Meta musi odpowiadać zmiennej <code className="text-[#d3bb73]">META_WEBHOOK_VERIFY_TOKEN</code>. Dla strony zasubskrybuj zdarzenie <code className="text-[#d3bb73]">messages</code>.</p></div>
          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#411326] p-4"><div className="flex items-center gap-2 text-[#d3bb73]"><Search className="h-4 w-4" /><h3 className="text-xs font-medium uppercase tracking-wide">Google</h3></div><p className="mt-4 text-xs text-[#e5e4e2]/65">Adres przekierowania OAuth</p><CopyValue value={`${MARKETING_PUBLIC_BASE_URL}/bridge/marketing/oauth/google/callback`} /><p className="mt-4 text-[11px] leading-5 text-[#e5e4e2]/45">Dostęp do Google Ads API wymaga uprawnień produkcyjnych projektu OAuth w Google Cloud. Tokeny OAuth są szyfrowane na serwerze i nie są udostępniane przeglądarce.</p></div>
        </div>
      </section>

      {helpProvider && (
        <IntegrationHelpModal
          topic={helpProvider}
          onTopicChange={setHelpProvider}
          onClose={() => setHelpProvider(null)}
        />
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="block"><span className="mb-2 block text-xs text-[#e5e4e2]/55">{label}</span>{children}{hint && <span className="mt-1.5 block text-[11px] leading-4 text-[#e5e4e2]/38">{hint}</span>}</label>; }
function MissingConfig({ label, values, onHelp }: { label: string; values: string[]; onHelp: () => void }) { return <button type="button" onClick={onHelp} className="rounded-lg border border-[#d3bb73]/25 bg-[#411326] p-3 text-left transition-colors hover:bg-[#5a1d37]"><span className="text-xs font-medium text-[#e5e4e2]">{label}: brak konfiguracji</span><span className="mt-2 flex flex-wrap gap-1.5">{values.map((value) => <code key={value} className="rounded bg-[#210811] px-2 py-1 text-[10px] text-[#d3bb73]">{value}</code>)}</span></button>; }
function SettingCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) { return <div className="flex items-start justify-between gap-5 rounded-xl border border-[#d3bb73]/18 bg-[#411326] p-5"><div className="flex gap-3"><div className="text-[#d3bb73]">{icon}</div><div><h2 className="text-sm text-[#e5e4e2]">{title}</h2><p className="mt-2 text-xs leading-5 text-[#e5e4e2]/50">{description}</p></div></div>{children}</div>; }
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 bg-[#210811] p-2"><code className="min-w-0 flex-1 break-all px-1 text-xs leading-5 text-[#e2cd8d]">{value}</code><button type="button" onClick={() => void copy()} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#d3bb73]/25 bg-[#d3bb73]/10 px-2.5 py-2 text-[10px] uppercase tracking-wide text-[#d3bb73] hover:bg-[#d3bb73]/20" aria-label={`Kopiuj adres ${value}`}><Copy className="h-3.5 w-3.5" />{copied ? 'Skopiowano' : 'Kopiuj'}</button></div>;
}
function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="flex shrink-0 items-center gap-2.5"><span className={`min-w-[58px] text-right text-[10px] uppercase tracking-wide ${checked ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'}`}>{checked ? 'Włączona' : 'Wyłączona'}</span><button type="button" role="switch" aria-checked={checked} aria-label={checked ? 'Wyłącz ustawienie' : 'Włącz ustawienie'} onClick={() => onChange(!checked)} className={`relative h-7 w-[52px] shrink-0 rounded-full border transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/35 ${checked ? 'border-[#e2cd8d] bg-[#d3bb73]' : 'border-[#d3bb73]/40 bg-[#210811]'}`}><span className={`absolute left-[3px] top-[3px] h-5 w-5 rounded-full shadow-sm transition-all duration-200 ${checked ? 'translate-x-[24px] bg-[#351020]' : 'translate-x-0 bg-[#d3bb73]/75'}`} /></button></div>;
}

type HelpTopic = MarketingProvider | 'overview';

function IntegrationHelpModal({
  topic,
  onTopicChange,
  onClose,
}: {
  topic: HelpTopic;
  onTopicChange: (topic: HelpTopic) => void;
  onClose: () => void;
}) {
  const topics: Array<{ value: HelpTopic; label: string }> = [
    { value: 'overview', label: 'Jak zacząć' },
    { value: 'meta', label: 'Meta / Facebook' },
    { value: 'google', label: 'Google' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="marketing-help-title" onMouseDown={(event) => event.stopPropagation()} className="flex h-[calc(100vh-2rem)] max-h-[880px] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/35 bg-[#2c0b18] shadow-2xl sm:h-[88vh]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[#d3bb73]/20 bg-[#411326] px-6 py-5">
          <div className="flex gap-3"><div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-2 text-[#d3bb73]"><BookOpen className="h-5 w-5" /></div><div><h2 id="marketing-help-title" className="text-lg text-[#e5e4e2]">Integracje marketingowe wielu marek</h2><p className="mt-1 text-xs text-[#e5e4e2]/50">Instrukcja połączenia, wyboru kont i późniejszej zmiany ustawień.</p></div></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[#e5e4e2]/55 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]" aria-label="Zamknij instrukcję"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex h-14 shrink-0 items-end gap-2 overflow-x-auto border-b border-[#d3bb73]/15 bg-[#2c0b18] px-6">
          {topics.map((item) => <button data-crm-tab-active={topic === item.value} key={item.value} type="button" onClick={() => onTopicChange(item.value)} className={`whitespace-nowrap rounded-t-lg border border-b-0 px-4 py-2 text-xs transition-colors ${topic === item.value ? 'border-[#d3bb73]/35 bg-[#6a2340] text-white' : 'border-transparent text-[#e5e4e2]/50 hover:bg-[#5a1d37] hover:text-white'}`}>{item.label}</button>)}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 text-sm leading-6 text-[#e5e4e2]/70">
          {topic === 'overview' && <OverviewHelp />}
          {topic === 'meta' && <MetaHelp />}
          {topic === 'google' && <GoogleHelp />}
        </div>
      </div>
    </div>
  );
}

function OverviewHelp() {
  return <div className="space-y-6"><HelpTitle>Wymagane zabezpieczenie serwera</HelpTitle><Notice>Przed pierwszym połączeniem wygeneruj prywatnie klucz poleceniem <code>openssl rand -hex 32</code> i zapisz wynik jako poniższą zmienną. Nie pokazuj wartości na zrzutach. Klucz musi pozostać niezmienny — jego późniejsza zmiana uniemożliwi odszyfrowanie zapisanych tokenów i będzie wymagała ponownego połączenia kont.</Notice><EnvironmentBlock values={['MARKETING_TOKEN_ENCRYPTION_KEY=<wynik polecenia openssl rand -hex 32>']} /><HelpTitle>Najprostsza ścieżka uruchomienia</HelpTitle><ol className="space-y-3"><HelpStep number="1" title="Wybierz właściwą markę">Każda marka ma osobne połączenia, statystyki, wiadomości i kampanie. Sprawdź nazwę firmy widoczną w nagłówku.</HelpStep><HelpStep number="2" title="Połącz dostawcę">Kliknij „Połącz Meta / Facebook” lub „Połącz Google” i zaloguj się kontem mającym dostęp do wymaganych zasobów.</HelpStep><HelpStep number="3" title="Wybierz zasoby z listy">Po powrocie CRM pokaże dostępne strony, konta reklamowe i usługi Search Console. Wybierz właściwe pozycje i zapisz przypisanie.</HelpStep><HelpStep number="4" title="Uruchom synchronizację">Kliknij „Synchronizuj”. Następne odświeżenia mogą wykonywać się automatycznie, a wiadomości Facebook trafiają przez webhook.</HelpStep></ol><Notice>Jeżeli po autoryzacji nadal widzisz zwykłe pole tekstowe zamiast listy, konto nie ma dostępu do zasobu albo aplikacja OAuth nie otrzymała wymaganego uprawnienia. Wtedy sprawdź instrukcję odpowiedniego dostawcy.</Notice><HelpTitle>Późniejsza zmiana</HelpTitle><p>Wybierz inne konto z listy i kliknij „Zapisz przypisanie kont”. Jeśli nowego zasobu nie ma na liście, najpierw nadaj dostęp w Meta lub Google, a następnie użyj „Odśwież dostęp”.</p></div>;
}

function MetaHelp() {
  return <div className="space-y-6"><Notice>ID strony i ID konta reklamowego nie zastępują konfiguracji OAuth. Najpierw jedna globalna aplikacja Meta musi zostać połączona z serwerem CRM. Dopiero później każda marka wybiera własną stronę i konto reklamowe.</Notice><HelpTitle>Konfiguracja aplikacji Meta — krok po kroku</HelpTitle><ol className="space-y-3"><HelpStep number="1" title="Utwórz aplikację w Meta for Developers">Otwórz panel aplikacji Meta i wybierz „Create app”. Na ekranie „Dodaj przypadki użycia” użyj dokładnie poniższego wyboru.</HelpStep></ol><MetaUseCaseSelection /><ol start={2} className="space-y-3"><HelpStep number="2" title="Skopiuj App ID i App Secret">W aplikacji otwórz <strong>App settings → Basic</strong>. Skopiuj App ID oraz App Secret. Sekretu nie wpisuj w CRM ani nie wysyłaj e-mailem.</HelpStep><HelpStep number="3" title="Skonfiguruj Facebook Login for Business">Wróć do panelu <strong>Meta for Developers</strong> na <strong>developers.facebook.com/apps</strong> — nie do Ustawień firmowych Meta. Otwórz aplikację „Mavinci Event &amp; ART – CRM” i w jej lewym menu rozwiń <strong>Facebook Login for Business</strong>. W zakładce <strong>Settings</strong> dodaj poniższy adres do „Valid OAuth Redirect URIs”. Następnie otwórz <strong>Configurations → Create configuration</strong>, wpisz nazwę „Mavinci CRM”, wybierz wariant „General” oraz „User access token” i dodaj uprawnienia wymagane przez CRM. Po utworzeniu skopiuj Configuration ID.</HelpStep></ol><CopyValue value={`${MARKETING_PUBLIC_BASE_URL}/bridge/marketing/oauth/meta/callback`} /><ol start={4} className="space-y-3"><HelpStep number="4" title="Dodaj cztery zmienne w hostingu CRM">W panelu hostingu aplikacji <strong>mavinci.pl</strong> otwórz ustawienia projektu i sekcję Environment Variables lub Secrets. W Vercel jest to <strong>Project → Settings → Environment Variables</strong>. Dodaj wartości pokazane niżej, a następnie wykonaj redeploy.</HelpStep></ol><EnvironmentBlock values={['META_APP_ID=<App ID z Meta>', 'META_APP_SECRET=<App Secret z Meta>', 'META_LOGIN_CONFIG_ID=<Configuration ID>', 'META_WEBHOOK_VERIFY_TOKEN=<własny długi losowy tekst>']} /><ol start={5} className="space-y-3"><HelpStep number="5" title="Skonfiguruj webhook wiadomości strony">W sekcji Webhooks wybierz po lewej obiekt <strong>Page</strong>, nie „User”. Wklej poniższy Callback URL i jako Verify Token podaj dokładnie wartość zapisaną w <code>META_WEBHOOK_VERIFY_TOKEN</code>. Kliknij „Verify and save”, a następnie w tabeli pól włącz wyłącznie <code>messages</code> z wersją <code>v26.0</code>. Dwa dodatkowe przełączniki przy formularzu pozostaw wyłączone.</HelpStep></ol><CopyValue value={`${MARKETING_PUBLIC_BASE_URL}/bridge/marketing/meta-webhook`} /><ol start={6} className="space-y-3"><HelpStep number="6" title="Wróć do CRM i kliknij Połącz">Zaloguj się profilem Facebook mającym dostęp do strony i konta reklamowego marki. Po powrocie wybierz zasoby z listy i zapisz przypisanie.</HelpStep></ol><div className="flex flex-wrap gap-2"><GuideLink href="https://developers.facebook.com/apps/">Aplikacje Meta</GuideLink><GuideLink href="https://business.facebook.com/settings/">Ustawienia firmowe Meta</GuideLink><GuideLink href="https://adsmanager.facebook.com/">Menedżer reklam</GuideLink></div><HelpTitle>Gdzie znaleźć identyfikatory marki</HelpTitle><div className="space-y-3"><HelpBox title="ID strony na Facebooku">Ustawienia firmowe Meta → Konta → Strony → wybierz stronę. Po poprawnym OAuth CRM powinien pokazać stronę na liście automatycznie.</HelpBox><HelpBox title="ID konta reklamowego">Ustawienia firmowe Meta → Konta → Konta reklamowe albo nagłówek Menedżera reklam. CRM akceptuje sam numer oraz zapis zaczynający się od <code>act_</code>.</HelpBox></div></div>;
}

function GoogleHelp() {
  return <div className="space-y-6"><Notice>Google wymaga klienta OAuth oraz dostępu do Google Ads API dla tego samego projektu w Google Cloud. Wybrana marka przechowuje później tylko usługę Search Console i identyfikator konta reklamowego.</Notice><HelpTitle>Konfiguracja Google — krok po kroku</HelpTitle><ol className="space-y-3"><HelpStep number="1" title="Utwórz lub wybierz projekt Google Cloud">W Google Cloud Console włącz Google Search Console API oraz Google Ads API. Skonfiguruj ekran zgody OAuth dla aplikacji używanej przez CRM.</HelpStep><HelpStep number="2" title="Utwórz klienta OAuth typu Web application">Przejdź do Google Auth Platform → Clients, wybierz „Create Client” i typ „Web application”. W sekcji Authorized redirect URIs wklej dokładnie poniższy adres.</HelpStep></ol><CopyValue value={`${MARKETING_PUBLIC_BASE_URL}/bridge/marketing/oauth/google/callback`} /><ol start={3} className="space-y-3"><HelpStep number="3" title="Skopiuj Client ID i Client Secret">Zapisz je jako sekrety hostingu CRM. W Vercel: <strong>Project → Settings → Environment Variables</strong>. Po zapisaniu wykonaj redeploy.</HelpStep></ol><EnvironmentBlock values={['GOOGLE_MARKETING_CLIENT_ID=<Client ID>', 'GOOGLE_MARKETING_CLIENT_SECRET=<Client Secret>']} /><ol start={4} className="space-y-3"><HelpStep number="4" title="Sprawdź dostęp projektu do Google Ads API">W Google Cloud otwórz Google Ads API dla projektu używanego przez klienta OAuth i sprawdź poziom dostępu do kont produkcyjnych. Od 9 września 2026 dostęp jest zarządzany w Google Cloud; token deweloperski nie jest już wymagany.</HelpStep></ol><ol start={5} className="space-y-3"><HelpStep number="5" title="Wróć do CRM i kliknij Połącz Google">Zaloguj się kontem mającym dostęp do zweryfikowanej usługi Search Console oraz odpowiedniego konta Google Ads. Po powrocie wybierz zasoby i zapisz przypisanie.</HelpStep></ol><div className="flex flex-wrap gap-2"><GuideLink href="https://console.cloud.google.com/apis/credentials">Dane logowania Google Cloud</GuideLink><GuideLink href="https://console.cloud.google.com/apis/library/googleads.googleapis.com">Google Ads API w Google Cloud</GuideLink><GuideLink href="https://search.google.com/search-console">Search Console</GuideLink></div><HelpTitle>Identyfikatory marki</HelpTitle><div className="space-y-3"><HelpBox title="Usługa Search Console">Musi być wcześniej dodana i zweryfikowana. Usługa domenowa pojawi się jako <code>sc-domain:twojadomena.pl</code>, a usługa prefiksowa jako pełny adres HTTPS.</HelpBox><HelpBox title="Customer ID Google Ads">10-cyfrowy numer w formacie <code>123-456-7890</code>, widoczny przy nazwie konta. Pole MCC wypełnia się tylko przy dostępie przez konto menedżera.</HelpBox></div></div>;
}

function HelpTitle({ children }: { children: ReactNode }) { return <h3 className="text-sm font-medium uppercase tracking-wide text-[#d3bb73]">{children}</h3>; }
function HelpStep({ number, title, children }: { number: string; title: string; children: ReactNode }) { return <li className="flex gap-3 rounded-lg border border-[#d3bb73]/15 bg-[#411326] p-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d3bb73] text-xs font-semibold text-[#210811]">{number}</span><div><p className="font-medium text-[#e5e4e2]">{title}</p><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/55">{children}</p></div></li>; }
function HelpBox({ title, children }: { title: string; children: ReactNode }) { return <div className="rounded-lg border border-[#d3bb73]/18 bg-[#411326] p-4"><p className="font-medium text-[#e5e4e2]">{title}</p><p className="mt-1 text-xs leading-5 text-[#e5e4e2]/55">{children}</p></div>; }
function Notice({ children }: { children: ReactNode }) { return <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-4 text-xs leading-5 text-[#e5e4e2]/70">{children}</div>; }
function MetaUseCaseSelection() { return <div className="space-y-4 rounded-xl border border-[#d3bb73]/30 bg-[#411326] p-4"><div><p className="text-xs font-medium uppercase tracking-wide text-[#d3bb73]">Na ekranie wyboru zaznacz tylko</p><p className="mt-3 text-xs leading-5 text-[#e5e4e2]/70"><strong className="text-[#e5e4e2]">„Twórz i zarządzaj reklamami za pomocą interfejsu API Marketingu”</strong> — pierwsza opcja na liście. Następnie kliknij „Następny”.</p></div><div className="rounded-lg border border-[#d3bb73]/20 bg-[#210811] p-3"><p className="text-[11px] font-medium text-[#e2cd8d]">Nie zaznaczaj osobnego „Logowania przez Facebooka”.</p><p className="mt-1 text-[11px] leading-5 text-[#e5e4e2]/45">To alternatywny, niekompatybilny przypadek użycia. Marketing API automatycznie doda właściwy moduł „Facebook Login for Business” — jego obecność w lewym menu utworzonej aplikacji jest prawidłowa.</p></div><div className="rounded-lg border border-[#d3bb73]/25 bg-[#5a1d37] p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-[#e2cd8d]">Po utworzeniu aplikacji — następny klik</p><p className="mt-2 text-xs leading-5 text-[#e5e4e2]/70">Na pulpicie kliknij pierwszy wiersz <strong className="text-[#e5e4e2]">„Customize the Create &amp; manage ads with Marketing API use case”</strong>. Nie uruchamiaj jeszcze „Test use cases”, „Publish” ani „Become a Tech Provider”.</p></div><div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-emerald-200">Ekrany Marketing API</p><p className="mt-2 text-[11px] leading-5 text-[#e5e4e2]/60">Na „Permissions and features” status „Ready for testing” przy <code>ads_management</code>, <code>ads_read</code>, <code>business_management</code>, <code>pages_read_engagement</code> i <code>pages_show_list</code> oznacza poprawną konfigurację. Niczego nie wybieraj z „Actions”.</p><p className="mt-2 text-[11px] leading-5 text-[#e5e4e2]/60">Na ekranie Marketing API → „Settings” pozostaw auto-upgrade włączony. Nie akceptuj Marketing Messages i nie uruchamiaj jeszcze weryfikacji. Adres OAuth nie znajduje się tutaj.</p></div><div className="rounded-lg border border-[#d3bb73]/25 bg-[#210811] p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-[#e2cd8d]">Właściwe miejsce dla OAuth</p><p className="mt-2 text-[11px] leading-5 text-[#e5e4e2]/60">Wróć do głównego menu aplikacji i rozwiń <strong className="text-[#e5e4e2]">Facebook Login for Business</strong>. Użyj jego zakładek <strong className="text-[#e5e4e2]">Settings</strong> oraz <strong className="text-[#e5e4e2]">Configurations</strong> zgodnie z kolejnym krokiem instrukcji.</p></div><div className="border-t border-[#d3bb73]/15 pt-3"><p className="text-[11px] leading-5 text-[#e5e4e2]/45">App ID i App Secret znajdziesz później w <strong>App settings → Basic</strong>. Obsługę wiadomości dodasz przez Messenger API i Webhooks.</p></div><div className="rounded-lg bg-[#210811] p-3"><p className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/40">Uprawnienia wymagane przez CRM</p><code className="mt-2 block break-all text-[11px] leading-5 text-[#e2cd8d]">pages_show_list, pages_read_engagement, pages_manage_metadata, pages_messaging, ads_read, ads_management, business_management</code></div></div>; }
function EnvironmentBlock({ values }: { values: string[] }) { return <div className="rounded-lg border border-[#d3bb73]/25 bg-[#210811] p-4"><p className="mb-2 text-[10px] uppercase tracking-wide text-[#e5e4e2]/40">Zmienne środowiskowe serwera</p>{values.map((value) => <code key={value} className="block break-all py-1 text-xs text-[#e2cd8d]">{value}</code>)}</div>; }
function GuideLink({ href, children }: { href: string; children: ReactNode }) { return <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/25 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">{children}<ExternalLink className="h-3.5 w-3.5" /></a>; }
