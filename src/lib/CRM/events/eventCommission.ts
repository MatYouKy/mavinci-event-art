export type CommissionBeneficiaryType =
  | 'salesperson'
  | 'hotel'
  | 'partner'
  | 'employee'
  | 'other';

export type CommissionCalculationType = 'percent' | 'fixed';
export type CommissionPaymentMethod = 'cash_dividend' | 'invoice' | 'payroll' | 'other';
export type CommissionStatus = 'planned' | 'approved' | 'paid' | 'cancelled';

export const DEFAULT_DIVIDEND_TAX_RATE = 19;

export const commissionBeneficiaryLabels: Record<CommissionBeneficiaryType, string> = {
  salesperson: 'Sprzedawca / osoba polecająca',
  hotel: 'Hotel / sala',
  partner: 'Partner',
  employee: 'Pracownik',
  other: 'Inny beneficjent',
};

export const commissionPaymentLabels: Record<CommissionPaymentMethod, string> = {
  cash_dividend: 'Gotówka z zysku spółki',
  invoice: 'Faktura / rachunek',
  payroll: 'Wynagrodzenie pracownicze',
  other: 'Inny sposób',
};

export const commissionStatusLabels: Record<CommissionStatus, string> = {
  planned: 'Planowana',
  approved: 'Zatwierdzona',
  paid: 'Wypłacona',
  cancelled: 'Anulowana',
};

export const roundCommissionMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function getCommissionAmounts({
  calculationType,
  baseAmount,
  rate,
  fixedAmount,
  paymentMethod,
  dividendTaxRate = DEFAULT_DIVIDEND_TAX_RATE,
}: {
  calculationType: CommissionCalculationType;
  baseAmount: number;
  rate: number;
  fixedAmount: number;
  paymentMethod: CommissionPaymentMethod;
  dividendTaxRate?: number;
}) {
  const nominalAmount = roundCommissionMoney(
    calculationType === 'percent'
      ? Math.max(0, baseAmount) * Math.max(0, rate) / 100
      : Math.max(0, fixedAmount),
  );
  const safeTaxRate = Math.min(99.99, Math.max(0, dividendTaxRate));
  const companyCostAmount = roundCommissionMoney(
    paymentMethod === 'cash_dividend'
      ? nominalAmount / (1 - safeTaxRate / 100)
      : nominalAmount,
  );

  return {
    nominalAmount,
    companyCostAmount,
    taxBurdenAmount: roundCommissionMoney(companyCostAmount - nominalAmount),
  };
}

export const formatCommissionMoney = (value: number) =>
  `${Number(value || 0).toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} zł`;
