'use client';
import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { sellerMoney } from '@/lib/seller/portal';
import { sellerCommissionDate, sellerCommissionPaymentLabels } from '@/lib/seller/commissions';
import {
  SELLER_SUMMARY_CATEGORY_LABELS,
  SELLER_SUMMARY_SOURCE_LABELS,
  parseSellerEventSummary,
  sellerSummaryPercent,
  type SellerEventSummary as Summary,
  type SellerSummaryLine,
} from '@/lib/seller/sellerEventSummary';

const SOURCE_TONE: Record<Summary['source'], string> = {
  forecast: 'bg-sky-300/10 text-sky-200',
  submitted: 'bg-[#d3bb73]/15 text-[#d3bb73]',
  approved: 'bg-emerald-300/10 text-emerald-200',
};

function Row({ label, value, hint, strong, sign }: { label: string; value: number; hint?: string | null; strong?: boolean; sign?: '−' | '=' | '×' }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 rounded-lg px-3 py-2 ${strong ? 'bg-[#d3bb73]/10' : 'bg-white/[0.03]'}`}>
      <dt className={`min-w-0 text-sm ${strong ? 'text-[#d3bb73]' : 'text-white/75'}`}>
        {sign && <span className="mr-1.5 text-white/40">{sign}</span>}
        {label}
        {hint && <span className="block text-[11px] text-white/40">{hint}</span>}
      </dt>
      <dd className={`shrink-0 text-right tabular-nums ${strong ? 'text-base font-medium text-[#d3bb73]' : 'text-sm'}`}>{sellerMoney(value)}</dd>
    </div>
  );
}

function Lines({ title, lines, total }: { title: string; lines: SellerSummaryLine[]; total: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs uppercase tracking-wide text-white/50">{title}</h4>
        <p className="text-sm tabular-nums">{sellerMoney(total)}</p>
      </div>
      {lines.length === 0 ? (
        <p className="mt-2 text-xs text-white/40">Brak pozycji.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {lines.map((line, index) => (
            <li key={`${line.category}:${index}`} className="flex items-start justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block break-words text-white/80">{line.name}</span>
                <span className="text-[11px] text-white/40">
                  {SELLER_SUMMARY_CATEGORY_LABELS[line.category] ?? line.category}
                  {line.to_confirm ? ' · kwota do potwierdzenia przez MAVINCI' : ''}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-white/80">{sellerMoney(line.net_amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Podsumowanie wydarzenia dla sprzedawcy zewnętrznego: przychody i koszty z kwotą netto, zysk, koszt jego prowizji
 * dla MAVINCI, podstawa, stawka i prowizja. Dane i uprawnienia — get_seller_event_summary (baza).
 */
export default function SellerEventSummary({ eventId, revision = 0 }: { eventId: string; revision?: number }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void supabase.rpc('get_seller_event_summary', { p_event_id: eventId }).then(({ data, error: rpcError }) => {
      if (!active) return;
      setLoading(false);
      if (rpcError) {
        setError(
          rpcError.code === 'PGRST202' || rpcError.code === '42883'
            ? 'Podsumowanie wydarzenia będzie dostępne wkrótce.'
            : rpcError.message?.trim() || 'Nie udało się wczytać podsumowania wydarzenia.',
        );
        return;
      }
      const parsed = parseSellerEventSummary(data);
      if (!parsed) {
        setError('Nie udało się odczytać podsumowania wydarzenia.');
        return;
      }
      setError('');
      setSummary(parsed);
    });
    return () => {
      active = false;
    };
  }, [eventId, revision, retry]);

  if (loading && !summary) {
    return (
      <p role="status" className="flex items-center gap-2 py-4 text-sm text-white/55">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Wczytywanie podsumowania wydarzenia…
      </p>
    );
  }
  if (error && !summary) {
    return (
      <p role="alert" className="rounded-lg bg-white/[0.04] p-3 text-sm text-white/65">
        {error}{' '}
        <button type="button" onClick={() => setRetry(n => n + 1)} className="text-[#d3bb73] underline">
          Spróbuj ponownie
        </button>
      </p>
    );
  }
  if (!summary) return null;

  const { totals, mine } = summary;
  const revenue = summary.lines.filter(line => line.kind === 'revenue');
  const costs = summary.lines.filter(line => line.kind === 'cost');
  const costsTotal = totals.event_costs_net;
  const source = SELLER_SUMMARY_SOURCE_LABELS[summary.source];
  const profitRule = summary.base_rule === 'profit';
  const rounding = totals.rounding_difference;
  const cashTax = mine?.payment_method === 'cash_dividend' && mine.dividend_tax_rate != null ? mine.dividend_tax_rate : null;

  return (
    <div className="space-y-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-xs ${SOURCE_TONE[summary.source]}`}>{source.label}</span>
        <span className="text-xs text-white/45">
          {source.detail}
          {summary.as_of ? ` Stan na ${sellerCommissionDate(summary.as_of)}.` : ''}
        </span>
        <button type="button" onClick={() => setRetry(n => n + 1)} disabled={loading} className="ml-auto inline-flex items-center gap-1 text-xs text-[#d3bb73] disabled:opacity-40">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Odśwież
        </button>
      </div>
      {summary.event.cancelled && <p className="rounded-lg bg-rose-300/10 px-3 py-2 text-xs text-rose-100">Wydarzenie zostało anulowane.</p>}
      {summary.forecast && summary.source === 'forecast' && (
        <p className="rounded-lg bg-sky-300/10 px-3 py-2 text-xs text-sky-100/90">
          Przychód pochodzi jeszcze z oferty — po wystawieniu faktury kwoty mogą się zmienić.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Lines title="Przychody netto" lines={revenue} total={totals.revenue_net} />
        <Lines title="Koszty netto" lines={costs} total={costsTotal} />
      </div>

      <div>
        <h4 className="text-xs uppercase tracking-wide text-white/50">Jak liczymy Twoją prowizję</h4>
        {profitRule ? (
          <p className="mt-1 text-xs leading-5 text-white/45">
            Prowizja to Twój % od zysku netto wydarzenia. Twoja prowizja jest kosztem MAVINCI, więc zysk netto jest już pomniejszony o jej
            koszt{cashTax != null ? ` (wypłata gotówką z zysku razem z podatkiem ${sellerSummaryPercent(cashTax)})` : ''}.
          </p>
        ) : (
          <p className="mt-1 text-xs leading-5 text-white/45">
            To rozliczenie zatwierdzono według wcześniejszej zasady: % od przychodu netto minus wykonawcy zewnętrzni.
          </p>
        )}
        <dl className="mt-2 space-y-1">
          <Row label="Przychód netto" value={totals.revenue_net} />
          <Row label="Koszty wydarzenia" value={costsTotal} sign="−" hint="wykonawcy, koszty wydarzenia, ekipa, narzuty" />
          {profitRule ? (
            <>
              <Row label="Zysk przed prowizjami sprzedawców" value={totals.profit_before_external} sign="=" />
              {mine && <Row label="Koszt Twojej prowizji dla MAVINCI" value={totals.own_commission_cost} sign="−" />}
              {totals.other_sellers_cost > 0 && <Row label="Koszt prowizji innych sprzedawców" value={totals.other_sellers_cost} sign="−" />}
              <Row label="Zysk netto — podstawa Twojej prowizji" value={mine?.base ?? totals.partner_base} sign="=" strong />
            </>
          ) : (
            <Row label="Podstawa Twojej prowizji" value={mine?.base ?? totals.partner_base} sign="=" strong />
          )}
        </dl>
        {rounding !== 0 && <p className="mt-1 text-[11px] text-white/40">Różnica {sellerMoney(Math.abs(rounding))} wynika z zaokrągleń do grosza.</p>}
      </div>

      {mine ? (
        <div className="rounded-xl bg-[#d3bb73]/10 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-sm text-white/75">
              {sellerSummaryPercent(mine.rate)} × {sellerMoney(mine.base)}
              <span className="block text-[11px] text-white/45">{mine.rate_label}</span>
            </p>
            <p className="text-2xl font-light text-[#d3bb73]">{sellerMoney(mine.amount)}</p>
          </div>
          <p className="mt-1 text-[11px] text-white/45">
            {(mine.payment_method && sellerCommissionPaymentLabels[mine.payment_method]) || 'Sposób rozliczenia do ustalenia'}
          </p>
        </div>
      ) : (
        <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/60">W tym rozliczeniu nie ma Twojej prowizji.</p>
      )}

      {summary.commissions.some(row => row.paid_amount > 0 || row.offset_amount > 0) && (
        <p className="text-xs text-white/55">
          Wypłacono {sellerMoney(summary.commissions.reduce((sum, row) => sum + row.paid_amount, 0))}
          {summary.commissions.some(row => row.offset_amount > 0)
            ? ` · rozliczono potrąceniem ${sellerMoney(summary.commissions.reduce((sum, row) => sum + row.offset_amount, 0))}`
            : ''}
        </p>
      )}
      <p className="text-[11px] leading-5 text-white/35">
        Kwoty netto, bez VAT. Ekipa MAVINCI jedną kwotą z ewidencji czasu pracy. Prowizje pracowników MAVINCI nie wpływają na Twoją podstawę.
      </p>
    </div>
  );
}
