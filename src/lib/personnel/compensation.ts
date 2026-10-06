/** Planning estimates, not a payroll engine. Rates are supplied by central settings. */
export type CompensationSettings = {
  id: number;
  cit_rate: number;
  dividend_rate: number;
  employer_social_rate: number;
  employee_social_rate: number;
  mandate_social_rate: number;
  health_rate: number;
  pit_rate: number;
  monthly_tax_credit: number;
  employment_deduction: number;
  mandate_deduction_rate: number;
  reference_hours: number;
  updated_at?: string;
};
export const compensationSettingLabels: Record<
  keyof Omit<CompensationSettings, 'id' | 'updated_at'>,
  string
> = {
  cit_rate: 'CIT klasyczny (%)',
  dividend_rate: 'Podatek od dywidendy (%)',
  employer_social_rate: 'Składki po stronie pracodawcy (%)',
  employee_social_rate: 'Składki społeczne pracownika — UoP (%)',
  mandate_social_rate: 'Składki społeczne zleceniobiorcy (%)',
  health_rate: 'Składka zdrowotna (%)',
  pit_rate: 'Stawka PIT w symulacji (%)',
  monthly_tax_credit: 'Miesięczna kwota zmniejszająca PIT (zł)',
  employment_deduction: 'Miesięczne koszty uzyskania — UoP (zł)',
  mandate_deduction_rate: 'Koszty uzyskania — zlecenie (%)',
  reference_hours: 'Godziny w miesiącu porównawczym',
};
export type EmployeeCompensation = {
  employee_id: string;
  pay_basis: 'hourly' | 'monthly';
  rate_basis: 'net' | 'gross';
  hourly_rate: number;
  monthly_salary: number;
  contract_kind: 'employment' | 'mandate' | 'other';
  payment_method: 'bank' | 'cash';
  funding_source: 'company' | 'dividend';
  updated_at?: string;
};
export const emptyCompensation = (employeeId: string): EmployeeCompensation => ({
  employee_id: employeeId,
  pay_basis: 'hourly',
  rate_basis: 'net',
  hourly_rate: 0,
  monthly_salary: 0,
  contract_kind: 'mandate',
  payment_method: 'bank',
  funding_source: 'company',
});
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function payrollEstimate(
  gross: number,
  kind: 'employment' | 'mandate',
  s: CompensationSettings,
) {
  if (!Number.isFinite(gross) || gross < 0) throw new Error('Nieprawidłowa kwota wynagrodzenia');
  const social = money(
    (gross * (kind === 'employment' ? s.employee_social_rate : s.mandate_social_rate)) / 100,
  );
  const health = money(((gross - social) * s.health_rate) / 100);
  const deduction =
    kind === 'employment'
      ? s.employment_deduction
      : ((gross - social) * s.mandate_deduction_rate) / 100;
  const pit = Math.max(
    0,
    Math.round((Math.max(0, gross - social - deduction) * s.pit_rate) / 100 - s.monthly_tax_credit),
  );
  return {
    gross: money(gross),
    net: money(gross - social - health - pit),
    companyCost: money(gross * (1 + s.employer_social_rate / 100)),
  };
}
export function grossForTargetNet(
  net: number,
  kind: 'employment' | 'mandate',
  s: CompensationSettings,
) {
  if (!Number.isFinite(net) || net < 0) throw new Error('Nieprawidłowa kwota netto');
  if (!net) return payrollEstimate(0, kind, s);
  let low = net,
    high = Math.max(1, net * 2);
  while (payrollEstimate(high, kind, s).net < net && high < 1e9) high *= 2;
  if (payrollEstimate(high, kind, s).net < net)
    throw new Error('Nie można obliczyć porównania dla tych parametrów');
  // Payroll rounding is not strictly monotone at tax steps. Cent-level scan below finds a sufficient result.
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (payrollEstimate(mid, kind, s).net < net) low = mid;
    else high = mid;
  }
  let gross = Math.ceil(high * 100) / 100;
  while (payrollEstimate(gross, kind, s).net < net) gross = money(gross + 0.01);
  return payrollEstimate(gross, kind, s);
}
export function dividendFundingCost(net: number, s: CompensationSettings) {
  if (
    !Number.isFinite(net) ||
    net < 0 ||
    s.cit_rate < 0 ||
    s.cit_rate >= 100 ||
    s.dividend_rate < 0 ||
    s.dividend_rate >= 100
  )
    throw new Error('Nieprawidłowe parametry podatków');
  return money(net / ((1 - s.cit_rate / 100) * (1 - s.dividend_rate / 100)));
}
export function compensationComparison(
  profile: EmployeeCompensation,
  s: CompensationSettings,
  hours = s.reference_hours,
) {
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('Podaj dodatnią liczbę godzin');
  const nominal =
    profile.pay_basis === 'hourly' ? profile.hourly_rate * hours : profile.monthly_salary;
  const net =
    profile.rate_basis === 'gross' && profile.contract_kind !== 'other'
      ? payrollEstimate(nominal, profile.contract_kind, s).net
      : nominal;
  if (profile.rate_basis === 'gross' && profile.contract_kind === 'other') return null;
  return {
    net: money(net),
    hours,
    employment: grossForTargetNet(net, 'employment', s),
    mandate: grossForTargetNet(net, 'mandate', s),
    dividend: dividendFundingCost(net, s),
  };
}

export type CompensationSnapshot = { profile: EmployeeCompensation; settings: CompensationSettings };
export function timeEntryCompanyRate(entry: { hourly_rate: number | null; compensation_snapshot?: CompensationSnapshot | null }) {
  const snapshot = entry.compensation_snapshot;
  if (!snapshot) return Number(entry.hourly_rate || 0);
  const profile = { ...snapshot.profile, hourly_rate: Number(entry.hourly_rate || 0) };
  const comparison = compensationComparison(profile, snapshot.settings);
  if (!comparison) return Number(entry.hourly_rate || 0);
  const total = profile.funding_source === 'dividend' ? comparison.dividend
    : profile.contract_kind === 'employment' ? comparison.employment.companyCost
    : profile.contract_kind === 'mandate' ? comparison.mandate.companyCost : comparison.net;
  return total / comparison.hours;
}
