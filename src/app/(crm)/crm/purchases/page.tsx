'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, RefreshCw, ShoppingCart } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import PurchaseFormModal from '@/components/crm/purchases/PurchaseFormModal';
import PurchaseMonthView from '@/components/crm/purchases/PurchaseMonthView';
import {
  PurchaseErrorBox,
  PurchaseField,
  PurchaseModal,
  PurchaseStatusBadge,
  purchaseButton,
  purchaseInput,
  purchasePrimaryButton,
} from '@/components/crm/purchases/purchasesUi';
import { purchasesApi } from '@/lib/purchases/purchasesClient';
import {
  purchaseCurrentMonth,
  purchaseDay,
  purchaseErrorMessage,
  purchaseMonthLabel,
  purchaseShiftMonth,
  purchaseTotals,
  purchaseTotalsText,
  type PurchaseDocument,
  type PurchaseMonth,
  type PurchaseMonthCompany,
  type PurchaseReviewRow,
  type PurchaseState,
} from '@/lib/purchases/purchaseShared';

/*
 * Zakupy (`docs/purchases.md`): „Moje wydatki” — zakupy pracownika z uprawnieniem „Zakupy — własne wydatki” (firmowa karta,
 * paragony z NIP i faktury spoza KSeF, koszt eventu) z miesięcznym rozliczeniem; „Rozliczenia pracowników” — dla osoby
 * z „Finanse — zarządzanie” w działalności (zatwierdzenie albo zwrot do poprawy). Linki z powiadomień:
 * `?employee=…&year=…&month=…` (rozliczenie pracownika) i `?year=…&month=…` (własny miesiąc).
 */

type Tab = 'mine' | 'review';
type Decision = { month: PurchaseMonth; company: PurchaseMonthCompany; approve: boolean };

