'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CreditCard, ExternalLink, FileText, RefreshCw, Shield } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { OPENAI_BILLING_LINKS, type OpenAiAmount, type OpenAiUsageReport } from '@/lib/CRM/ai/openAiUsage';

const count = (value: number) => value.toLocaleString('pl-PL');
const money = (values: OpenAiAmount[]) => values.length
  ? values.map(({ currency, value }) => value.toLocaleString('pl-PL', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 4 })).join(' · ')
  : 'Brak naliczonych kosztów';
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString('pl-PL', { timeZone: 'UTC' });
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-sm text-[#e5e4e2] transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#d3bb73]/50 disabled:opacity-50';
const statusLabels: Record<OpenAiUsageReport['status'], string> = {
  ready: 'Dane pobrane', partial: 'Dane częściowe', unavailable: 'Dane niedostępne', not_configured: 'Wymaga konfiguracji',
};

export default function OpenAiUsagePanel() {
  const { showSnackbar } = useSnackbar();
  const [months] = useState(() => {
    const now = new Date();
    return Array.from({ length: 24 }, (_, offset) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      return { value: date.toISOString().slice(0, 7), label: date.toLocaleDateString('pl-PL', { year: 'numeric', month: 'long', timeZone: 'UTC' }) };
    });
  });
  const [month, setMonth] = useState(months[0].value);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<OpenAiUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let timedOut = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 40_000);
    setLoading(true); setError(''); setReport(null);
    void (async () => {
      try {
        const response = await fetch(`/bridge/admin/openai-usage?month=${encodeURIComponent(month)}`, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Nie udało się pobrać statystyk AI.');
        if (!active) return;
        setReport(payload as OpenAiUsageReport);
        if (payload.status === 'unavailable') showSnackbar('Nie udało się odczytać statystyk OpenAI. Szczegóły są w panelu AI.', 'error');
        else if (payload.status === 'partial') showSnackbar('Część statystyk OpenAI jest niedostępna. Brakujących danych nie traktujemy jako zero.', 'warning');
      } catch (cause) {
        if (!active) return;
        const message = timedOut ? 'Pobieranie statystyk trwało zbyt długo. Spróbuj ponownie.'
          : cause instanceof Error ? cause.message : 'Nie udało się pobrać statystyk AI.';
        setError(message); showSnackbar(message, 'error');
      } finally { clearTimeout(timeout); if (active) setLoading(false); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [month, revision, showSnackbar]);

  const tokens = report?.usage?.totals;
  return <section className="space-y-5 rounded-xl bg-[#1c1f33] p-4 md:p-6" aria-labelledby="openai-usage-title" aria-busy={loading}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h3 id="openai-usage-title" className="text-lg font-light text-[#e5e4e2]">OpenAI — zużycie i rozliczenia</h3>
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#d3bb73]/10 px-2.5 py-1 text-xs text-[#d3bb73]"><Shield className="h-3.5 w-3.5" />Tylko administrator</span>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#e5e4e2]/60">Zużyte tokeny i naliczone koszty z OpenAI. To nie jest liczba pozostałych tokenów ani saldo doładowań.</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-[#e5e4e2]/60">Okres
          <select value={month} onChange={(event) => setMonth(event.target.value)} className="mt-1.5 block rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2]">
            {months.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button type="button" disabled={loading} onClick={() => setRevision((value) => value + 1)} className={button}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież</button>
      </div>
    </div>

    {loading && <p role="status" className="rounded-lg bg-white/[0.03] p-4 text-sm text-[#e5e4e2]/60">Pobieranie zużycia i kosztów OpenAI…</p>}
    {error && <p role="alert" className="rounded-lg bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}

    {report && <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#e5e4e2]/55">
        <span>{report.scope.type === 'projects' ? `Zakres: wybrane projekty OpenAI (${report.scope.projectIds.length})` : 'Zakres: cała organizacja OpenAI'}</span>
        <span>{statusLabels[report.status]}</span>
      </div>
      {report.scope.type === 'organization' && report.status !== 'not_configured' && <p className="rounded-lg bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">Te dane mogą obejmować również inne aplikacje. Aby ograniczyć je do CRM, ustaw na serwerze OPENAI_USAGE_PROJECT_IDS dla projektów używanych przez CRM i funkcje Supabase.</p>}
      {report.status === 'not_configured' ? <div className="rounded-lg bg-[#d3bb73]/10 p-4 text-sm leading-6 text-[#e5e4e2]/80">
        <p className="font-medium text-[#d3bb73]">Połącz statystyki OpenAI</p>
        <p className="mt-2">Na serwerze aplikacji potrzebny jest sekret <code>OPENAI_ADMIN_KEY</code> z tej samej organizacji OpenAI, z której korzysta CRM. Zwykły klucz do generowania odpowiedzi nie zastępuje tego klucza. Nie wklejaj go do wiadomości ani pól publicznych.</p>
        <a className="mt-3 inline-flex items-center gap-2 text-[#d3bb73] underline underline-offset-4" href={OPENAI_BILLING_LINKS.adminKeys} target="_blank" rel="noopener noreferrer">Otwórz klucze administracyjne OpenAI<ExternalLink className="h-3.5 w-3.5" /></a>
      </div> : <>
        {report.warnings.map((warning) => <div key={warning} role="alert" className="flex items-start gap-2 rounded-lg bg-amber-400/10 p-3 text-xs leading-5 text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{warning}</span></div>)}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric title="Zużyte tokeny" value={tokens ? count(tokens.totalTokens) : 'Niedostępne'} description="Wejście + odpowiedzi modelu" />
          <Metric title="Tokeny wejściowe" value={tokens ? count(tokens.inputTokens) : 'Niedostępne'} description={tokens ? `W tym z pamięci podręcznej: ${count(tokens.cachedInputTokens)}` : 'Dane wejściowe przekazane modelom'} />
          <Metric title="Tokeny odpowiedzi" value={tokens ? count(tokens.outputTokens) : 'Niedostępne'} description={tokens ? `Wywołania modeli: ${count(tokens.requests)}` : 'Odpowiedzi wygenerowane przez modele'} />
          <Metric title="Naliczone koszty" value={report.costs ? money(report.costs.totals) : 'Niedostępne'} description="Według rozliczeń OpenAI, nie cennika szacunkowego" />
        </div>
        {report.usage && report.usage.models.length > 0 && <details className="rounded-lg bg-[#0f1119] p-4">
          <summary className="cursor-pointer text-sm text-[#d3bb73]">Zużycie według modeli</summary>
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs text-[#e5e4e2]/80">
            <caption className="sr-only">Tokeny i wywołania według modeli OpenAI</caption>
            <thead className="text-[#e5e4e2]/50"><tr><th scope="col" className="p-2">Model</th><th scope="col" className="p-2 text-right">Wejście</th><th scope="col" className="p-2 text-right">Odpowiedzi</th><th scope="col" className="p-2 text-right">Wywołania</th></tr></thead>
            <tbody>{report.usage.models.map((model) => <tr key={model.model} className="border-t border-white/5"><th scope="row" className="p-2 font-normal">{model.model}</th><td className="p-2 text-right">{count(model.inputTokens)}</td><td className="p-2 text-right">{count(model.outputTokens)}</td><td className="p-2 text-right">{count(model.requests)}</td></tr>)}</tbody>
          </table></div>
        </details>}
        {report.days.length > 0 && <details className="rounded-lg bg-[#0f1119] p-4">
          <summary className="cursor-pointer text-sm text-[#d3bb73]">Historia dzienna zużycia i kosztów</summary>
          <div className="mt-3 max-h-80 overflow-auto"><table className="w-full text-left text-xs text-[#e5e4e2]/80">
            <caption className="sr-only">Zużycie tokenów i koszty według dni UTC</caption>
            <thead className="text-[#e5e4e2]/50"><tr><th scope="col" className="p-2">Dzień (UTC)</th><th scope="col" className="p-2 text-right">Tokeny</th><th scope="col" className="p-2 text-right">Koszt</th></tr></thead>
            <tbody>{report.days.map((day) => <tr key={day.date} className="border-t border-white/5"><th scope="row" className="whitespace-nowrap p-2 font-normal">{dateLabel(day.date)}</th><td className="p-2 text-right">{day.usage ? count(day.usage.totalTokens) : 'Niedostępne'}</td><td className="p-2 text-right">{day.costs ? money(day.costs) : 'Niedostępne'}</td></tr>)}</tbody>
          </table></div>
        </details>}
        {report.fetchedAt && <p className="text-xs leading-5 text-[#e5e4e2]/45">Odczyt: {new Date(report.fetchedAt).toLocaleString('pl-PL')}. Raport odświeża się najwyżej raz na minutę, a dane OpenAI mogą być opóźnione. Okresy liczone są w UTC. Tokeny dotyczą wywołań modeli; koszty mogą też obejmować inne usługi OpenAI.</p>}
      </>}
    </>}

    <div className="rounded-lg bg-[#0f1119] p-4">
      <h4 className="text-sm font-medium text-[#e5e4e2]">Saldo, doładowania i faktury</h4>
      <p className="mt-2 text-xs leading-5 text-[#e5e4e2]/60">Aktualne saldo i dokumenty rozliczeniowe sprawdzisz w OpenAI. Doładowanie zatwierdzasz tam samodzielnie — CRM nie pobiera pieniędzy ani danych karty.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={OPENAI_BILLING_LINKS.overview} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"><CreditCard className="h-4 w-4" />Saldo i doładowanie<ExternalLink className="h-3.5 w-3.5" /></a>
        <a href={OPENAI_BILLING_LINKS.history} target="_blank" rel="noopener noreferrer" className={button}><FileText className="h-4 w-4" />Historia płatności i faktury<ExternalLink className="h-3.5 w-3.5" /></a>
        <a href={OPENAI_BILLING_LINKS.usage} target="_blank" rel="noopener noreferrer" className={button}>Pełne statystyki OpenAI<ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#e5e4e2]/45">Wymagane jest logowanie do właściwej organizacji OpenAI z dostępem do rozliczeń. Uprawnienia administratora CRM nie nadają uprawnień w OpenAI.</p>
    </div>
  </section>;
}

function Metric({ title, value, description }: { title: string; value: string; description: string }) {
  return <div className="rounded-lg bg-[#0f1119] p-4"><p className="text-xs text-[#e5e4e2]/55">{title}</p><p className="mt-2 break-words text-xl font-medium text-[#d3bb73]">{value}</p><p className="mt-2 text-[11px] leading-5 text-[#e5e4e2]/45">{description}</p></div>;
}
