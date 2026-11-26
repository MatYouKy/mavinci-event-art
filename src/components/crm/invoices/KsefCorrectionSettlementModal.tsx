'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Info, Link2, Loader2, RotateCcw, Scale, Search, Sparkles, Unlink, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import BankTransactionDetailsModal from '@/components/crm/BankTransactionDetailsModal';
import {
  isCorrectionKind,
  linkKsefCorrectionTransaction,
  loadKsefCorrectionSettlement,
  offsetKsefCorrection,
  undoKsefCorrectionOffset,
  unlinkKsefCorrectionTransaction,
  type CorrectionDocument,
  type CorrectionTransaction,
  type KsefCorrectionSettlement,
} from '@/lib/invoices/ksefCorrectionSettlement';

const input = 'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';
const primary = 'inline-flex items-center justify-center gap-1 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:opacity-50';

const money = (value: number, currency = 'PLN') =>
  `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const date = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');
const sign = (direction: 'credit' | 'debit') => (direction === 'credit' ? '+' : '−');
const plain = (value: number) => value.toFixed(2).replace('.', ',');
const parseAmount = (value: string) => {
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pl-PL');
const todayLocal = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());

const KIND_LABELS: Record<string, string> = {
  KOR: 'Faktura korygująca',
  KOR_ZAL: 'Korekta faktury zaliczkowej',
  KOR_ROZ: 'Korekta faktury rozliczeniowej',
};

/** Stan rozliczenia dokumentu po polsku (korekta „in minus” — „rozliczona”, faktura — „opłacona”). */
function statusOf(doc: CorrectionDocument): { label: string; tone: string } {
  const settled = doc.paymentStatus === 'paid' || doc.open <= 0.009;
  if (doc.gross < 0) {
    if (settled) return { label: 'Korekta rozliczona', tone: 'text-green-400 bg-green-400/10' };
    if (doc.paid > 0.009) return { label: `Częściowo rozliczona (${money(doc.paid, doc.currency)} / ${money(doc.due, doc.currency)})`, tone: 'text-yellow-400 bg-yellow-400/10' };
    return { label: 'Korekta do rozliczenia', tone: 'text-orange-400 bg-orange-400/10' };
  }
  if (doc.paymentStatus === 'paid') {
    const noLedger = doc.bankLinked <= 0.009 && doc.paid <= 0.009;
    return { label: noLedger ? 'Opłacona (oznaczenie bez operacji z wyciągu)' : 'Opłacona', tone: 'text-green-400 bg-green-400/10' };
  }
  if (doc.paid > 0.009) return { label: `Częściowo opłacona (${money(doc.paid, doc.currency)} / ${money(doc.due, doc.currency)})`, tone: 'text-yellow-400 bg-yellow-400/10' };
  if (doc.paymentStatus === 'overdue') return { label: 'Płatność po terminie', tone: 'text-red-400 bg-red-400/10' };
  return { label: 'Nieopłacona', tone: 'text-orange-400 bg-orange-400/10' };
}

/**
 * Okno „Rozlicz korektę / zwrot” (zakładka KSeF): korekta „in minus” i faktura korygowana z jej XML — powiązanie płatności
 * faktury korygowanej i zwrotu korekty z operacjami z wyciągu (obie strony rozliczone, bez pary „płatność + zwrot”) albo
 * kompensata, gdy faktura korygowana nie była jeszcze opłacona. Logika: `src/lib/invoices/ksefCorrectionSettlement.ts`
 * (to samo na Macu przez `/bridge/native/v1/finance`, op=ksefCorrection…).
 */
export default function KsefCorrectionSettlementModal({ invoiceId, canManage, employeeId, onClose, onChanged }: {
  invoiceId: string;
  canManage: boolean;
  employeeId: string | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [settlement, setSettlement] = useState<KsefCorrectionSettlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [searches, setSearches] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [offsetAmounts, setOffsetAmounts] = useState<Record<string, string>>({});
  const [offsetDates, setOffsetDates] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<{ id: string; statement_id: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await loadKsefCorrectionSettlement(supabase, invoiceId);
      setSettlement(next);
      setLoadError(null);
    } catch (error) {
      setLoadError((error as { message?: string })?.message || 'Nie udało się wczytać rozliczenia korekty.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(async (pending: string, action: () => Promise<string>) => {
    setBusy(pending);
    try {
      const message = await action();
      showSnackbar(message, 'success');
      await load();
      await onChanged();
    } catch (error) {
      showSnackbar((error as { message?: string })?.message || 'Operacja nie powiodła się.', 'error');
    } finally {
      setBusy(null);
    }
  }, [load, onChanged, showSnackbar]);

  const link = (doc: CorrectionDocument, tx: CorrectionTransaction) => {
    if (!settlement) return;
    void run('Powiązywanie operacji z wyciągu…', async () => {
      const result = await linkKsefCorrectionTransaction(supabase, {
        correctionId: settlement.correction.id, documentId: doc.id, transactionId: tx.id, amount: tx.linkAmount,
      });
      return `Operacja z wyciągu powiązana z fakturą ${result.number}.`;
    });
  };

  const unlink = async (doc: CorrectionDocument, tx: CorrectionTransaction) => {
    if (!settlement || !tx.matchId) return;
    const confirmed = await showConfirm({
      title: 'Odpiąć operację?',
      message: `Operacja ${date(tx.date)} ${sign(tx.direction)}${money(tx.amount, tx.currency)} przestanie rozliczać fakturę ${doc.number || doc.ksefNumber}. Automat nie przypisze jej ponownie do tej faktury.`,
      confirmText: 'Odepnij',
    });
    if (!confirmed) return;
    const matchId = tx.matchId;
    void run('Cofanie powiązania…', async () => {
      await unlinkKsefCorrectionTransaction(supabase, { correctionId: settlement.correction.id, transactionId: tx.id, matchId });
      return 'Powiązanie cofnięte. Ta operacja nie zostanie ponownie przypisana automatycznie do tej faktury.';
    });
  };

  const offset = (original: CorrectionDocument) => {
    if (!settlement || !original.offset) return;
    const amount = offsetAmounts[original.id] !== undefined ? parseAmount(offsetAmounts[original.id]) : original.offset.available;
    const day = offsetDates[original.id] || todayLocal();
    if (amount <= 0) {
      showSnackbar('Kwota kompensaty musi być większa od zera.', 'warning');
      return;
    }
    if (amount > original.offset.available + 0.005) {
      showSnackbar(`Kwota kompensaty nie może przekroczyć ${money(original.offset.available, original.currency)}.`, 'warning');
      return;
    }
    void run('Zapisywanie kompensaty…', async () => {
      const result = await offsetKsefCorrection(supabase, {
        correctionId: settlement.correction.id, originalId: original.id, amount, date: day, employeeId,
      });
      return `Korekta ${result.correction} rozliczona kompensatą z fakturą ${result.original}.`;
    });
  };

  const undoOffset = async (original: CorrectionDocument) => {
    if (!settlement) return;
    const confirmed = await showConfirm({
      title: 'Cofnąć kompensatę?',
      message: `Wpłaty kompensaty zostaną usunięte z rejestru korekty ${settlement.correction.number || settlement.correction.ksefNumber} i faktury ${original.number || original.ksefNumber}.`,
      confirmText: 'Cofnij kompensatę',
    });
    if (!confirmed) return;
    void run('Cofanie kompensaty…', async () => {
      await undoKsefCorrectionOffset(supabase, { correctionId: settlement.correction.id, originalId: original.id });
      return 'Kompensata cofnięta — wpłaty usunięte z rejestru obu faktur.';
    });
  };

  const visibleCandidates = (doc: CorrectionDocument) => {
    const query = fold((searches[doc.id] || '').trim());
    if (query) {
      return doc.candidates.filter((tx) => fold([
        tx.party, tx.title, date(tx.date), plain(tx.amount), tx.amount.toFixed(2),
      ].filter(Boolean).join(' ')).includes(query)).slice(0, 50);
    }
    if (showAll[doc.id]) return doc.candidates.slice(0, 100);
    return doc.candidates.filter((tx) => tx.score >= 3).slice(0, 10);
  };

  const correction = settlement?.correction ?? null;
  const missing = useMemo(() => (settlement?.references || []).filter((reference) => !reference.documentId), [settlement]);
  const status = correction ? statusOf(correction) : null;

  const transactionRow = (doc: CorrectionDocument, tx: CorrectionTransaction, linked: boolean, best = false) => (
    <li key={`${linked ? 'm' : 'c'}-${tx.id}`} className={`rounded-lg px-3 py-2 text-xs ${linked ? 'bg-green-500/[0.06] ring-1 ring-green-500/20' : 'bg-[#0f1119]'}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-20 shrink-0 text-[11px] text-[#e5e4e2]/55">{date(tx.date)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[#e5e4e2]">
            {best && <Sparkles className="h-3.5 w-3.5 text-[#d3bb73]" />}
            <span className="truncate font-medium">{tx.party || 'Bez nazwy'}</span>
          </div>
          {tx.title && tx.title !== tx.party && (
            <div className="mt-0.5 break-words text-[11px] text-[#e5e4e2]/40 [overflow-wrap:anywhere]">{tx.title}</div>
          )}
          {(tx.reasons.length > 0 || (!linked && tx.remaining < tx.amount - 0.009)) && (
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
              {!linked && tx.remaining < tx.amount - 0.009 && (
                <span className="rounded bg-[#1c1f33] px-1.5 py-px text-[#e5e4e2]/55">do rozliczenia {money(tx.remaining, tx.currency)}</span>
              )}
              {tx.reasons.map((reason) => (
                <span key={reason} className={`rounded px-1.5 py-px ${reason.startsWith('Ma już') ? 'bg-amber-500/10 text-amber-200' : 'bg-green-500/10 text-green-300'}`}>{reason}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`text-sm font-medium ${tx.direction === 'credit' ? 'text-green-400' : 'text-[#e5e4e2]'}`}>
            {sign(tx.direction)}{money(tx.amount, tx.currency)}
          </span>
          {linked && tx.linkedAmount !== null && tx.linkedAmount < tx.amount - 0.009 && (
            <span className="text-[10px] text-[#e5e4e2]/50">z tego dla faktury {money(tx.linkedAmount, tx.currency)}</span>
          )}
          <button type="button" onClick={() => setDetails({ id: tx.id, statement_id: tx.statementId })}
            className="inline-flex items-center gap-1 text-[10px] text-[#e5e4e2]/45 hover:text-[#d3bb73]">
            <Info className="h-3 w-3" /> Szczegóły płatności
          </button>
          {canManage && linked && (
            <button type="button" disabled={Boolean(busy)} onClick={() => void unlink(doc, tx)} className={ghost}>
              <Unlink className="h-3.5 w-3.5" /> Odepnij
            </button>
          )}
          {canManage && !linked && (
            <button type="button" disabled={Boolean(busy)} onClick={() => link(doc, tx)} className={primary}>
              <Link2 className="h-3.5 w-3.5" /> Powiąż {money(tx.linkAmount, tx.currency)}
            </button>
          )}
        </div>
      </div>
    </li>
  );

  const bankSection = (doc: CorrectionDocument, title: string, candidatesTitle: string) => {
    const candidates = visibleCandidates(doc);
    const query = (searches[doc.id] || '').trim();
    const strong = doc.candidates.filter((tx) => tx.score >= 3).length;
    return (
      <div className="mt-3 space-y-2">
        <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/45">{title}</div>
        {doc.transactions.length > 0 ? (
          <ul className="space-y-1.5">{doc.transactions.map((tx) => transactionRow(doc, tx, true))}</ul>
        ) : (
          <p className="text-xs text-[#e5e4e2]/45">Brak powiązanej operacji z wyciągu.</p>
        )}
        {doc.linkBlocked && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {doc.linkBlocked}
          </p>
        )}
        {!doc.linkBlocked && doc.bankOpen > 0.009 && (
          <div className="space-y-2 rounded-lg border border-[#d3bb73]/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-[#e5e4e2]/70">{candidatesTitle} · do powiązania {money(doc.bankOpen, doc.currency)}</span>
              {!query && doc.candidates.length > strong && (
                <button type="button" className="text-[11px] text-[#d3bb73] hover:underline"
                  onClick={() => setShowAll((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }))}>
                  {showAll[doc.id] ? 'Pokaż najlepiej pasujące' : `Pokaż wszystkie z okresu (${doc.candidates.length})`}
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" />
              <input value={searches[doc.id] || ''} onChange={(event) => setSearches((prev) => ({ ...prev, [doc.id]: event.target.value }))}
                placeholder="Szukaj: kontrahent, opis, kwota, data" className={`${input} pl-9`} />
            </div>
            {candidates.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-[#e5e4e2]/45">
                {query
                  ? 'Brak operacji pasujących do wyszukiwania.'
                  : doc.candidates.length
                    ? 'Brak operacji z pasującą kwotą, numerem albo kontrahentem — pokaż wszystkie z okresu albo wyszukaj.'
                    : 'Brak nierozliczonych operacji w tym kierunku z okresu faktury. Zaimportuj wyciąg z miesiąca płatności.'}
              </p>
            ) : (
              <ul className="space-y-1.5">{candidates.map((tx, index) => transactionRow(doc, tx, false, !query && index === 0 && tx.score >= 7))}</ul>
            )}
          </div>
        )}
      </div>
    );
  };

  const offsetSection = (original: CorrectionDocument) => {
    const state = original.offset;
    if (!state || !correction) return null;
    if (state.amount <= 0.009 && state.available <= 0.009 && !state.blocked) return null;
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-[#d3bb73]/10 p-3">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#e5e4e2]/45"><Scale className="h-3.5 w-3.5" /> Kompensata</div>
        {state.amount > 0.009 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#e5e4e2]/80">
            <span>Rozliczono kompensatą {money(state.amount, original.currency)}{state.date ? ` · ${date(state.date)}` : ''}</span>
            {canManage && (
              <button type="button" disabled={Boolean(busy)} onClick={() => void undoOffset(original)} className={ghost}>
                <RotateCcw className="h-3.5 w-3.5" /> Cofnij kompensatę
              </button>
            )}
          </div>
        )}
        {state.available > 0.009 ? (
          <>
            <p className="text-[11px] leading-5 text-[#e5e4e2]/55">
              Faktura korygowana nie jest jeszcze opłacona — korekta pomniejsza kwotę do zapłaty. Kompensata zapisze wpłatę
              w rejestrze obu faktur (bez operacji z wyciągu); resztę faktury korygowanej opłacisz jak zwykle.
            </p>
            {canManage && (
              <div className="grid gap-2 sm:grid-cols-[150px_160px_auto] sm:items-end">
                <label className="text-[11px] text-[#e5e4e2]/60">Kwota
                  <input className={`${input} mt-1`} inputMode="decimal"
                    value={offsetAmounts[original.id] ?? plain(state.available)}
                    onChange={(event) => setOffsetAmounts((prev) => ({ ...prev, [original.id]: event.target.value }))} />
                </label>
                <label className="text-[11px] text-[#e5e4e2]/60">Data
                  <input type="date" className={`${input} mt-1`} value={offsetDates[original.id] || todayLocal()}
                    onChange={(event) => setOffsetDates((prev) => ({ ...prev, [original.id]: event.target.value }))} />
                </label>
                <button type="button" disabled={Boolean(busy)} onClick={() => offset(original)} className={primary}>
                  <Scale className="h-3.5 w-3.5" /> Rozlicz kompensatą
                </button>
              </div>
            )}
          </>
        ) : state.blocked ? (
          <p className="text-[11px] text-[#e5e4e2]/50">{state.blocked}</p>
        ) : null}
      </div>
    );
  };

  const documentHeader = (doc: CorrectionDocument, label: string) => {
    const docStatus = statusOf(doc);
    return (
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[#e5e4e2]/45">{label}</div>
          <div className="mt-0.5 text-sm font-medium text-[#e5e4e2]">{doc.number || 'bez numeru'}</div>
          <div className="text-[11px] text-[#e5e4e2]/45">{doc.ksefNumber} · wystawiona {date(doc.issueDate)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-sm font-medium text-[#e5e4e2]">{money(doc.gross, doc.currency)}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${docStatus.tone}`}>{docStatus.label}</span>
        </div>
      </div>
    );
  };

  const refundWord = correction?.direction === 'credit' ? 'Wpływy' : 'Wypłaty';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
        <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="inline-flex items-center gap-2 text-base font-light text-[#e5e4e2]">
              <RotateCcw className="h-4 w-4 text-[#d3bb73]" /> Rozliczenie korekty {correction ? correction.number || correction.ksefNumber : ''}
            </h4>
            <button type="button" onClick={onClose} aria-label="Zamknij" className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
          </div>
          {correction && status && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#e5e4e2]/55">
              <span>{correction.party || 'Bez kontrahenta'}</span>
              <span>· {KIND_LABELS[String(settlement?.kind || '').toUpperCase()] || 'Faktura'} {money(correction.gross, correction.currency)}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] ${status.tone}`}>{status.label}</span>
            </div>
          )}

          <div className="mt-3 flex-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wczytywanie…</div>
            ) : loadError || !settlement || !correction ? (
              <p className="py-8 text-center text-sm text-red-300">{loadError || 'Nie udało się wczytać rozliczenia korekty.'}</p>
            ) : (
              <div className="space-y-3">
                <p className="rounded-lg bg-[#0f1119] px-3 py-2 text-[11px] leading-5 text-[#e5e4e2]/60">
                  Korekta „in minus” rozlicza się zwrotem albo kompensatą. Powiąż płatność faktury korygowanej i zwrot z wyciągu —
                  obie operacje i obie faktury będą rozliczone. Gdy faktura korygowana nie była jeszcze opłacona, rozlicz korektę
                  kompensatą: zapłacisz tylko różnicę.
                </p>
                {correction.open <= 0.009 && correction.gross < 0 && (
                  <p className="flex items-center gap-1.5 rounded-lg bg-green-500/10 px-3 py-2 text-xs text-green-300">
                    <CheckCircle className="h-4 w-4" /> Korekta jest rozliczona.
                  </p>
                )}
                {!isCorrectionKind(settlement.kind) && settlement.references.length === 0 && (
                  <p className="rounded-lg bg-[#0f1119] px-3 py-2 text-[11px] text-[#e5e4e2]/55">
                    XML tej faktury nie wskazuje faktury korygowanej — możesz powiązać zwrot z wyciągu poniżej.
                  </p>
                )}
                {missing.map((reference) => (
                  <p key={`${reference.number}-${reference.ksefNumber}`} className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Faktury korygowanej {reference.number || ''}{reference.ksefNumber ? ` (KSeF ${reference.ksefNumber})` : ''} nie ma w KSeF tej
                    działalności w CRM — zsynchronizuj KSeF za miesiąc jej wystawienia. Zwrot korekty możesz powiązać już teraz.
                  </p>
                ))}

                {settlement.originals.map((original) => (
                  <section key={original.id} className="rounded-xl border border-[#d3bb73]/15 bg-[#161a2c] p-4">
                    {documentHeader(original, 'Faktura korygowana')}
                    {bankSection(original, 'Płatność faktury z wyciągu', `${original.direction === 'credit' ? 'Wpływy' : 'Wypłaty'} pasujące do faktury`)}
                    {offsetSection(original)}
                  </section>
                ))}

                <section className="rounded-xl border border-[#d3bb73]/15 bg-[#161a2c] p-4">
                  {documentHeader(correction, correction.gross < 0 ? 'Korekta — zwrot' : 'Korekta')}
                  {bankSection(correction, correction.direction === 'credit' ? 'Zwrot na konto z wyciągu' : 'Zwrot dla kontrahenta z wyciągu', `${refundWord} pasujące do zwrotu`)}
                  {correction.payments.some((payment) => !payment.fromBank && !payment.offset) && (
                    <p className="mt-2 text-[11px] text-[#e5e4e2]/45">
                      Wpłaty ręczne w rejestrze korekty: {correction.payments.filter((payment) => !payment.fromBank && !payment.offset)
                        .map((payment) => `${date(payment.date)} ${money(payment.amount, correction.currency)}`).join(', ')} (zmienisz je w „Edytuj płatność”).
                    </p>
                  )}
                </section>
                {!canManage && (
                  <p className="text-center text-[11px] text-[#e5e4e2]/45">Zmiany rozliczeń wymagają „Zarządzania finansami” w tej działalności.</p>
                )}
              </div>
            )}
          </div>
          <div className="mt-3 flex justify-end border-t border-[#d3bb73]/10 pt-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#e5e4e2]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/70 hover:bg-white/5">Zamknij</button>
          </div>
        </div>
      </div>
      <FullScreenLoader show={Boolean(busy)} title={busy || ''} description="Proszę poczekać..." />
      {details && settlement && (
        <BankTransactionDetailsModal
          transaction={{ id: details.id, company_id: settlement.companyId, statement_id: details.statement_id }}
          onClose={() => setDetails(null)}
        />
      )}
    </>
  );
}
