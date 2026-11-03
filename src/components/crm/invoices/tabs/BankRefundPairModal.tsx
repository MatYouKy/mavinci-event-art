'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Info, Link2, Loader2, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import BankTransactionDetailsModal from '@/components/crm/BankTransactionDetailsModal';
import {
  directionSign,
  refundCounterpartLabel,
  type RefundCandidate,
  type RefundCandidatesResult,
} from '@/lib/invoices/bankReconciliation';

const input = 'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-2.5 py-2 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-[#d3bb73]/25 px-2.5 py-1 text-[11px] text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';

const money = (value: number | string | null | undefined, currency = 'PLN') =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const date = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');
const text = (value?: string | null) => repairBrokenBankText(value).replace(/[˙]+/g, ' ').replace(/\s+/g, ' ').trim();
const num = (value: string) => {
  const parsed = Number(String(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface RefundPairTransaction {
  id: string;
  statement_id: string;
  date: string;
  amount: number;
  remaining: number;
  direction: 'credit' | 'debit';
  currency: string;
  counterparty: string;
  title: string;
}

/**
 * Okno „Powiąż ze zwrotem”: wybór drugiej operacji pary „płatność + zwrot” (bez faktury) — z tej samej działalności,
 * przeciwnego kierunku, ±90 dni, z pozostałą kwotą. Na górze najlepiej pasujące (ta sama kwota, wspólne słowo w opisie
 * albo rachunek, bliska data). Kwotę pary można zmniejszyć przy zwrocie częściowym — reszta płatności czeka na fakturę.
 */
export default function BankRefundPairModal({ companyId, transaction, onClose, onLinked }: {
  companyId: string;
  transaction: RefundPairTransaction;
  onClose: () => void;
  onLinked: () => void | Promise<void>;
}) {
  const { showSnackbar } = useSnackbar();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<RefundCandidatesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<{ id: string; statement_id: string } | null>(null);

  // Wyszukiwanie po stronie bazy (kontrahent, opis, kwota, data) — z krótkim opóźnieniem przy pisaniu.
  useEffect(() => {
    const handle = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc('get_bank_refund_candidates', {
        p_transaction_id: transaction.id, p_search: query || null,
      });
      if (cancelled) return;
      if (error) {
        showSnackbar(error.message || 'Nie udało się wczytać operacji do powiązania.', 'error');
        setResult(null);
      } else {
        setResult(data as RefundCandidatesResult);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [transaction.id, query, showSnackbar]);

  const candidates = result?.candidates || [];
  const best = candidates.find((c) => c.same_amount && (c.words.length > 0 || c.same_account) && !c.blocked) || null;
  const selected = candidates.find((c) => c.id === selectedId) || null;
  const ownRemaining = Number(result?.transaction.remaining ?? transaction.remaining);

  const choose = useCallback((candidate: RefundCandidate) => {
    setSelectedId(candidate.id);
    setAmount(String(Math.round(Number(candidate.suggested_amount) * 100) / 100));
  }, []);

  useEffect(() => {
    if (!selectedId && best) choose(best);
  }, [best, selectedId, choose]);

  const link = async (candidate: RefundCandidate) => {
    const value = amount.trim() === '' ? null : num(amount);
    if (value !== null && value <= 0) {
      showSnackbar('Kwota pary musi być większa od zera.', 'warning');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('link_bank_refund_pair', {
      p_transaction_id: transaction.id, p_other_transaction_id: candidate.id, p_amount: value,
    });
    setBusy(false);
    if (error) {
      showSnackbar(error.message || 'Nie udało się powiązać operacji.', 'error');
      return;
    }
    showSnackbar('Płatność i zwrot powiązane — obie operacje są rozliczone bez faktury (dowodem jest wyciąg).', 'success');
    await onLinked();
  };

  // Podgląd skutku: która operacja jest płatnością, ile z niej zostanie do rozliczenia fakturą.
  const preview = (candidate: RefundCandidate) => {
    const value = amount.trim() === '' ? Number(candidate.suggested_amount) : num(amount);
    const ownIsPayment = candidate.role === 'refund';
    const paymentLeft = Math.max((ownIsPayment ? ownRemaining : Number(candidate.remaining)) - value, 0);
    const refundLeft = Math.max((ownIsPayment ? Number(candidate.remaining) : ownRemaining) - value, 0);
    const tooMuch = value > Math.min(ownRemaining, Number(candidate.remaining)) + 0.009;
    return { value, paymentLeft, refundLeft, tooMuch };
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
        <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="inline-flex items-center gap-2 text-base font-light text-[#e5e4e2]">
              <RotateCcw className="h-4 w-4 text-[#d3bb73]" /> Powiąż ze zwrotem
            </h4>
            <button type="button" onClick={onClose} aria-label="Zamknij" className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
          </div>
          <p className="mt-1 text-xs text-[#e5e4e2]/55">
            {date(transaction.date)} · {transaction.direction === 'credit' ? 'wpływ' : 'wydatek'} {directionSign(transaction.direction)}{money(transaction.amount, transaction.currency)}
            {ownRemaining < Number(transaction.amount) - 0.009 ? ` (do rozliczenia ${money(ownRemaining, transaction.currency)})` : ''}
            {' · '}{text(result?.transaction.counterparty) || text(transaction.counterparty) || 'bez nazwy'}
          </p>
          <p className="break-words text-xs text-[#e5e4e2]/40 [overflow-wrap:anywhere]">{text(transaction.title)}</p>
          <p className="mt-2 rounded-lg bg-[#0f1119] px-3 py-2 text-[11px] leading-5 text-[#e5e4e2]/60">
            Gdy sklep lub kontrahent zwrócił pieniądze (albo my zwróciliśmy klientowi) i nie ma faktury, wybierz drugą operację.
            Obie zostaną rozliczone parą „płatność + zwrot” — dowodem jest wyciąg. Przy zwrocie częściowym wpisz kwotę zwrotu:
            reszta płatności nadal będzie czekać na fakturę.
          </p>

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/35" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Szukaj: sklep, kontrahent, opis, kwota, data"
              className={`${input} pl-9`} />
          </div>

          <div className="mt-3 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-[#e5e4e2]/50"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wczytywanie…</div>
            ) : candidates.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#e5e4e2]/50">
                {query
                  ? 'Brak operacji pasujących do wyszukiwania.'
                  : `Brak ${transaction.direction === 'credit' ? 'wydatków' : 'wpływów'} z tej działalności w ${transaction.currency || 'PLN'} w ciągu 90 dni, które nie są jeszcze w całości rozliczone.`}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {candidates.map((c) => {
                  const isSelected = c.id === selectedId;
                  const isBest = best?.id === c.id;
                  const effect = isSelected ? preview(c) : null;
                  return (
                    <li key={c.id} className={`rounded-lg px-3 py-2 text-xs ${isSelected ? 'bg-[#d3bb73]/[0.08] ring-1 ring-[#d3bb73]/40' : 'bg-[#0f1119]'}`}>
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="w-20 shrink-0 text-[11px] text-[#e5e4e2]/55">{date(c.date)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[#e5e4e2]">
                            {isBest && <Sparkles className="h-3.5 w-3.5 text-[#d3bb73]" />}
                            <span className="rounded bg-[#1c1f33] px-1.5 py-px text-[10px] text-[#e5e4e2]/60">{refundCounterpartLabel(c.role)}</span>
                            <span className="truncate font-medium">{text(c.counterparty) || 'Bez nazwy'}</span>
                          </div>
                          {c.title && text(c.title) !== text(c.counterparty) && (
                            <div className="mt-0.5 break-words text-[11px] text-[#e5e4e2]/40 [overflow-wrap:anywhere]">{text(c.title)}</div>
                          )}
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                            {c.reasons.map((reason) => (
                              <span key={reason} className={`rounded px-1.5 py-px ${c.blocked && reason.startsWith('Ta para') ? 'bg-amber-500/10 text-amber-200'
                                : /^(Ta sama kwota|Wspólne|Ten sam rachunek)/.test(reason) ? 'bg-green-500/10 text-green-300' : 'bg-[#1c1f33] text-[#e5e4e2]/55'}`}>{reason}</span>
                            ))}
                            {isBest && <span className="text-[#d3bb73]">najlepiej pasuje</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className={`text-sm font-medium ${c.direction === 'credit' ? 'text-green-400' : 'text-[#e5e4e2]'}`}>
                            {directionSign(c.direction)}{money(c.amount, c.currency)}
                          </span>
                          <button type="button" onClick={() => setDetails({ id: c.id, statement_id: c.statement_id })}
                            className="inline-flex items-center gap-1 text-[10px] text-[#e5e4e2]/45 hover:text-[#d3bb73]">
                            <Info className="h-3 w-3" /> Szczegóły płatności
                          </button>
                          {!isSelected && (
                            <button type="button" onClick={() => choose(c)} className={ghost}><Check className="h-3.5 w-3.5" /> Wybierz</button>
                          )}
                        </div>
                      </div>
                      {isSelected && effect && (
                        <div className="mt-2 grid gap-2 border-t border-[#d3bb73]/10 pt-2 sm:grid-cols-[160px_1fr_auto] sm:items-end">
                          <label className="text-[11px] text-[#e5e4e2]/60">Kwota pary
                            <input className={`${input} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                          </label>
                          <p className={`text-[11px] leading-4 ${effect.tooMuch ? 'text-red-300' : 'text-[#e5e4e2]/55'}`}>
                            {effect.tooMuch
                              ? `Kwota pary nie może być większa niż ${money(Math.min(ownRemaining, Number(c.remaining)), c.currency)} (pozostało do rozliczenia po obu stronach).`
                              : effect.paymentLeft > 0.009
                                ? `Zwrot częściowy: z płatności zostanie ${money(effect.paymentLeft, c.currency)} do rozliczenia fakturą.`
                                : effect.refundLeft > 0.009
                                  ? `Ze zwrotu zostanie ${money(effect.refundLeft, c.currency)} — może dotyczyć innej płatności.`
                                  : 'Płatność i zwrot zostaną rozliczone w całości.'}
                          </p>
                          <button type="button" disabled={busy || effect.tooMuch} onClick={() => void link(c)}
                            className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#0a0d1a] hover:bg-[#e5d799] disabled:opacity-50">
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} Powiąż
                          </button>
                          {c.explained && (
                            <p className="flex items-start gap-1 text-[10px] text-amber-200/80 sm:col-span-3">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Ta operacja ma już wyjaśnienie bez faktury — po powiązaniu będzie rozliczona parą.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {result?.truncated && (
              <p className="mt-2 text-center text-[10px] text-[#e5e4e2]/40">Pokazano 100 najlepiej pasujących z {result.total} — zawęź wyszukiwanie.</p>
            )}
          </div>
          <div className="mt-3 flex justify-end border-t border-[#d3bb73]/10 pt-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#e5e4e2]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/70 hover:bg-white/5">Zamknij</button>
          </div>
        </div>
      </div>
      {details && (
        <BankTransactionDetailsModal
          transaction={{ id: details.id, company_id: companyId, statement_id: details.statement_id }}
          onClose={() => setDetails(null)}
        />
      )}
    </>
  );
}
