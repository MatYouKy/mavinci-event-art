'use client';
import {
  COMMISSION_ENTRY_KIND_LABELS,
  COMMISSION_PAYMENT_LABELS,
  COMMISSION_SOURCE_LABELS,
  COMMISSION_STATUS_LABELS,
  SALES_SHARE_SOURCE_LABELS,
  formatPercent,
  formatPln,
  internalCommissionLabel,
  type EventSettlement,
  type SettlementCommissionRow,
} from '@/lib/events/settlement/eventSettlement';
import { formatSettlementDate } from './settlementUi';

const STATUS_CHIP: Record<SettlementCommissionRow['status'], string> = {
  planned: 'bg-white/10 text-[#e5e4e2]/75',
  approved: 'bg-[#d3bb73]/15 text-[#d3bb73]',
  paid: 'bg-emerald-400/15 text-emerald-200',
  cancelled: 'bg-white/5 text-[#e5e4e2]/45',
};

function Amounts({ amount, companyCost }: { amount: number; companyCost: number }) {
  return (
    <div className="shrink-0 text-right tabular-nums">
      <p className="text-sm font-medium text-[#e5e4e2]">{formatPln(amount)}</p>
      <p className="text-[11px] text-[#e5e4e2]/50">koszt firmy {formatPln(companyCost)}</p>
    </div>
  );
}

/** Prowizje z podsumowania: pracownicy (udział w sprzedaży), sprzedawcy zewnętrzni i zapisane wpisy prowizji. */
export default function SettlementCommissionsCard({ settlement }: { settlement: EventSettlement }) {
  const { internal, external, commissions } = settlement;
  return (
    <section aria-labelledby="settlement-commissions-heading" className="rounded-xl bg-white/5 p-4 sm:p-5">
      <h3 id="settlement-commissions-heading" className="font-medium text-[#e5e4e2]">
        Prowizje
      </h3>
      <p className="mt-0.5 text-xs text-[#e5e4e2]/55">
        Pracownik: 5% zysku netto, 10% gdy w dniu akceptacji oferty był opiekunem klienta. Sprzedawca zewnętrzny: stawka z kartoteki od
        przychodu netto minus wykonawcy zewnętrzni.
      </p>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">Sprzedawcy wydarzenia (pracownicy)</h4>
      {internal.length === 0 ? (
        <p className="mt-2 text-sm text-[#e5e4e2]/50">Nie zapisano sprzedawcy wydarzenia.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {internal.map(item => (
            <li key={item.employee_id} className="rounded-lg bg-white/[0.03] px-3 py-2.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#e5e4e2]">
                    {item.name}
                    <span className="ml-2 text-xs text-[#e5e4e2]/50">udział {formatPercent(item.share_percent)}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {item.client_owned && (
                      <span className="rounded-md bg-[#d3bb73]/15 px-2 py-0.5 text-[11px] text-[#d3bb73]">
                        Klient własny{item.client_label ? ` (${item.client_label})` : ''}
                        {item.client_checked_at ? ` · sprawdzono ${formatSettlementDate(item.client_checked_at)}` : ''}
                      </span>
                    )}
                    {item.source && (
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-[#e5e4e2]/55">
                        {SALES_SHARE_SOURCE_LABELS[item.source] ?? item.source}
                      </span>
                    )}
                    {item.retained && (
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-[#e5e4e2]/55">Stawka z zatwierdzonego rozliczenia</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#e5e4e2]/60">{internalCommissionLabel(item)}</p>
                  {item.rate_reason && <p className="text-xs text-[#e5e4e2]/45">{item.rate_reason}</p>}
                  <p className="text-[11px] text-[#e5e4e2]/40">
                    {COMMISSION_PAYMENT_LABELS[item.payment_method] ?? item.payment_method}
                    {item.payment_method === 'payroll' && item.employer_social_rate != null
                      ? ` · koszt firmy ze składkami pracodawcy ${formatPercent(item.employer_social_rate)}`
                      : ''}
                  </p>
                  {!item.enabled && (
                    <p className="mt-1 text-xs text-amber-200/90">
                      {item.blocked_reason || 'Pracownik nie ma włączonej prowizji od sprzedaży.'}
                    </p>
                  )}
                  {item.enabled && item.blocked_reason && <p className="mt-1 text-xs text-amber-200/90">{item.blocked_reason}</p>}
                </div>
                <Amounts amount={item.amount} companyCost={item.company_cost} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">Sprzedawcy zewnętrzni</h4>
      {external.length === 0 ? (
        <p className="mt-2 text-sm text-[#e5e4e2]/50">Brak sprzedawców zewnętrznych w tym wydarzeniu.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {external.map(item => (
            <li key={item.partner_id} className={`rounded-lg px-3 py-2.5 ${item.eligible ? 'bg-white/[0.03]' : 'bg-white/[0.015]'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#e5e4e2]">{item.name}</p>
                  <p className="mt-0.5 text-xs text-[#e5e4e2]/55">{COMMISSION_SOURCE_LABELS[item.source] ?? item.source}</p>
                  {item.eligible ? (
                    <>
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">
                        {formatPercent(item.rate)} od {formatPln(item.base)}
                      </p>
                      {item.rate_reason && <p className="text-xs text-[#e5e4e2]/45">{item.rate_reason}</p>}
                      {item.retained && <p className="text-[11px] text-[#e5e4e2]/45">Zmiana warunków w kartotece nie działa wstecz.</p>}
                      <p className="text-[11px] text-[#e5e4e2]/40">{COMMISSION_PAYMENT_LABELS[item.payment_method] ?? item.payment_method}</p>
                    </>
                  ) : (
                    <p className="mt-1 text-xs text-amber-200/85">{item.skip_reason || 'Bez prowizji.'}</p>
                  )}
                </div>
                {item.eligible && <Amounts amount={item.amount} companyCost={item.company_cost} />}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h4 className="mt-5 text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">Zapisane prowizje</h4>
      {commissions.length === 0 ? (
        <p className="mt-2 text-sm text-[#e5e4e2]/50">Brak zapisanych prowizji.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {commissions.map(row => (
            <li key={row.id} className={`rounded-lg px-3 py-2.5 ${row.status === 'cancelled' ? 'bg-white/[0.015] opacity-60' : 'bg-white/[0.03]'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-[#e5e4e2]">{row.beneficiary_name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
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
                    {row.manual && <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-[#e5e4e2]/55">Wpis ręczny</span>}
                    {row.settlement_revision != null && (
                      <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-[#e5e4e2]/55">wersja {row.settlement_revision}</span>
                    )}
                  </div>
                  {row.base_description && <p className="mt-1 break-words text-xs text-[#e5e4e2]/55">{row.base_description}</p>}
                  {row.rate != null && row.base_amount != null && row.entry_kind === 'accrual' && (
                    <p className="text-xs text-[#e5e4e2]/45">
                      {formatPercent(row.rate)} od {formatPln(row.base_amount)}
                      {row.rate_reason ? ` · ${row.rate_reason}` : ''}
                    </p>
                  )}
                  {row.status === 'cancelled' && row.cancel_reason && (
                    <p className="mt-0.5 break-words text-xs text-[#e5e4e2]/55">Powód anulowania: {row.cancel_reason}</p>
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
                  {row.company_cost_amount != null && row.company_cost_amount !== row.amount && (
                    <p className="text-[11px] text-[#e5e4e2]/45">koszt firmy {formatPln(row.company_cost_amount)}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
