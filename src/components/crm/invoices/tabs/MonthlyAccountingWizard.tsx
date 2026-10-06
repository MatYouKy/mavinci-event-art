'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, Upload } from 'lucide-react';
import BankTransactionsAnalysis from '@/components/crm/BankTransactionsAnalysis';
import BankAiAnalysisPanel from '@/components/crm/BankAiAnalysisPanel';
import BankStatementParserPreview from './BankStatementParserPreview';
import MonthlyIncomeCostsStep from './MonthlyIncomeCostsStep';
import MonthlyObligationsStep from './MonthlyObligationsStep';
import MonthlyTaxesStep from './MonthlyTaxesStep';
import SaldeoDeliveryPanel, { loadSnapshot, type Snapshot } from './SaldeoDeliveryPanel';

type Step = 'statements' | 'income-costs' | 'obligations' | 'taxes' | 'matching' | 'saldeo';
type Props = {
  month: number;
  year: number;
  companyId: string;
  onBack: () => void;
  onUpload: () => void;
  onDownload: (id: string, accountType: 'regular' | 'vat' | 'mt940', month: number, year: number) => void;
};
const steps: { id: Step; label: string; description: string }[] = [
  { id: 'statements', label: 'Wyciągi i konto', description: 'Sprawdź kompletność odczytu i połączone operacje na koncie bieżącym oraz VAT. Oryginały i szczegóły plików są dostępne pod przyciskiem „Pokaż wyciągi”.' },
  { id: 'income-costs', label: 'Przychody i koszty', description: 'Uporządkuj dokumenty sprzedaży i zakupu, z KSeF oraz spoza KSeF. Obroty bankowe są prezentowane oddzielnie od wartości dokumentów.' },
  { id: 'obligations', label: 'Umowy i zobowiązania', description: 'Uzupełnij umowy o pracę i zlecenia, wynagrodzenia, czynsze, polisy oraz inne dokumenty stanowiące podstawę wydatku.' },
  { id: 'taxes', label: 'Podatki i ZUS', description: 'Uporządkuj rozliczenia PIT-4, VAT-7 / JPK_V7 i ZUS na podstawie danych księgowej. Nie wyliczamy zobowiązań na podstawie samych przelewów.' },
  { id: 'matching', label: 'Dopasowanie i braki', description: 'Połącz przelewy z dokumentami, także jedną płatność z kilkoma fakturami. Tutaj sprawdzisz braki i zapiszesz wyjaśnienia pozostałych operacji.' },
  { id: 'saldeo', label: 'Przygotowanie Saldeo', description: 'Sprawdź paczkę przed wysłaniem. Do Saldeo trafiają dokumenty spoza KSeF, a dla księgowej wyciągi i zestawienie płatności zbiorczych. Wysyłka wymaga osobnego potwierdzenia.' },
];
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--brand-platinum)] hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:opacity-40';
const primary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--brand-gold)] px-4 py-2.5 text-sm font-medium text-[var(--brand-burgundy-950)] hover:brightness-105 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] disabled:opacity-40';

