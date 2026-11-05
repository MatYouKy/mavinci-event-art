import type { CommissionSettlement } from './commissionSettlements';

export type CommissionSettlementMonth = {
  month: string;
  earnedCents: number;
  paidCents: number;
};

export type CommissionSettlementStats = {
  earnedCents: number;
  paidCents: number;
  outstandingCents: number;
  plannedCents: number;
  undatedEarnedCents: number;
  undatedPaidCents: number;
  cancelledPaidCents: number;
  overpaidCents: number;
  paymentDetailsMismatchCents: number;
  waitingCount: number;
  plannedCount: number;
  approvedCount: number;
  partialCount: number;
  cancelledCount: number;
  /** Otwarte potrącenia (to_offset z bazy) — odjęte od salda do wypłaty. */
  toOffsetCents: number;
  deductionCount: number;
  months: CommissionSettlementMonth[];
};

/** Convert every nominal PLN amount before adding it; never sum floating prices. */
export function commissionAmountToCents(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : 0;
}

function dateMonth(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(value || '');
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime())
    || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}`;
}

/** Earnings use the event date; cash uses only the recorded actual payment date.
 * The caller owns loading and company/beneficiary scope. No mutation or tax-cost
 * calculation belongs here: amount is the beneficiary's nominal commission.
 */
export function buildCommissionSettlementStats(rows: readonly CommissionSettlement[]): CommissionSettlementStats {
  const stats: CommissionSettlementStats = {
    earnedCents: 0, paidCents: 0, outstandingCents: 0, plannedCents: 0,
    undatedEarnedCents: 0, undatedPaidCents: 0, cancelledPaidCents: 0,
    overpaidCents: 0, paymentDetailsMismatchCents: 0,
    waitingCount: 0, plannedCount: 0, approvedCount: 0, partialCount: 0, cancelledCount: 0,
    toOffsetCents: 0, deductionCount: 0,
    months: [],
  };
  const months = new Map<string, CommissionSettlementMonth>();
  const seenCommissions = new Set<string>();
  const seenPayments = new Set<string>();
  // Ujemne kwoty (potrącenia) pomniejszają miesiąc wydarzenia, w którym powstały.
  const addMonth = (month: string, field: 'earnedCents' | 'paidCents', cents: number) => {
    if (!cents) return;
    const entry = months.get(month) || { month, earnedCents: 0, paidCents: 0 };
    entry[field] += cents;
    months.set(month, entry);
  };

  for (const row of rows) {
    if (seenCommissions.has(row.id)) continue;
    seenCommissions.add(row.id);
    const deduction = row.entry_kind === 'deduction';
    const amountCents = commissionAmountToCents(row.amount);
    let paymentRowsCents = 0;
    let offsetRowsCents = 0;
    for (const payment of row.payments || []) {
      const paymentKey = `${row.id}:${payment.id}`;
      if (seenPayments.has(paymentKey)) continue;
      seenPayments.add(paymentKey);
      const cents = commissionAmountToCents(payment.amount);
      paymentRowsCents += cents;
      // Potrącenie rozlicza nadpłatę bez przelewu — nie jest wypłatą gotówki (ani po stronie celu, ani potrącenia).
      if (deduction || payment.is_offset || payment.source === 'offset') {
        offsetRowsCents += cents;
        continue;
      }
      const paidMonth = dateMonth(payment.payment_date);
      if (paidMonth) addMonth(paidMonth, 'paidCents', cents);
      else stats.undatedPaidCents += cents;
    }
    // paid_amount z bazy = przelewy i potrącenia razem; payments zawiera też wpis „legacy”. Nie dodajemy ich drugi raz.
    const reportedPaidCents = commissionAmountToCents(row.paid_amount);
    const settledCents = Math.max(reportedPaidCents, paymentRowsCents);
    const cashCents = Math.max(settledCents - offsetRowsCents, 0);
    stats.paidCents += cashCents;
    stats.undatedPaidCents += Math.max(reportedPaidCents - paymentRowsCents, 0);
    stats.paymentDetailsMismatchCents += Math.abs(reportedPaidCents - paymentRowsCents);

    if (row.status === 'cancelled') {
      stats.cancelledCount += 1;
      stats.cancelledPaidCents += cashCents;
      continue;
    }
    if (row.automatic_waiting_for_offer) {
      stats.waitingCount += 1;
      continue;
    }
    if (deduction) {
      // Do potrącenia: pomniejsza zarobki; otwarta część (to_offset z bazy) pomniejsza saldo do wypłaty.
      if (row.status !== 'approved' && row.status !== 'paid') continue;
      stats.deductionCount += 1;
      stats.earnedCents -= amountCents;
      stats.toOffsetCents += row.to_offset != null
        ? commissionAmountToCents(row.to_offset)
        : row.status === 'approved' ? Math.max(amountCents - settledCents, 0) : 0;
      const deductionMonth = dateMonth(row.event_date);
      if (deductionMonth) addMonth(deductionMonth, 'earnedCents', -amountCents);
      else stats.undatedEarnedCents -= amountCents;
      continue;
    }
    if (row.status === 'planned') {
      stats.plannedCount += 1;
      stats.plannedCents += amountCents;
      continue;
    }
    if (row.status !== 'approved' && row.status !== 'paid') continue;
    stats.approvedCount += 1;
    stats.earnedCents += amountCents;
    stats.outstandingCents += Math.max(amountCents - settledCents, 0);
    stats.overpaidCents += Math.max(settledCents - amountCents, 0);
    if (settledCents > 0 && settledCents < amountCents) stats.partialCount += 1;
    const earnedMonth = dateMonth(row.event_date);
    if (earnedMonth) addMonth(earnedMonth, 'earnedCents', amountCents);
    else stats.undatedEarnedCents += amountCents;
  }

  stats.outstandingCents = Math.max(stats.outstandingCents - stats.toOffsetCents, 0);
  stats.months = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  return stats;
}

export function getCommissionMonthsForYear(months: readonly CommissionSettlementMonth[], year: string): CommissionSettlementMonth[] {
  const indexed = new Map(months.map((month) => [month.month, month]));
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    return indexed.get(month) || { month, earnedCents: 0, paidCents: 0 };
  });
}
