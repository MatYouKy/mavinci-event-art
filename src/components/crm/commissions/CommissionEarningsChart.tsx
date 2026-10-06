'use client';

import { useId, useMemo, useState } from 'react';
import { formatCommissionMoney } from '@/lib/CRM/events/eventCommission';
import { getCommissionMonthsForYear, type CommissionSettlementStats } from '@/lib/CRM/events/commissionSettlementStats';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';

const money = (cents: number) => formatCommissionMoney(cents / 100);
const axisMoney = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 });
const monthNames = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const monthLabel = (month: string) => `${monthNames[Number(month.slice(5, 7)) - 1] || month.slice(5, 7)} ${month.slice(0, 4)}`;

export default function CommissionEarningsChart({
  summary,
  title = 'Zarobki i wypłaty prowizji',
  className = '',
  compact = false,
}: {
  summary: CommissionSettlementStats;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const chartId = useId();
  const [selectedYear, setSelectedYear] = useState('');
  const years = useMemo(() => [...new Set(summary.months.map((month) => month.month.slice(0, 4)))].sort().reverse(), [summary.months]);
  const year = selectedYear === 'all' || years.includes(selectedYear) ? selectedYear : years[0] || '';
  const months = useMemo(() => year === 'all'
    ? summary.months
    : year ? getCommissionMonthsForYear(summary.months, year) : [], [summary.months, year]);
  const chartData = useMemo(() => months.map((month) => ({
    month: monthLabel(month.month),
    earned: month.earnedCents / 100,
    paid: month.paidCents / 100,
  })), [months]);
  const cards = [
    { label: 'Zarobione / zatwierdzone', value: summary.earnedCents, detail: 'Nominalne prowizje za wydarzenia', color: 'text-[#d3bb73]' },
    { label: 'Wypłacone', value: summary.paidCents, detail: 'W tym wszystkie wypłaty częściowe', color: 'text-emerald-300' },
    { label: 'Pozostało do wypłaty', value: summary.outstandingCents, detail: 'Tylko zatwierdzone, po odjęciu wypłat', color: 'text-violet-200' },
    { label: 'Planowane', value: summary.plannedCents, detail: 'Jeszcze niezatwierdzone — poza saldem', color: 'text-[#e5e4e2]/70' },
  ];

  return (
    <section className={`rounded-xl bg-white/[0.025] ${compact ? 'p-4' : 'p-5 sm:p-6'} ${className}`} aria-labelledby={`${chartId}-title`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${chartId}-title`} className="text-base font-medium text-[#e5e4e2]">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#e5e4e2]/50">Podsumowanie całej historii w wybranym zakresie. Kwoty dla beneficjenta, bez kosztów i obciążeń spółki.</p>
        </div>
      </div>

      <dl className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg bg-black/15 p-3 sm:p-4">
            <dt className="text-xs text-[#e5e4e2]/55">{card.label}</dt>
            <dd className={`mt-2 text-xl font-medium tabular-nums ${card.color}`}>{money(card.value)}</dd>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#e5e4e2]/40">{card.detail}</p>
          </div>
        ))}
      </dl>

      {summary.waitingCount > 0 && (
        <p className="mb-4 rounded-lg bg-amber-300/5 px-3 py-2 text-xs leading-relaxed text-amber-100/80">
          Oczekujące na zaakceptowaną ofertę: {summary.waitingCount}. Bez ustalonej podstawy nie powiększają zarobków ani kwoty do wypłaty.
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-[#e5e4e2]">Miesięcznie</h4>
          <p id={`${chartId}-description`} className="mt-1 text-[11px] leading-relaxed text-[#e5e4e2]/45">
            Zarobione według daty wydarzenia; wypłacone według faktycznej daty płatności. Zmiana roku nie zmienia sum całej historii powyżej.
          </p>
        </div>
        {years.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/60">
            Rok
            <select
              aria-label="Rok wykresu prowizji"
              value={year}
              onChange={(event) => setSelectedYear(event.target.value)}
              className="rounded-lg border border-white/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-white/25"
            >
              {years.map((option) => <option key={option} value={option}>{option}</option>)}
              <option value="all">Cała historia</option>
            </select>
          </label>
        )}
      </div>

      {year === 'all' && <p className="mb-3 text-xs text-[#e5e4e2]/40">Cała historia — miesiące z zapisami.</p>}
      <div className="rounded-lg bg-black/10 p-2" aria-describedby={`${chartId}-description`}>
        <CrmCartesianChart
          data={chartData}
          categoryKey="month"
          series={[
            { key: 'earned', label: 'Zarobione', color: '#d3bb73' },
            { key: 'paid', label: 'Wypłacone', color: '#34d399' },
          ]}
          kind="bar"
          height={compact ? 250 : 310}
          valueFormatter={formatCommissionMoney}
          axisFormatter={(value) => axisMoney.format(value)}
          ariaLabel="Miesięczne zarobki według dat wydarzeń i wypłaty prowizji według dat płatności, w złotych"
          showLegend
          emptyMessage="Brak zatwierdzonych prowizji lub wypłat z przypisaną datą."
        />
      </div>

      {(summary.undatedEarnedCents > 0 || summary.undatedPaidCents > 0) && (
        <p className="mt-4 rounded-lg bg-amber-300/5 px-3 py-2 text-xs leading-relaxed text-amber-100/80">
          W sumach całej historii, lecz poza wykresem: {summary.undatedEarnedCents > 0 ? `${money(summary.undatedEarnedCents)} prowizji bez daty wydarzenia` : ''}{summary.undatedEarnedCents > 0 && summary.undatedPaidCents > 0 ? ' oraz ' : ''}{summary.undatedPaidCents > 0 ? `${money(summary.undatedPaidCents)} wypłat bez potwierdzonej daty płatności` : ''}. Brakujących dat nie zastępujemy datą utworzenia wpisu.
        </p>
      )}
      {summary.paymentDetailsMismatchCents > 0 && <p className="mt-3 text-xs text-amber-100/80">Saldo wypłat różni się od szczegółowych wpisów o {money(summary.paymentDetailsMismatchCents)}. Historia rozliczeń wymaga uzupełnienia lub sprawdzenia.</p>}
      {summary.cancelledPaidCents > 0 && <p className="mt-3 text-xs text-amber-100/80">Historia wypłat zawiera {money(summary.cancelledPaidCents)} związane z anulowanymi prowizjami. Anulowanie nie usuwa wykonanej wypłaty; kwoty te nie zwiększają zarobków ani salda do wypłaty.</p>}
      {summary.overpaidCents > 0 && <p className="mt-3 text-xs text-amber-100/80">Wypłaty przekraczające zatwierdzone prowizje: {money(summary.overpaidCents)}. Sprawdź rozliczenia.</p>}
    </section>
  );
}
