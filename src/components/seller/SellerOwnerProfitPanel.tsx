'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Calculator, Loader2, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { commissionPaymentLabels, commissionStatusLabels, formatCommissionMoney, getCommissionAmounts, roundCommissionMoney,
  type CommissionPaymentMethod, type CommissionStatus } from '@/lib/CRM/events/eventCommission';

type ProfitContext = {
  source_key: string; event_id: string | null; offer_status: string; manager_id: string | null; manager_name: string | null;
  owner_partner_id: string | null; company_id: string; revenue_net: number | null; client_net: number;
  commercial_model: string; external_cost: number; other_commissions_cost: number;
  external_cost_source: 'ledger' | 'estimated' | 'markup' | 'none'; rate: number | null;
  payment_method: CommissionPaymentMethod | null; dividend_tax_rate: number | null; employer_social_rate: number | null; issues: string[];
};
type ProfitReview = { id: string; costs_net: number; note: string; recorded_at: string; snapshot: ProfitContext & {
  base_amount: number; amount: number; company_cost: number; remaining_profit: number;
} };
type ProfitState = { context: ProfitContext; can_manage: boolean; review: ProfitReview | null; stale: boolean;
  history: { id: string; recorded_at: string; recorded_by: string; costs_net: number; note: string; base_amount: number; amount: number }[];
  commission: { id: string; status: CommissionStatus; amount: number; company_cost: number; review_id: string; employee_id: string; has_payouts: boolean } | null };

const field = 'mt-1.5 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30 disabled:opacity-60';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-40';
const parseCost = (input: string) => {
  const value = input.trim().replace(/\s/g, '').replace(',', '.');
  return /^\d+(?:\.\d{1,2})?$/.test(value) && Number(value) <= 999999999999.99 ? Number(value) : null;
};
const errorMessage = (error: unknown) => {
  const value = error as { code?: string; message?: string };
  if (['PGRST202', '42883', '42703'].includes(value?.code || '')) return 'Panel wymaga migracji 20260918120000_seller_owner_profit_commission.sql.';
  return value?.message || 'Nie udało się zapisać kalkulacji. Odśwież dane przed ponowieniem.';
};

