export type SubcontractorSettlementMethod = 'invoice' | 'cash_documented' | 'cash_non_deductible';

export type SubcontractorSettlementCost = {
  contractorAmount: number;
  economicCost: number;
  taxBurden: number;
  effectiveTaxRate: number;
  grossUpRate: number;
};

const roundMoney = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const clampTaxRate = (value: number) => Math.min(99.99, Math.max(0, Number(value || 0)));

/**
 * Calculates the economic cost of a payment funded from company profit.
 * CIT and dividend tax are sequential, so they must not be added together.
 */
export function calculateSubcontractorSettlementCost({
  contractorAmount,
  settlementMethod,
  citRate = 9,
  dividendTaxRate = 19,
}: {
  contractorAmount: number;
  settlementMethod: SubcontractorSettlementMethod;
  citRate?: number;
  dividendTaxRate?: number;
}): SubcontractorSettlementCost {
  const amount = Math.max(0, Number(contractorAmount || 0));

  if (settlementMethod !== 'cash_non_deductible') {
    return {
      contractorAmount: roundMoney(amount),
      economicCost: roundMoney(amount),
      taxBurden: 0,
      effectiveTaxRate: 0,
      grossUpRate: 0,
    };
  }

  const cit = clampTaxRate(citRate) / 100;
  const dividendTax = clampTaxRate(dividendTaxRate) / 100;
  const retainedShare = (1 - cit) * (1 - dividendTax);
  const economicCost = retainedShare > 0 ? amount / retainedShare : amount;

  return {
    contractorAmount: roundMoney(amount),
    economicCost: roundMoney(economicCost),
    taxBurden: roundMoney(economicCost - amount),
    effectiveTaxRate: roundMoney((1 - retainedShare) * 100),
    grossUpRate: amount > 0 ? roundMoney((economicCost / amount - 1) * 100) : 0,
  };
}
