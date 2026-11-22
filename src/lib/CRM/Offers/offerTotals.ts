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

type OfferLineDiscountItem = { discount_amount?: number | string | null };

/** Suma rabatów pozycji (`offer_items.discount_amount`) — są już w `offers.subtotal`, czyli w podstawie rabatu na ofertę. */
export function getOfferLineDiscounts(offer: { offer_items?: OfferLineDiscountItem[] | null }) {
  return roundMoney((offer.offer_items || []).reduce((sum, item) => sum + Math.max(0, asNumber(item.discount_amount)), 0));
}

export type OfferSummaryRow = {
  key: 'items' | 'logistics' | 'list' | 'lineDiscount' | 'offerDiscount' | 'total';
  label: string;
  net: number;
  gross: number;
  emphasis?: boolean;
};

/**
 * Tabela „Podsumowanie” oferty — ta sama w CRM, na Macu i w aplikacji (i w tej samej kolejności co podsumowanie wyceny w PDF):
 * razem przed rabatem, rabaty pozycji, rabat na ofertę (procent od wartości po rabatach pozycji), razem po rabacie.
 * `totals` — wynik `getOfferPricingTotals` (albo podgląd edytowanego rabatu na ofertę).
 */
export function getOfferSummary(
  offer: OfferPricingTotalsInput & { offer_items?: OfferLineDiscountItem[] | null },
  totals: ReturnType<typeof getOfferPricingTotals> = getOfferPricingTotals(offer),
) {
  const lineDiscount = totals.source === 'offer' ? getOfferLineDiscounts(offer) : 0;
  const offerDiscount = totals.discountAmount;
  const discount = roundMoney(lineDiscount + offerDiscount);
  const withVat = (net: number) => roundMoney(net * (1 + totals.taxPercent / 100));
  const listNet = roundMoney(totals.listNet + lineDiscount);
  const listGross = totals.hasMixedVatRates ? totals.gross : withVat(listNet);
  // Wartość po rabatach pozycji (podstawa rabatu na ofertę) — dzieli różnicę brutto między oba rabaty.
  const afterLinesGross = totals.hasMixedVatRates ? totals.gross : withVat(totals.listNet);
  const logisticsNet = totals.source === 'offer' && offer.logistics_enabled ? roundMoney(Math.max(0, asNumber(offer.logistics_price_net))) : 0;
  const rows: OfferSummaryRow[] = [];
  if (logisticsNet > 0) {
    const itemsNet = roundMoney(listNet - logisticsNet);
    rows.push({ key: 'items', label: 'Pozycje oferty', net: itemsNet, gross: withVat(itemsNet) });
    rows.push({ key: 'logistics', label: 'Logistyka', net: logisticsNet, gross: withVat(logisticsNet) });
  }
  rows.push({ key: 'list', label: 'Razem przed rabatem', net: listNet, gross: listGross });
  if (lineDiscount > 0) {
    rows.push({
      key: 'lineDiscount', label: 'Rabaty pozycji', net: -lineDiscount,
      gross: -roundMoney(listGross - (offerDiscount > 0 ? afterLinesGross : totals.gross)),
    });
  }
  if (offerDiscount > 0) {
    const percent = totals.discountPercent.toFixed(2);
    rows.push({
      key: 'offerDiscount', label: lineDiscount > 0 ? `Rabat ${percent}% na ofertę` : `Rabat ${percent}%`,
      net: -offerDiscount, gross: -roundMoney((lineDiscount > 0 ? afterLinesGross : listGross) - totals.gross),
    });
  }
  rows.push({ key: 'total', label: discount > 0 ? 'Razem po rabacie' : 'Razem do zapłaty', net: totals.net, gross: totals.gross, emphasis: true });
  const discountPercent = listNet > 0 ? discount / listNet * 100 : 0;
  return {
    rows,
    lineDiscount,
    offerDiscount,
    discount,
    discountPercent,
    logisticsNet,
    /** Rabat łączny (pozycje i cała oferta) — tylko gdy są oba rodzaje; ten liczy się do progu akceptacji rabatu. */
    discountNote: lineDiscount > 0 && offerDiscount > 0
      ? `Rabat łączny: ${discountPercent.toFixed(2)}% (${discount.toFixed(2)} zł netto) wobec wartości przed rabatami.`
      : null,
  };
}