function PurchasesScreen() {
  const params = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const now = purchaseCurrentMonth();
  const [tab, setTab] = useState<Tab>('mine');
  const [period, setPeriod] = useState(() => {
    const year = Number(params.get('year'));
    const month = Number(params.get('month'));
    return year >= 2000 && month >= 1 && month <= 12 && !params.get('employee') ? { year, month } : now;
  });
  const [state, setState] = useState<PurchaseState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<PurchaseDocument | 'new' | null>(null);
  const [submitting, setSubmitting] = useState<PurchaseMonthCompany | null>(null);
  const [submitNote, setSubmitNote] = useState('');
  const [rows, setRows] = useState<PurchaseReviewRow[] | null>(null);
  const [reviewing, setReviewing] = useState<PurchaseMonth | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [decisionNote, setDecisionNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await purchasesApi.state(period.year, period.month);
      setState(next);
      setError(null);
      if (!next.access.record && next.access.approve) setTab('review');
    } catch (failure) {
      setError(purchaseErrorMessage(failure, 'Nie udało się wczytać zakupów.'));
    } finally {
      setLoading(false);
    }
  }, [period.month, period.year]);

  const loadReview = useCallback(async () => {
    try {
      setRows(await purchasesApi.review());
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się wczytać rozliczeń.'), 'error');
      setRows([]);
    }
  }, [showSnackbar]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state?.access.approve) void loadReview();
  }, [loadReview, state?.access.approve]);

  // Link z powiadomienia o wysłanym rozliczeniu — od razu rozliczenie pracownika.
  const openReview = useCallback(async (employee: string, year: number, month: number) => {
    setBusy('Wczytywanie rozliczenia…');
    try {
      const data = await purchasesApi.state(year, month, employee);
      if (data.month) setReviewing(data.month);
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się wczytać rozliczenia.'), 'error');
    } finally {
      setBusy(null);
    }
  }, [showSnackbar]);

  // Tylko raz — przy wejściu z linku (parametry adresu), nie przy każdym odświeżeniu stanu.
  const linkHandled = useRef(false);
  useEffect(() => {
    if (linkHandled.current || !state) return;
    linkHandled.current = true;
    const employee = params.get('employee');
    const year = Number(params.get('year'));
    const month = Number(params.get('month'));
    if (!employee || employee === state.access.employee_id || !(year >= 2000 && month >= 1 && month <= 12)) return;
    setTab('review');
    void openReview(employee, year, month);
  }, [openReview, params, state]);

  const month = state?.month || null;
  const recordCompanies = state?.access.record_companies || [];
  const futureMonth = period.year * 12 + period.month > now.year * 12 + now.month;
  // Dalej niż bieżący miesiąc nie ma czego przeglądać — zakup nie może mieć daty z przyszłości.
  const lastMonth = period.year * 12 + period.month >= now.year * 12 + now.month;
  const waiting = useMemo(() => (rows || []).filter((row) => row.status === 'submitted').length, [rows]);

  const openFile = async (document: PurchaseDocument) => {
    try {
      const { url } = await purchasesApi.fileUrl(document.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się otworzyć pliku.'), 'error');
    }
  };

  const remove = async (document: PurchaseDocument) => {
    const confirmed = await showConfirm({
      title: 'Usunąć zakup?',
      message: `${document.seller_name} · ${document.number} · ${purchaseDay(document.date)}. Dokument i jego plik znikną${document.event ? ', a z eventu zniknie koszt' : ''}.`,
      confirmText: 'Usuń',
    });
    if (!confirmed) return;
    setBusy('Usuwanie zakupu…');
    try {
      await purchasesApi.remove(document.id);
      showSnackbar('Zakup usunięty.', 'success');
      await load();
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się usunąć zakupu.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!submitting) return;
    setBusy('Wysyłanie rozliczenia…');
    try {
      const next = await purchasesApi.submit(submitting.id, period.year, period.month, submitNote);
      setState((current) => (current ? { ...current, month: next } : current));
      setSubmitting(null);
      setSubmitNote('');
      showSnackbar('Rozliczenie wysłane do zatwierdzenia.', 'success');
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się wysłać rozliczenia.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const decide = async () => {
    if (!decision?.company.settlement) return;
    if (!decision.approve && !decisionNote.trim()) {
      showSnackbar('Napisz, co trzeba poprawić — pracownik zobaczy tę uwagę.', 'warning');
      return;
    }
    setBusy(decision.approve ? 'Zatwierdzanie rozliczenia…' : 'Zwracanie rozliczenia…');
    try {
      const next = await purchasesApi.decide(decision.company.settlement.id, decision.approve, decisionNote);
      setReviewing(next);
      setDecision(null);
      setDecisionNote('');
      showSnackbar(decision.approve ? 'Rozliczenie zatwierdzone.' : 'Rozliczenie zwrócone do poprawy.', 'success');
      await loadReview();
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się zapisać decyzji.'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const showTabs = Boolean(state?.access.record && state?.access.approve);
  const submitDocuments = submitting && month ? month.documents.filter((document) => document.company_id === submitting.id) : [];

  return (
    <div className="min-h-screen space-y-5 bg-[#0a0d1a] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-8 w-8 text-[#d3bb73]" />
          <div>
            <h1 className="text-2xl font-light uppercase tracking-wide text-[#e5e4e2]">Zakupy</h1>
            <p className="text-sm text-[#e5e4e2]/60">Zakupy firmową kartą — paragony z NIP i faktury spoza KSeF, koszty eventów i miesięczne rozliczenie.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className={purchaseButton} onClick={() => { void load(); if (state?.access.approve) void loadReview(); }} disabled={loading} aria-label="Odśwież">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {tab === 'mine' && month && recordCompanies.length > 0 && (
            <button type="button" className={purchasePrimaryButton} onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Dodaj zakup</button>
          )}
        </div>
      </div>

      {showTabs && (
        <div className="flex w-fit rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="Widok">
          {([['mine', 'Moje wydatki'], ['review', 'Rozliczenia pracowników']] as Array<[Tab, string]>).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70 hover:bg-white/5'}`}>
              {label}{value === 'review' && waiting > 0 ? <span className="ml-1 opacity-80">({waiting})</span> : null}
            </button>
          ))}
        </div>
      )}

      <PurchaseErrorBox message={error} />

      {tab === 'mine' && month && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <button type="button" className={purchaseButton} onClick={() => setPeriod((current) => purchaseShiftMonth(current.year, current.month, -1))} aria-label="Poprzedni miesiąc">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-40 text-center text-lg font-light uppercase tracking-wide text-[#e5e4e2]">{purchaseMonthLabel(period.year, period.month)}</span>
              <button type="button" className={purchaseButton} onClick={() => setPeriod((current) => purchaseShiftMonth(current.year, current.month, 1))}
                disabled={lastMonth} aria-label="Następny miesiąc">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {(period.year !== now.year || period.month !== now.month) && (
              <button type="button" className={purchaseButton} onClick={() => setPeriod(now)}>Bieżący miesiąc</button>
            )}
            <span className="text-sm text-[#e5e4e2]/60">Razem: {purchaseTotalsText(purchaseTotals(month.documents))}</span>
          </div>

          {month.pending_months.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
              <AlertTriangle className="h-4 w-4" />Nierozliczone miesiące:
              {month.pending_months.map((pending) => (
                <button key={`${pending.year}-${pending.month}-${pending.company_id}`} type="button" className="underline decoration-dotted hover:text-amber-50"
                  onClick={() => setPeriod({ year: pending.year, month: pending.month })}>
                  {purchaseMonthLabel(pending.year, pending.month)} ({pending.count} dok.{pending.status === 'returned' ? ', do poprawy' : ''})
                </button>
              ))}
            </div>
          )}

          <PurchaseMonthView month={month} futureMonth={futureMonth} onOpenFile={(document) => void openFile(document)}
            onEdit={(document) => setEditing(document)} onDelete={(document) => void remove(document)}
            onSubmit={(company) => { setSubmitNote(''); setSubmitting(company); }} />
        </>
      )}

      {tab === 'review' && (
        rows === null ? (
          <p className="text-sm text-[#e5e4e2]/60">Wczytywanie rozliczeń…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-[#1c1f33] p-10 text-center text-sm text-[#e5e4e2]/60">
            Brak zakupów pracowników do rozliczenia.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33]">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#e5e4e2]/50">
                <tr>
                  <th className="px-4 py-3 font-normal">Pracownik</th>
                  <th className="px-4 py-3 font-normal">Miesiąc</th>
                  <th className="px-4 py-3 font-normal">Działalność</th>
                  <th className="px-4 py-3 font-normal">Stan</th>
                  <th className="px-4 py-3 text-right font-normal">Dokumenty</th>
                  <th className="px-4 py-3 text-right font-normal">Suma (przy wysłaniu)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.employee_id}-${row.company_id}-${row.year}-${row.month}`} className="cursor-pointer border-t border-white/5 hover:bg-white/5"
                    onClick={() => void openReview(row.employee_id, row.year, row.month)}>
                    <td className="px-4 py-3 text-[#e5e4e2]">{row.employee_name || 'Pracownik'}</td>
                    <td className="px-4 py-3 text-[#e5e4e2]/80">{purchaseMonthLabel(row.year, row.month)}</td>
                    <td className="px-4 py-3 text-[#e5e4e2]/80">{row.company_name}</td>
                    <td className="px-4 py-3">
                      <PurchaseStatusBadge status={row.status} />
                      {row.submitted_at && row.status === 'submitted' && <p className="mt-1 text-xs text-[#e5e4e2]/50">wysłane {purchaseDay(row.submitted_at)}</p>}
                    </td>
                    <td className="px-4 py-3 text-right text-[#e5e4e2]/80">{row.documents}</td>
                    <td className="px-4 py-3 text-right text-[#e5e4e2]">{row.totals ? purchaseTotalsText(row.totals) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {editing && state && (
        <PurchaseFormModal
          companies={recordCompanies}
          defaultCompany={editing !== 'new' ? editing.company_id : recordCompanies[0]?.id || ''}
          document={editing === 'new' ? null : editing}
          categories={state.categories}
          onClose={() => setEditing(null)}
          onSaved={(document) => {
            setEditing(null);
            const [year, monthNumber] = document.date.split('-').map(Number);
            if (year !== period.year || monthNumber !== period.month) {
              showSnackbar(`Zakup ma datę ${purchaseDay(document.date)} — jest w miesiącu ${purchaseMonthLabel(year, monthNumber)}.`, 'info');
              setPeriod({ year, month: monthNumber });
            } else {
              void load();
            }
          }}
        />
      )}

      {submitting && (
        <PurchaseModal title="Wyślij rozliczenie" subtitle={`${submitting.name} · ${purchaseMonthLabel(period.year, period.month)}`} onClose={() => setSubmitting(null)}
          footer={(
            <>
              <button type="button" className={purchaseButton} onClick={() => setSubmitting(null)}>Anuluj</button>
              <button type="button" className={purchasePrimaryButton} onClick={() => void submit()} disabled={Boolean(busy)}>Wyślij do zatwierdzenia</button>
            </>
          )}>
          <div className="space-y-3 text-sm text-[#e5e4e2]/80">
            <p>{submitDocuments.length} dok. · razem {purchaseTotalsText(purchaseTotals(submitDocuments))}.</p>
            <p>Po wysłaniu dokumentów z tego miesiąca nie da się zmieniać, dopóki osoba z finansów nie zatwierdzi albo nie zwróci rozliczenia.</p>
            <PurchaseField label="Uwaga dla finansów (opcjonalnie)">
              <textarea className={`${purchaseInput} min-h-[80px]`} maxLength={2000} value={submitNote} onChange={(event) => setSubmitNote(event.target.value)} />
            </PurchaseField>
          </div>
        </PurchaseModal>
      )}

      {reviewing && (
        <PurchaseModal wide title={`Zakupy — ${reviewing.employee.name}`} subtitle={purchaseMonthLabel(reviewing.year, reviewing.month)} onClose={() => setReviewing(null)}>
          <PurchaseMonthView month={reviewing} futureMonth={false} onOpenFile={(document) => void openFile(document)}
            onDecide={(company, approve) => { setDecisionNote(''); setDecision({ month: reviewing, company, approve }); }} />
        </PurchaseModal>
      )}

      {decision && (
        <PurchaseModal title={decision.approve ? 'Zatwierdź rozliczenie' : decision.company.settlement?.status === 'approved' ? 'Cofnij zatwierdzenie' : 'Zwróć do poprawy'}
          subtitle={`${decision.month.employee.name} · ${decision.company.name} · ${purchaseMonthLabel(decision.month.year, decision.month.month)}`}
          onClose={() => setDecision(null)}
          footer={(
            <>
              <button type="button" className={purchaseButton} onClick={() => setDecision(null)}>Anuluj</button>
              <button type="button" className={purchasePrimaryButton} onClick={() => void decide()} disabled={Boolean(busy)}>
                {decision.approve ? 'Zatwierdź' : 'Zwróć pracownikowi'}
              </button>
            </>
          )}>
          <div className="space-y-3 text-sm text-[#e5e4e2]/80">
            <p>{decision.approve
              ? 'Koszty eventów z tych zakupów zostaną oznaczone jako zatwierdzone. Pracownik dostanie powiadomienie.'
              : 'Pracownik dostanie powiadomienie z uwagą i będzie mógł poprawić dokumenty, a potem wysłać rozliczenie ponownie.'}</p>
            <PurchaseField label={decision.approve ? 'Uwaga (opcjonalnie)' : 'Co trzeba poprawić'}>
              <textarea className={`${purchaseInput} min-h-[90px]`} maxLength={2000} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
            </PurchaseField>
          </div>
        </PurchaseModal>
      )}

      <FullScreenLoader show={Boolean(busy)} title={busy || ''} description="Proszę poczekać..." />
    </div>
  );
}

export default function PurchasesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0d1a] p-6 text-sm text-[#e5e4e2]/60">Wczytywanie zakupów…</div>}>
      <PurchasesScreen />
    </Suspense>
  );
}
