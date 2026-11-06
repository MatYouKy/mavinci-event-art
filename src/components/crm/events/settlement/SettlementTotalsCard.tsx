'use client';
import {
  SETTLEMENT_TOTAL_ROWS,
  formatPln,
  settlementTotalValue,
  type SettlementTotals,
} from '@/lib/events/settlement/eventSettlement';

/** Objaśnienia wierszy (wartości i nazwy — wspólne z aplikacją: SETTLEMENT_TOTAL_ROWS). */
function rowHint(keys: (keyof SettlementTotals)[], totals: SettlementTotals): string | null {
  if (keys.includes('profit_before_external')) return 'Przychód netto − wykonawcy − koszty bezpośrednie − ekipa − narzuty.';
  if (keys.includes('external_commission_auto')) {
    return totals.external_commission_auto > 0 ? 'Stawka sprzedawcy × zysk netto; wypłata gotówką z zysku razem z podatkiem.' : null;
  }
  if (keys.includes('profit_net')) return 'Od tej kwoty liczą się prowizje sprzedawców zewnętrznych i pracowników.';
  if (keys.includes('internal_commissions_cost')) return `Kwota dla pracowników: ${formatPln(totals.internal_commissions)}`;
  return null;
}

/** Wynik podsumowania — wyłącznie wartości policzone przez bazę (totals z get_event_settlement). */
export default function SettlementTotalsCard({ totals, forecast }: { totals: SettlementTotals; forecast: boolean }) {
  return (
    <section aria-labelledby="settlement-totals-heading" className="rounded-xl bg-white/5 p-4 sm:p-5">
      <h3 id="settlement-totals-heading" className="font-medium text-[#e5e4e2]">
        Wynik wydarzenia
      </h3>
      {forecast && <p className="mt-0.5 text-xs text-sky-200/80">Prognoza — przychód z oferty lub kalkulacji.</p>}
      <dl className="mt-3 space-y-1">
        {SETTLEMENT_TOTAL_ROWS.map(row => {
          const hint = rowHint(row.keys, totals);
          return (
            <div
              key={row.label}
              className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-3 py-2 ${
                row.strong ? 'bg-[#d3bb73]/10' : 'bg-white/[0.02]'
              }`}
            >
              <dt className={`min-w-0 text-sm ${row.strong ? 'font-medium text-[#d3bb73]' : 'text-[#e5e4e2]/80'}`}>
                {row.label}
                {hint && <span className="block text-[11px] font-normal text-[#e5e4e2]/45">{hint}</span>}
              </dt>
              <dd className={`text-right tabular-nums ${row.strong ? 'text-base font-semibold text-[#d3bb73]' : 'text-sm text-[#e5e4e2]'}`}>
                {formatPln(settlementTotalValue(totals, row.keys))}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