/** Internal CRM only. The RPC independently enforces offer, brand and finance permissions. */
export default function SellerOwnerProfitPanel({ offerId, refreshKey = 0 }: { offerId: string; refreshKey?: number }) {
  const [data, setData] = useState<ProfitState | null>(null);
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const alive = useRef(true);
  const sequence = useRef(0);
  const operation = useRef(false);
  const dirtyRef = useRef(false);
  const { showSnackbar } = useSnackbar();
  const costValue = parseCost(cost);
  const dirty = data ? (costValue === null && cost.trim() !== '') || costValue !== (data.review ? Number(data.review.costs_net) : null) || note !== (data.review?.note || '') : false;
  dirtyRef.current = dirty || confirmed;

  const accept = useCallback((next: ProfitState) => {
    setData(next); setCost(next.review ? String(next.review.costs_net) : ''); setNote(next.review?.note || '');
    setConfirmed(false); setError(''); setForbidden(false);
  }, []);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const result = await supabase.rpc('get_seller_owner_profit', { p_offer: offerId });
      if (result.error) throw result.error;
      if (alive.current && request === sequence.current) accept(result.data as ProfitState);
    } catch (cause) {
      if (alive.current && request === sequence.current) {
        setForbidden((cause as { code?: string })?.code === '42501'); setError(errorMessage(cause)); setData(null);
      }
    } finally { if (alive.current && request === sequence.current) setLoading(false); }
  }, [offerId, accept]);
  useEffect(() => {
    alive.current = true;
    void load();
    const refresh = () => { if (!dirtyRef.current && !operation.current && document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('seller-workspace-changed', refresh);
    return () => { alive.current = false; ++sequence.current; window.removeEventListener('focus', refresh); window.removeEventListener('seller-workspace-changed', refresh); };
  }, [load]);
  useEffect(() => { if (refreshKey && !dirtyRef.current && !operation.current) void load(); }, [refreshKey, load]);

  const run = async (label: string, action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; ++sequence.current; setLoading(false); setBusy(label); setError('');
    try { await action(); }
    catch (cause) { if (alive.current) { const message = errorMessage(cause); setError(message); showSnackbar(message, 'error', 8000); } }
    finally { operation.current = false; if (alive.current) setBusy(''); }
  };
  const refresh = () => {
    if (dirtyRef.current && !window.confirm('Wczytać dane ponownie i porzucić niezapisaną kalkulację?')) return;
    void load();
  };

  if (forbidden) return <p className="rounded-lg bg-white/[0.03] p-3 text-xs text-white/50">Rentowność i prowizja opiekuna są dostępne pracownikom z uprawnieniami do finansów tej sprawy.</p>;
  const ctx = data?.context;
  const frozen = Boolean(data?.commission && (data.commission.status !== 'planned' || data.commission.has_payouts));
  const ready = Boolean(data?.can_manage && ctx && !ctx.issues.length && !frozen && !busy && !loading);
  const profit = ctx && costValue !== null ? roundCommissionMoney(Number(ctx.revenue_net || 0) - costValue - Number(ctx.external_cost) - Number(ctx.other_commissions_cost)) : null;
  const base = profit === null ? null : Math.max(0, profit);
  const amounts = ctx?.payment_method && base !== null && ctx.rate != null ? getCommissionAmounts({ calculationType: 'percent', baseAmount: base,
    rate: Number(ctx.rate), fixedAmount: 0, paymentMethod: ctx.payment_method, dividendTaxRate: Number(ctx.dividend_tax_rate ?? 19) }) : null;
  const ownerCost = amounts ? ctx?.payment_method === 'payroll'
    ? roundCommissionMoney(amounts.nominalAmount * (1 + Number(ctx.employer_social_rate || 0) / 100)) : amounts.companyCostAmount : null;
  const remaining = profit !== null && ownerCost !== null ? roundCommissionMoney(profit - ownerCost) : null;
  const savedAndCurrent = Boolean(data?.review && !data.stale && !dirty && !loading);
  const bookedCurrent = Boolean(savedAndCurrent && data?.commission?.review_id === data?.review?.id);

  return <section id="seller-owner-profit" aria-label="Wewnętrzna rentowność" aria-busy={Boolean(busy || loading)} className="scroll-mt-6 space-y-4 rounded-xl bg-white/[0.035] p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-sm uppercase"><Calculator className="h-4 w-4 text-[#d3bb73]"/>Rentowność i prowizja opiekuna</h3>
        <p className="mt-1 text-xs text-white/50">Tylko CRM · dane niewidoczne dla sprzedawcy i w PDF oferty.</p></div>
      <button type="button" className={button} disabled={Boolean(busy || loading)} onClick={refresh}><RefreshCw className="h-4 w-4"/>Odśwież</button>
    </div>
    {loading && <p role="status" className="flex items-center gap-2 text-xs text-white/50"><Loader2 className="h-4 w-4 animate-spin"/>Wczytywanie kalkulacji…</p>}
    {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    {ctx && data && <>
      <p className="text-xs leading-5 text-white/60">Opiekun prowadzący: <span className="text-[#d3bb73]">{ctx.manager_name || 'nieprzypisany'}</span>. Podstawa jego prowizji to przychód netto firmy pomniejszony o koszty realizacji i koszt pozostałych prowizji. Przy braku zysku prowizja procentowa wynosi 0 zł.</p>
      {ctx.issues.length > 0 && <ul className="space-y-2 rounded-lg bg-amber-300/10 p-3 text-xs text-amber-100">{ctx.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[#d3bb73]">
        <Link href={ctx.owner_partner_id ? `/crm/salespeople?seller=${ctx.owner_partner_id}` : '/crm/salespeople'} className="hover:underline">Warunki prowizji opiekuna dla marki</Link>
        {ctx.event_id && <Link href={`/crm/events/${ctx.event_id}?tab=finances`} className="hover:underline">Koszty i rozliczenia wydarzenia</Link>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/65">Koszty realizacji netto, bez prowizji (zł)
          <input inputMode="decimal" placeholder="np. 8000,00" value={cost} disabled={!data.can_manage || frozen || Boolean(busy || loading)}
            onChange={(event) => { setCost(event.target.value); setConfirmed(false); }} className={field}/></label>
        <div className="rounded-lg bg-black/15 p-3 text-xs leading-5 text-white/55">{ctx.rate == null ? 'Brak stawki opiekuna' : `${Number(ctx.rate).toLocaleString('pl-PL')}% od dodatniego zysku`}
          <p>{ctx.payment_method ? commissionPaymentLabels[ctx.payment_method] : 'Brak sposobu rozliczenia'}</p>
          {ctx.payment_method === 'payroll' && <p>Wyliczona kwota to brutto pracownika. Koszt firmy uwzględnia skonfigurowany narzut pracodawcy: {ctx.employer_social_rate}%.</p>}
          {ctx.payment_method === 'cash_dividend' && <p>Kwota do wypłaty jest oddzielona od kosztu firmy; stosujemy zapisany w warunkach model gotówkowy ({ctx.dividend_tax_rate}%).</p>}
        </div>
      </div>
      <p className="text-xs leading-5 text-white/45">Uwzględnij sprzęt, podwykonawców, transport, logistykę i pełny koszt pracy. Nie wpisuj tu prowizji — odejmujemy je osobno. Rejestr kosztów nie rozróżnia jeszcze jednoznacznie netto i brutto, dlatego podstawę potwierdzasz po sprawdzeniu dokumentów. Również koszt 0 zł wymaga potwierdzenia.</p>
      <label className="block text-xs text-white/65">Zakres i podstawa sprawdzonych kosztów
        <textarea rows={2} maxLength={2000} value={note} placeholder="Co uwzględniono, z jakich dokumentów lub kalkulacji i na jaki dzień…"
          disabled={!data.can_manage || frozen || Boolean(busy || loading)} onChange={(event) => { setNote(event.target.value); setConfirmed(false); }} className={field}/></label>
      <dl className="space-y-2 rounded-lg bg-black/15 p-4">
        {([
          ['Przychód firmy netto', ctx.revenue_net], ['Koszty realizacji netto', costValue],
          [`Koszt sprzedawcy zewnętrznego${ctx.external_cost_source === 'estimated' ? ' — szacunek' : ''}`, ctx.external_cost],
          ['Pozostałe prowizje — koszt firmy', ctx.other_commissions_cost], ['Podstawa prowizji opiekuna (zysk ≥ 0)', base],
          [ctx.payment_method === 'payroll' ? 'Prowizja opiekuna — brutto pracownika' : 'Prowizja opiekuna — kwota rozliczenia', amounts?.nominalAmount ?? null],
          ['Prowizja opiekuna — koszt firmy', ownerCost], ['Zostaje firmie po kosztach i prowizjach', remaining],
        ] as [string, number | null][]).map(([label, value], index) => <div key={label} className={`flex flex-wrap justify-between gap-2 ${index === 7 ? 'pt-3 font-medium text-[#d3bb73]' : 'text-white/65'}`}>
          <dt>{label}</dt><dd className="tabular-nums">{value == null ? '—' : formatCommissionMoney(value)}</dd>
        </div>)}
      </dl>
      {ctx.commercial_model === 'markup' && <p className="text-xs text-white/50">Przychodem firmy jest kwota bazowa MAVINCI. Narzut sprzedawcy nie jest doliczany do naszego przychodu ani ponownie odejmowany jako koszt.</p>}
      {remaining !== null && remaining < 0 && <p role="alert" className="rounded-lg bg-rose-300/10 p-3 text-rose-200">Po kosztach i wynagrodzeniach firma ponosi stratę. Sprawdź cenę i warunki przed decyzją o sprzedaży.</p>}
      {data.stale && <p role="alert" className="text-amber-200">Dane zmieniły się od ostatniej kalkulacji. Widoczne wyliczenie jest podglądem; poprzednia podstawa nie jest aktualna. Sprawdź koszty i zapisz nową wersję przed naliczeniem.</p>}
      {data.review && <p className="text-xs text-white/45">Ostatni zapis: {new Date(data.review.recorded_at).toLocaleString('pl-PL')}. Każdy zapis zachowuje poprzednią wersję i autora. Sam zapis kalkulacji nie jest naliczeniem ani wypłatą.</p>}
      {data.history?.length > 0 && <details className="rounded-lg bg-black/10 p-3 text-xs">
        <summary className="cursor-pointer text-white/60">Historia kalkulacji — ostatnie 10 zapisów</summary>
        <ol className="mt-3 max-h-80 space-y-3 overflow-y-auto">{data.history.map((entry) => <li key={entry.id} className="space-y-1 rounded-lg bg-white/[0.03] p-3">
          <p className="text-white/70">{new Date(entry.recorded_at).toLocaleString('pl-PL')} · {entry.recorded_by}</p>
          <p className="text-white/50">Koszty: {formatCommissionMoney(entry.costs_net)} · podstawa: {formatCommissionMoney(entry.base_amount)} · prowizja: {formatCommissionMoney(entry.amount)}</p>
          <p className="whitespace-pre-wrap text-white/50">{entry.note}</p>
        </li>)}</ol>
      </details>}
      {data.commission && <div className="rounded-lg bg-white/[0.035] p-3 text-xs leading-5">
        <p>Zapisana prowizja: {formatCommissionMoney(data.commission.amount)} · {commissionStatusLabels[data.commission.status]} · koszt firmy {formatCommissionMoney(data.commission.company_cost)}.</p>
        {!bookedCurrent && <p className="text-amber-200">Zapisane naliczenie różni się od bieżącej kalkulacji lub wymaga ponownego sprawdzenia.</p>}
        {frozen && <p className="text-white/60">Nie zmieniamy zatwierdzonej, wypłaconej ani anulowanej prowizji. Ewentualną korektę rozpatrz oddzielnie w rozliczeniach.</p>}
      </div>}
      {data.can_manage && !frozen && <>
        {ctx.event_id && ctx.external_cost_source === 'estimated' && <div className="space-y-2 text-xs text-white/60">
          <p>Przed naliczeniem opiekuna trzeba zapisać prowizję sprzedawcy zewnętrznego, a następnie ponownie sprawdzić kalkulację.</p>
          <button type="button" className={button} disabled={Boolean(busy || loading || dirty || confirmed)} onClick={() => void run('Uzupełnianie prowizji sprzedawcy', async () => {
            const response = await fetch('/bridge/events/commissions/automatic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: ctx.event_id }) });
            const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Nie udało się uzupełnić prowizji sprzedawcy.');
            showSnackbar(result.message || 'Sprawdź uzupełnione naliczenie sprzedawcy.', 'info', 6000); await load();
          })}>Uzupełnij prowizję sprzedawcy</button>
        </div>}
        <label className="flex items-start gap-2 text-xs leading-5 text-white/65"><input type="checkbox" checked={confirmed} disabled={!ready}
          onChange={(event) => setConfirmed(event.target.checked)} className="mt-1"/>Sprawdziłem koszty netto i ich kompletność. Kwota nie zawiera żadnych prowizji pokazanych osobno.</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={!ready || !confirmed || costValue === null || note.trim().length < 3} onClick={() => void run('Zapisywanie kalkulacji', async () => {
            const result = await supabase.rpc('save_seller_owner_profit_review', { p_offer: offerId, p_costs_net: costValue, p_note: note,
              p_expected_source: ctx.source_key, p_expected_review: data.review?.id || null });
            if (result.error) throw result.error;
            if (alive.current) { accept(result.data as ProfitState); showSnackbar('Kalkulacja zysku zapisana. Prowizja nie została jeszcze naliczona.', 'success', 5000); }
          })}><Save className="h-4 w-4"/>Zapisz sprawdzoną kalkulację</button>
          <button type="button" className={button} disabled={!ready || !savedAndCurrent || bookedCurrent || !ctx.event_id || ctx.offer_status !== 'accepted' || ctx.external_cost_source === 'estimated'}
            onClick={() => void run('Naliczanie prowizji od zysku', async () => {
              const result = await supabase.rpc('book_seller_owner_profit_commission', { p_review: data.review!.id });
              if (result.error) throw result.error;
              if (alive.current) { accept(result.data as ProfitState); showSnackbar('Prowizja opiekuna zapisana jako planowana. Wypłatę rozliczysz osobno.', 'success', 6000); }
            })}><ShieldCheck className="h-4 w-4"/>{bookedCurrent ? 'Prowizja naliczona' : data.commission ? 'Aktualizuj planowaną prowizję' : 'Nalicz prowizję od zysku'}</button>
        </div>
        {!ctx.event_id && <p className="text-xs text-white/45">Na etapie oferty zapisujesz kalkulację. Naliczanie jest dostępne po akceptacji oferty i utworzeniu wydarzenia.</p>}
      </>}
      {busy && <p role="status" className="flex items-center gap-2 text-[#d3bb73]"><Loader2 className="h-4 w-4 animate-spin"/>{busy}…</p>}
    </>}
  </section>;
}
