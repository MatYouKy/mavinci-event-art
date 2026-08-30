export type OfferTotalsInput = {
  subtotal?: number | string | null;
  discount_amount?: number | string | null;
  discount_percent?: number | string | null;
  tax_amount?: number | string | null;
  tax_percent?: number | string | null;
  total_amount?: number | string | null;
};

const asNumber = (value: unknown, fallback = 0) => {
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

  const discountAmount = Math.min(listNet, storedDiscount);
  const net = Math.max(0, listNet - discountAmount);
  const taxAmount = storedTax || roundMoney(net * taxPercent / 100);
  const gross = storedGross || roundMoney(net + taxAmount);
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
