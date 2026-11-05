'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Loader2, RefreshCw, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import {
  COMMISSION_ENTRY_KIND_LABELS,
  COMMISSION_PAYMENT_LABELS,
  COMMISSION_STATUS_LABELS,
  SETTLEMENT_STATUS_LABELS,
  formatPercent,
  formatPln,
  parseMyCommissions,
  type MyCommissionRow,
  type MyCommissions,
} from '@/lib/events/settlement/eventSettlement';
import {
  SETTLEMENT_MIGRATION_NOTICE,
  formatSettlementDate,
  isMissingRpc,
  settlementErrorMessage,
} from '@/components/crm/events/settlement/settlementUi';

type LoadState = 'loading' | 'ready' | 'missing' | 'hidden' | 'error';
const COMPACT_EVENTS = 3;

const STATUS_CHIP: Record<MyCommissionRow['status'], string> = {
  planned: 'bg-white/10 text-[#e5e4e2]/75',
  approved: 'bg-[#d3bb73]/15 text-[#d3bb73]',
  paid: 'bg-emerald-400/15 text-emerald-200',
  cancelled: 'bg-white/5 text-[#e5e4e2]/45',
};

function groupByEvent(rows: MyCommissionRow[]) {
  const groups = new Map<string, { eventId: string; name: string; date: string | null; settlement: MyCommissionRow['settlement_status']; rows: MyCommissionRow[] }>();
  for (const row of rows) {
    const group = groups.get(row.event_id) ?? {
      eventId: row.event_id,
      name: row.event_name,
      date: row.event_date,
      settlement: row.settlement_status,
      rows: [],
    };
    group.rows.push(row);
    groups.set(row.event_id, group);
  }
  return [...groups.values()];
}

/**
 * „Moje prowizje” zalogowanego pracownika (get_my_commissions): sumy z bazy i lista według wydarzeń
 * z podstawą, stawką i linkiem do zakładki Podsumowanie. `compact` — karta na pulpicie.
 */
