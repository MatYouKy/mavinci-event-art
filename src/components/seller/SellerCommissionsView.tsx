'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Loader2, RefreshCw } from 'lucide-react';
import type { CommissionSettlement, CommissionSettlementsResponse } from '@/lib/CRM/events/commissionSettlements';
import { sellerMoney } from '@/lib/seller/portal';
import { readSellerNotice, useSellerInbox } from '@/lib/seller/inbox';
import {
  SELLER_FORECAST_NOTE, sellerCommissionBasis, sellerCommissionDate, sellerCommissionPaymentLabels,
  sellerCommissionStatus, sellerCommissionToneClass,
} from '@/lib/seller/commissions';

type Filter = 'all' | 'payable' | 'forecast' | 'paid';
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Wszystkie' },
  { id: 'payable', label: 'Do wypłaty' },
  { id: 'forecast', label: 'Prognoza' },
  { id: 'paid', label: 'Wypłacone' },
];
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40';

/** Portal list of the seller's own commissions — cards readable on a phone. */
export default function SellerCommissionsView() {
  const [rows, setRows] = useState<CommissionSettlement[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [brand, setBrand] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/bridge/commissions/settlements?mode=seller', { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.commissions)) throw new Error(result.error || 'Nie udało się wczytać rozliczeń.');
      setRows((result as CommissionSettlementsResponse).commissions);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać rozliczeń.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const inbox = useSellerInbox();
  useEffect(() => {
    if (!rows || document.visibilityState !== 'visible') return;
    inbox.items.filter((item) => item.kind === 'notification' && item.action_url?.startsWith('/seller/commissions')).forEach((item) => void readSellerNotice(item));
  }, [rows, inbox.items]);

  const brands = useMemo(() => [...new Map((rows || []).filter((row) => row.my_company_id).map((row) => [row.my_company_id!, row.company_name || 'Marka MAVINCI'])).entries()], [rows]);
  const scoped = useMemo(() => (rows || []).filter((row) => !brand || row.my_company_id === brand), [rows, brand]);
  const summary = useMemo(() => {
    const active = scoped.filter((row) => row.status !== 'cancelled');
    const accruals = active.filter((row) => row.entry_kind !== 'deduction');
    return {
      payable: accruals.filter((row) => row.status === 'approved').reduce((sum, row) => sum + Number(row.remaining_amount || 0), 0)
        - active.filter((row) => row.entry_kind === 'deduction' && row.status === 'approved').reduce((sum, row) => sum + Number(row.to_offset ?? row.amount ?? 0), 0),
      forecast: accruals.filter((row) => row.status === 'planned' && !row.automatic_waiting_for_offer).reduce((sum, row) => sum + Number(row.amount || 0), 0),
      paid: accruals.reduce((sum, row) => sum + Number(row.paid_amount || 0) - Number(row.offset_amount || 0), 0),
    };
  }, [scoped]);
  const visible = useMemo(() => scoped.filter((row) => {
    const status = sellerCommissionStatus(row);
    if (filter === 'payable') return status.tone === 'payable' || status.tone === 'deduction';
    if (filter === 'forecast') return status.tone === 'forecast';
    if (filter === 'paid') return status.tone === 'paid' || Number(row.paid_amount) > 0;
    return true;
  }).sort((left, right) => String(right.event_date || right.created_at).localeCompare(String(left.event_date || left.created_at))), [scoped, filter]);

  return <section aria-labelledby="seller-commissions-list" className="space-y-4 text-[#e5e4e2]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="seller-commissions-list" className="text-base uppercase">Twoje rozliczenia</h2>
      <button type="button" onClick={() => void load()} disabled={loading} className={button}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież</button>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-300/10 p-4 text-sm text-rose-100"><p>{error} Kwoty nie są pokazywane jako zero.</p><button type="button" onClick={() => void load()} className={button}>Spróbuj ponownie</button></div>}
    {loading && !rows && <p role="status" className="flex items-center gap-2 py-8 text-sm text-white/55"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie rozliczeń…</p>}
    {rows && <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-[#1c1f33] p-4"><p className="text-xs text-white/50">Do wypłaty</p><p className="mt-2 text-xl font-light text-[#d3bb73]">{sellerMoney(Math.max(0, summary.payable))}</p><p className="mt-1 text-[11px] text-white/40">po zatwierdzeniu rozliczenia wydarzenia</p></div>
        <div className="rounded-xl bg-[#1c1f33] p-4"><p className="text-xs text-white/50">Prognoza</p><p className="mt-2 text-xl font-light">{sellerMoney(summary.forecast)}</p><p className="mt-1 text-[11px] text-white/40">{SELLER_FORECAST_NOTE}</p></div>
        <div className="rounded-xl bg-[#1c1f33] p-4"><p className="text-xs text-white/50">Wypłacono łącznie</p><p className="mt-2 text-xl font-light text-emerald-200">{sellerMoney(summary.paid)}</p><p className="mt-1 text-[11px] text-white/40">zarejestrowane wypłaty</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Filtr rozliczeń" className="flex flex-wrap gap-2">{filters.map((item) => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`min-h-10 rounded-lg px-3 py-2 text-sm ${filter === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/[0.04] text-white/60 hover:bg-white/[0.08]'}`}>{item.label}</button>)}</nav>
        {brands.length > 1 && <label className="ml-auto text-xs text-white/55"><span className="sr-only">Marka</span><select value={brand} onChange={(event) => setBrand(event.target.value)} className="min-h-10 rounded-lg bg-[#0f1119] px-3 text-sm"><option value="">Wszystkie marki</option>{brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      </div>
      {!visible.length && <p className="rounded-xl bg-white/[0.03] px-5 py-10 text-center text-sm text-white/50">{rows.length ? 'Brak rozliczeń w tym widoku.' : 'Nie masz jeszcze naliczeń. Pojawią się po zaakceptowaniu wydarzeń z Twoich ofert.'}</p>}
      <ul className="space-y-3">{visible.map((row) => {
        const status = sellerCommissionStatus(row);
        const basis = sellerCommissionBasis(row);
        const deduction = row.entry_kind === 'deduction';
        return <li key={row.id} className="rounded-xl bg-[#1c1f33] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{row.event_name || 'Wydarzenie'}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-white/50"><CalendarDays className="h-3.5 w-3.5" />{row.event_date ? sellerCommissionDate(row.event_date) : 'Termin do ustalenia'}{row.company_name && brands.length > 1 ? <span>· {row.company_name}</span> : null}</p>
            </div>
            <div className="text-right">
              <p className={`text-lg font-light ${deduction ? 'text-rose-200' : status.tone === 'paid' ? 'text-emerald-200' : 'text-[#e5e4e2]'}`}>{row.automatic_waiting_for_offer ? 'W ustaleniu' : `${deduction ? '−' : ''}${sellerMoney(Number(row.amount))}`}</p>
              <span className={`mt-1 inline-block rounded-md px-2 py-0.5 text-[11px] ${sellerCommissionToneClass[status.tone]}`}>{status.label}</span>
            </div>
          </div>
          {basis && <p className="mt-3 text-sm text-white/70">{basis}</p>}
          {status.detail && <p className="mt-1 text-xs text-white/45">{status.detail}{status.tone === 'forecast' ? ` (${SELLER_FORECAST_NOTE})` : ''}</p>}
          {!deduction && row.status === 'approved' && Number(row.paid_amount) > 0 && <p className="mt-1 text-xs text-white/55">Wypłacono {sellerMoney(Number(row.paid_amount))} · pozostało {sellerMoney(Number(row.remaining_amount))}</p>}
          {row.due_date && row.status === 'approved' && <p className="mt-1 text-xs text-white/45">Planowany termin wypłaty: {sellerCommissionDate(row.due_date)}</p>}
          <p className="mt-1 text-[11px] text-white/40">{sellerCommissionPaymentLabels[row.payment_method] || 'Sposób rozliczenia do ustalenia'}</p>
          {row.payments.length > 0 && <details className="mt-3 rounded-lg bg-white/[0.03] p-3 text-xs">
            <summary className="cursor-pointer text-[#d3bb73]">Wypłaty ({row.payments.length})</summary>
            <ul className="mt-2 space-y-1.5">{row.payments.map((payment) => <li key={payment.id} className="flex flex-wrap justify-between gap-2 text-white/70">
              <span>{payment.payment_date ? sellerCommissionDate(payment.payment_date) : 'Data niepodana'}{payment.reference ? ` · ${payment.reference}` : ''}{payment.is_offset || payment.source === 'offset' ? ' · potrącenie' : ''}</span>
              <span className="text-emerald-200">{sellerMoney(Number(payment.amount))}</span>
            </li>)}</ul>
          </details>}
        </li>;
      })}</ul>
    </>}
  </section>;
}