export default function MonthlyAccountingWizard({ month, year, companyId, onBack, onUpload, onDownload }: Props) {
  const [step, setStep] = useState<Step>('statements');
  const [matchingMode, setMatchingMode] = useState<'costs' | 'income' | 'ai'>('costs');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statementRefreshKey, setStatementRefreshKey] = useState(0);
  const [statementPreviewLoading, setStatementPreviewLoading] = useState(false);
  const request = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const stepIndex = steps.findIndex((item) => item.id === step);
  const current = steps[stepIndex];
  const title = new Date(year, month - 1, 1).toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });

  const refresh = useCallback(async (silent = false) => {
    const revision = ++request.current;
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const data = await loadSnapshot(companyId, month, year);
      if (revision !== request.current) return;
      setSnapshot(data); setError(null);
    } catch (cause) {
      if (revision !== request.current) return;
      setError(cause instanceof Error ? cause.message : 'Nie udało się odczytać danych miesiąca.');
    } finally {
      if (revision === request.current) { setLoading(false); setRefreshing(false); }
    }
  }, [companyId, month, year]);
  const onChanged = useCallback(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    setStep('statements'); setMatchingMode('costs'); setSnapshot(null);
    void refresh();
    return () => { request.current += 1; };
  }, [refresh]);
  const goTo = (next: Step) => {
    setStep(next);
    if (next !== 'statements' && next !== 'saldeo') void refresh(true);
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const refreshMonth = () => { setStatementRefreshKey((value) => value + 1); void refresh(true); };
  const busy = refreshing || (step === 'statements' && statementPreviewLoading);

  return <div className="space-y-5 text-[var(--brand-platinum)]">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <button type="button" onClick={onBack} className={`${button} mb-3`}><ArrowLeft className="h-4 w-4" />Wszystkie miesiące</button>
        <h2 ref={heading} tabIndex={-1} className="scroll-mt-6 font-atom text-xl uppercase outline-none">Rozliczenie miesiąca — {title}</h2>
        <p className="mt-2 text-sm text-[var(--brand-platinum)]/55">Sześć kroków od wyciągu do paczki dla księgowej. Możesz wrócić do dowolnego kroku.</p>
      </div>
      {step === 'statements' && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={refreshMonth} disabled={busy} aria-busy={busy} className={button}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Odśwież konto</button>
        <button type="button" onClick={onUpload} className={button}><Upload className="h-4 w-4" />Dodaj wyciąg</button>
      </div>}
    </header>
    <nav aria-label="Kroki rozliczenia miesiąca" className="rounded-xl bg-[var(--brand-burgundy-800)] p-2">
      <ol className="grid gap-1 sm:grid-cols-2 xl:grid-cols-6">{steps.map((item, index) => <li key={item.id}>
        <button type="button" onClick={() => goTo(item.id)} aria-current={step === item.id ? 'step' : undefined} className={`flex h-full w-full items-center gap-2 rounded-lg px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--crm-field-border-focus)] ${step === item.id ? 'bg-[var(--brand-gold)] font-medium text-[var(--brand-burgundy-950)]' : 'text-[var(--brand-platinum)]/65 hover:bg-white/5'}`}>
          <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums ${step === item.id ? 'bg-black/10' : 'bg-white/5'}`}>{index + 1}</span>{item.label}
        </button>
      </li>)}</ol>
    </nav>
    <section aria-labelledby="monthly-step-heading" className="space-y-4">
      <div>
        <p className="text-xs text-[var(--brand-gold)]">Krok {stepIndex + 1} z {steps.length}</p>
        <h3 id="monthly-step-heading" className="mt-1 font-atom text-lg uppercase">{current.label}</h3>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--brand-platinum)]/60">{current.description}</p>
      </div>
      {step === 'statements' && <BankStatementParserPreview companyId={companyId} month={month} year={year} refreshKey={statementRefreshKey} hideRefresh onLoadingChange={setStatementPreviewLoading} onTransfersLinked={onChanged} onDownload={onDownload} />}
      {step !== 'statements' && step !== 'saldeo' && (loading ? <div role="status" className="flex items-center gap-2 rounded-xl bg-white/5 p-5 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Wczytuję dane miesiąca…</div> : error ? <div role="alert" className="rounded-xl bg-amber-400/5 p-5 text-sm text-amber-200"><p>{error}</p><button type="button" onClick={() => void refresh()} className={`${button} mt-3`}>Spróbuj ponownie</button></div> : snapshot && <>
        {step === 'income-costs' && <MonthlyIncomeCostsStep snapshot={snapshot} month={month} year={year} onChanged={onChanged} />}
        {step === 'obligations' && <MonthlyObligationsStep companyId={companyId} month={month} year={year} snapshot={snapshot} onChanged={onChanged} />}
        {step === 'taxes' && <MonthlyTaxesStep companyId={companyId} month={month} year={year} snapshot={snapshot} onChanged={onChanged} />}
        {step === 'matching' && <>
          <div role="group" aria-label="Sposób dopasowania" className="flex flex-wrap gap-2">{([{ id: 'costs', label: 'Dopasuj koszty' }, { id: 'income', label: 'Dopasuj przychody' }, { id: 'ai', label: 'Propozycje AI i lista braków' }] as const).map((item) => <button type="button" key={item.id} aria-pressed={matchingMode === item.id} onClick={() => setMatchingMode(item.id)} className={matchingMode === item.id ? primary : button}>{item.label}</button>)}</div>
          {matchingMode === 'ai' ? <BankAiAnalysisPanel month={month} year={year} companyId={companyId} embedded onMatchApplied={onChanged} /> : <BankTransactionsAnalysis key={`${companyId}:${year}:${month}:${matchingMode}`} month={month} year={year} companyId={companyId} embedded initialFilter="unmatched" direction={matchingMode === 'costs' ? 'debit' : 'credit'} onChanged={onChanged} onClose={() => setMatchingMode('ai')} />}
        </>}
      </>)}
      {step === 'saldeo' && <SaldeoDeliveryPanel companyId={companyId} period={{ month, year }} />}
    </section>
    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/[0.025] p-4">
      {stepIndex > 0 ? <button type="button" onClick={() => goTo(steps[stepIndex - 1].id)} className={button}><ArrowLeft className="h-4 w-4" />Wstecz: {steps[stepIndex - 1].label}</button> : <span className="text-xs text-[var(--brand-platinum)]/45">Przejście dalej nie zatwierdza danych ani dopasowań.</span>}
      {stepIndex < steps.length - 1 ? <button type="button" onClick={() => goTo(steps[stepIndex + 1].id)} className={primary}>Dalej: {steps[stepIndex + 1].label}<ArrowRight className="h-4 w-4" /></button> : <span className="text-xs text-[var(--brand-platinum)]/45">Paczka zostanie wysłana dopiero po Twoim potwierdzeniu.</span>}
    </footer>
  </div>;
}