export default function MyCommissionsPanel({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const [data, setData] = useState<MyCommissions | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: result, error: loadError } = await supabase.rpc('get_my_commissions');
    if (loadError) {
      if (isMissingRpc(loadError)) setState('missing');
      else if (loadError.code === '42501') setState('hidden');
      else {
        setError(settlementErrorMessage(loadError, 'Nie udało się wczytać prowizji.'));
        setState(current => (current === 'ready' ? 'ready' : 'error'));
      }
      return;
    }
    const parsed = parseMyCommissions(result);
    if (!parsed) {
      setError('Baza zwróciła nieczytelne dane prowizji.');
      setState('error');
      return;
    }
    setData(parsed);
    setError('');
    setState('ready');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => groupByEvent(data?.commissions ?? []), [data]);

  if (state === 'hidden') return null;
  if (compact && (state === 'missing' || state === 'loading' || state === 'error')) return null;
  if (compact && data && !data.enabled && data.commissions.length === 0) return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const visibleGroups = compact ? groups.slice(0, COMPACT_EVENTS) : groups;
  const ownHref = data?.employee_id ? `/crm/employees/${data.employee_id}` : null;

  return (
    <section aria-labelledby="my-commissions-heading" className={`rounded-xl bg-[#1c1f33] ${compact ? 'p-5' : 'p-5 sm:p-6'} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="my-commissions-heading" className="flex items-center gap-2 font-medium text-[#e5e4e2]">
            <WalletCards className="h-5 w-5 text-[#d3bb73]" aria-hidden />
            Moje prowizje
          </h2>
          {data && (
            <p className="mt-1 text-xs text-[#e5e4e2]/50">
              {data.enabled
                ? `Prowizja od sprzedaży: ${formatPercent(data.standard_rate)} zysku netto, ${formatPercent(data.own_client_rate)} przy kliencie własnym · ${COMMISSION_PAYMENT_LABELS[data.payment_method] ?? data.payment_method}`
                : 'Prowizja od sprzedaży jest wyłączona — widzisz wcześniejsze naliczenia.'}
            </p>
          )}
        </div>
        {compact ? (
          ownHref && (
            <Link href={ownHref} className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline">
              Wszystkie <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )
        ) : (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Odśwież prowizje"
            title="Odśwież"
            className="rounded-lg p-2 text-[#e5e4e2]/50 hover:bg-white/5 hover:text-[#d3bb73] disabled:opacity-40"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
          </button>
        )}
      </div>

      {state === 'loading' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-[#e5e4e2]/55">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Wczytuję prowizje…
        </p>
      )}
      {state === 'missing' && <p className="mt-4 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-100/90">{SETTLEMENT_MIGRATION_NOTICE}</p>}
      {state === 'error' && (
        <p role="alert" className="mt-4 text-sm text-red-200">
          {error}
        </p>
      )}

      {state === 'ready' && data && (
        <>
          {error && <p className="mt-3 text-xs text-amber-200">{error}</p>}
          <dl className={`mt-4 grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
            {(
              [
                ['Prognoza', data.totals.forecast, 'text-[#e5e4e2]/80', 'Wydarzenia przed zatwierdzeniem podsumowania'],
                ['Do wypłaty', data.totals.to_pay, 'text-[#d3bb73]', 'Zatwierdzone, po odjęciu wypłat i rozliczonych potrąceń'],
                ['Wypłacone', data.totals.paid, 'text-emerald-300', 'Przelewy i wypłaty (bez potrąceń)'],
                ['Do potrącenia', data.totals.to_offset, 'text-red-200', 'Nadpłaty do odjęcia z kolejnych prowizji'],
              ] as const
            ).map(([label, value, tone, hint]) => (
              <div key={label} className="rounded-lg bg-black/15 px-3 py-2.5">
                <dt className="text-xs text-[#e5e4e2]/55">{label}</dt>
                <dd className={`mt-1 text-lg font-medium tabular-nums ${tone}`}>{formatPln(value)}</dd>
                {!compact && <p className="mt-0.5 text-[11px] leading-relaxed text-[#e5e4e2]/40">{hint}</p>}
              </div>
            ))}
          </dl>

          {groups.length === 0 ? (
            <p className="mt-4 text-sm text-[#e5e4e2]/45">Nie masz jeszcze naliczonych prowizji.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {visibleGroups.map(group => (
                <li key={group.eventId} className="rounded-lg bg-white/[0.03] px-3 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/crm/events/${group.eventId}?tab=summary`} className="min-w-0 break-words text-sm text-[#e5e4e2] hover:text-[#d3bb73]">
                      {group.name}
                    </Link>
                    <span className="text-[11px] text-[#e5e4e2]/45">
                      {[group.date ? formatSettlementDate(group.date) : null, `Podsumowanie: ${SETTLEMENT_STATUS_LABELS[group.settlement].toLowerCase()}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {group.rows.map(row => (
                      <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-black/10 px-2.5 py-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-1.5">
                            <span className={`rounded-md px-2 py-0.5 text-[11px] ${STATUS_CHIP[row.status] ?? STATUS_CHIP.planned}`}>
                              {COMMISSION_STATUS_LABELS[row.status] ?? row.status}
                            </span>
                            {row.entry_kind !== 'accrual' && (
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] ${
                                  row.entry_kind === 'deduction' ? 'bg-red-500/15 text-red-200' : 'bg-emerald-400/15 text-emerald-200'
                                }`}
                              >
                                {COMMISSION_ENTRY_KIND_LABELS[row.entry_kind]}
                              </span>
                            )}
                            {row.client_owned && <span className="rounded-md bg-[#d3bb73]/10 px-2 py-0.5 text-[11px] text-[#d3bb73]">Klient własny</span>}
                          </div>
                          {!compact && row.base_description && (
                            <p className="mt-1 break-words text-xs text-[#e5e4e2]/55">{row.base_description}</p>
                          )}
                          {row.rate != null && (
                            <p className="mt-0.5 text-xs text-[#e5e4e2]/50">
                              {formatPercent(row.rate)}
                              {row.base_amount != null ? ` od ${formatPln(row.base_amount)}` : ''}
                              {row.share_percent != null && row.share_percent !== 100 ? ` · udział ${formatPercent(row.share_percent)}` : ''}
                              {!compact && row.rate_reason ? ` · ${row.rate_reason}` : ''}
                            </p>
                          )}
                          {!compact && row.payments.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-[#e5e4e2]/40">
                              {row.payments
                                .map(payment => `${formatSettlementDate(payment.payment_date)}: ${formatPln(payment.amount)}${payment.is_offset ? ' (potrącenie, bez przelewu)' : payment.reference ? ` (${payment.reference})` : ''}`)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right tabular-nums">
                          <p className={`text-sm font-medium ${row.entry_kind === 'deduction' ? 'text-red-200' : 'text-[#e5e4e2]'}`}>
                            {row.entry_kind === 'deduction' ? '−' : ''}
                            {formatPln(row.amount)}
                          </p>
                          {row.paid_amount > 0 && row.entry_kind !== 'deduction' && (
                            <p className="text-[11px] text-emerald-300/80">wypłacono {formatPln(row.paid_amount)}</p>
                          )}
                          {row.offset_amount > 0 && (
                            <p className="text-[11px] text-[#e5e4e2]/55">potrącono {formatPln(row.offset_amount)}</p>
                          )}
                          {row.remaining_amount > 0 && (
                            <p className={`text-[11px] ${row.entry_kind === 'deduction' ? 'text-red-200/80' : 'text-[#d3bb73]/80'}`}>
                              {row.entry_kind === 'deduction' ? 'do potrącenia' : 'do wypłaty'} {formatPln(row.remaining_amount)}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {!compact && (
                    <Link href={`/crm/events/${group.eventId}?tab=summary`} className="mt-2 inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline">
                      Wyliczenie: zakładka Podsumowanie <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          {compact && groups.length > COMPACT_EVENTS && ownHref && (
            <Link href={ownHref} className="mt-3 inline-block text-xs text-[#d3bb73] hover:underline">
              Pokaż wszystkie ({groups.length})
            </Link>
          )}
        </>
      )}
    </section>
  );
}
