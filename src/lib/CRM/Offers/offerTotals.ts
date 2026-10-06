export type OfferTotalsInput = {
  logistics_enabled?: boolean;
  logistics_price_net?: number | string | null;
  totals_include_logistics?: boolean;
  subtotal?: number | string | null;
  discount_amount?: number | string | null;
  discount_percent?: number | string | null;
  tax_amount?: number | string | null;
  tax_percent?: number | string | null;
  total_amount?: number | string | null;
};

type CalculationPricingItem = {
  quantity?: number | string | null;
  unit_price?: number | string | null;
  days?: number | string | null;
  vat_rate?: number | string | null;
};

export type OfferPricingTotalsInput = OfferTotalsInput & {
  pricing_source?: string | null;
  calculation_snapshot?: { event_calculation_items?: CalculationPricingItem[] | null } | null;
  event?: {
    financial_source?: string | null;
    accepted_calculation?: {
      event_calculation_items?: CalculationPricingItem[] | null;
    } | null;
  } | null;
};

const asNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function getOfferTotals(offer: OfferTotalsInput) {
  const storedDiscount = Math.max(0, asNumber(offer.discount_amount));
  const storedTax = Math.max(0, asNumber(offer.tax_amount));
  const storedGross = Math.max(0, asNumber(offer.total_amount));
  const taxPercent = Math.max(0, asNumber(offer.tax_percent, 23));

  let listNet = Math.max(0, asNumber(offer.subtotal));
  if (listNet === 0 && storedGross > 0) {
    const netAfterDiscount = storedTax > 0
      ? Math.max(0, storedGross - storedTax)
      : storedGross / (1 + taxPercent / 100);
    listNet = netAfterDiscount + storedDiscount;
  }

  const addedLogisticsNet = offer.logistics_enabled && !offer.totals_include_logistics
    ? Math.max(0, asNumber(offer.logistics_price_net)) : 0;
  listNet += addedLogisticsNet;

  const discountAmount = Math.min(listNet, storedDiscount);
  const net = Math.max(0, listNet - discountAmount);
  const calculatedTax = roundMoney(net * taxPercent / 100);
  // Legacy totals exclude logistics: their saved VAT and gross cannot be
  // reused after adding the customer logistics price to the discount base.
  const taxAmount = addedLogisticsNet > 0 ? calculatedTax : storedTax > 0 ? storedTax : calculatedTax;
  const calculatedGross = roundMoney(net + taxAmount);
  // Starsze oferty potrafią mieć w total_amount zapisaną kwotę netto i pusty
  // tax_amount. Nie pozwalamy, by taki zapis zrównał brutto z netto.
  const gross = addedLogisticsNet === 0 && storedGross > 0 && (taxPercent === 0 || storedGross >= calculatedGross - 0.01)
    ? storedGross
    : calculatedGross;
  const discountPercent = listNet > 0
    ? discountAmount / listNet * 100
    : Math.max(0, asNumber(offer.discount_percent));

  return {
    listNet: roundMoney(listNet),
    discountAmount: roundMoney(discountAmount),
    discountPercent,
    net: roundMoney(net),
    taxPercent,
    taxAmount: roundMoney(taxAmount),
    gross: roundMoney(gross),
  };
}

export function getOfferPricingTotals(offer: OfferPricingTotalsInput) {
  const calculationItems = offer.calculation_snapshot?.event_calculation_items;
  if (offer.pricing_source !== 'calculation' || !Array.isArray(calculationItems)) {
    return {
      ...getOfferTotals(offer),
      source: 'offer' as const,
      hasMixedVatRates: false,
    };
  }

  let net = 0;
  let taxAmount = 0;
  const vatRates = new Set<number>();

  calculationItems.forEach((item) => {
    const quantity = Math.max(0, asNumber(item.quantity));
    const unitPrice = Math.max(0, asNumber(item.unit_price));
    const days = Math.max(1, asNumber(item.days, 1));
    const vatRate = Math.max(0, asNumber(item.vat_rate, 23));
    const rowNet = roundMoney(quantity * unitPrice * days);

    net += rowNet;
    taxAmount += roundMoney(rowNet * vatRate / 100);
    vatRates.add(vatRate);
  });

  net = roundMoney(net);
  taxAmount = roundMoney(taxAmount);
  const taxPercent = vatRates.size === 1
    ? [...vatRates][0]
    : net > 0
      ? taxAmount / net * 100
      : 0;

  return {
    listNet: net,
    discountAmount: 0,
    discountPercent: 0,
    net,
    taxPercent,
    taxAmount,
    gross: roundMoney(net + taxAmount),
    source: 'calculation' as const,
    hasMixedVatRates: vatRates.size > 1,
  };
}
