import { getOfferPricingTotals, getOfferTotals, roundMoney, type OfferTotalsInput } from '@/lib/CRM/Offers/offerTotals';

type Numeric = number | string | null;
type InvoiceVatCode = '23' | '8' | '5' | '0';
type OfferItem = {
  name?: string | null;
  quantity?: Numeric;
  unit?: string | null;
  unit_price?: Numeric;
  discount_percent?: Numeric;
  total?: Numeric;
  display_order?: number | null;
};
type CalculationItem = {
  name?: string | null;
  quantity?: Numeric;
  unit?: string | null;
  unit_price?: Numeric;
  days?: Numeric;
  vat_rate?: Numeric;
  position?: number | null;
};
type InvoicePrefillItem = {
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
  vat_code: InvoiceVatCode;
};

function numeric(value: Numeric | undefined, fallback = 0) {
  const result = value == null ? fallback : Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error('Oferta zawiera nieprawidłową kwotę lub ilość. Sprawdź ją przed wystawieniem faktury.');
  return result;
}

function vatCode(rate: number): InvoiceVatCode {
  if (![0, 5, 8, 23].includes(rate)) throw new Error('Stawka VAT źródła wymaga ręcznego sprawdzenia przed wystawieniem faktury.');
  // 0% still requires choosing its transaction category in the invoice form.
  return String(rate) as InvoiceVatCode;
}

function invoiceLine(name: string, quantity: number, unit: string, net: number, rate: number, index: number) {
  if (quantity <= 0) throw new Error('Pozycja oferty ma zerową ilość. Sprawdź ofertę przed wystawieniem faktury.');
  const unitNet = roundMoney(net / quantity);
  // invoice_items stores quantity and price_net to two decimal places and
  // recalculates row totals. Never send a repeating fraction that changes on save.
  const keepsQuantity = roundMoney(quantity) === quantity && roundMoney(quantity * unitNet) === net;
  return {
    item: {
      position_number: index + 1,
      name: keepsQuantity ? name : `${name} (${quantity.toLocaleString('pl-PL')} ${unit} — pozycja łączna)`,
      unit: keepsQuantity ? unit : 'usł.',
      quantity: keepsQuantity ? quantity : 1,
      price_net: keepsQuantity ? unitNet : net,
      vat_rate: rate,
      vat_code: vatCode(rate),
    } satisfies InvoicePrefillItem,
    bundled: !keepsQuantity,
  };
}

export function getAcceptedOfferInvoicePrefill(
  offer: OfferTotalsInput & { status: string; offer_number?: string | null; offer_items?: OfferItem[] | null },
  eventName: string,
) {
  if (offer.status !== 'accepted') throw new Error('Oferta nie jest już zaakceptowana. Nie przeniesiono jej cen na fakturę.');
  const sourceItems = [...(offer.offer_items || [])].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  if (sourceItems.length === 0) throw new Error('Zaakceptowana oferta nie ma pozycji. Uzupełnij ją przed wystawieniem faktury.');
  const rows = sourceItems.map((item) => {
    const quantity = numeric(item.quantity, 1);
    const discount = numeric(item.discount_percent);
    if (discount > 100) throw new Error('Rabat pozycji oferty przekracza 100%.');
    // offer_items.total already includes the item discount; do not apply it twice.
    const net = item.total == null
      ? roundMoney(quantity * numeric(item.unit_price) * (1 - discount / 100))
      : roundMoney(numeric(item.total));
    return { name: item.name?.trim() || 'Pozycja oferty', quantity, unit: item.unit || 'szt.', net };
  });
  const totals = getOfferTotals(offer);
  const sourceNet = roundMoney(rows.reduce((sum, row) => sum + row.net, 0));
  if (sourceNet > 0 && totals.listNet <= 0) {
    throw new Error('Zaakceptowana oferta nie ma zapisanego podsumowania cen. Uzupełnij ofertę przed wystawieniem faktury.');
  }
  if (totals.net > sourceNet + 0.01 || (sourceNet <= 0 && totals.net > 0)) {
    throw new Error('Podsumowanie zaakceptowanej oferty jest wyższe niż suma jej pozycji po rabatach. Sprawdź ofertę — nie przeniesiono cen katalogowych.');
  }
  if (Math.abs(totals.taxAmount - roundMoney(totals.net * totals.taxPercent / 100)) > 0.001
    || Math.abs(totals.gross - roundMoney(totals.net + totals.taxAmount)) > 0.001) {
    throw new Error('Netto, VAT i brutto zaakceptowanej oferty są niespójne. Popraw podsumowanie oferty przed wystawieniem faktury.');
  }
  const totalCents = Math.round(totals.net * 100);
  const shares = rows.map((row, index) => {
    const precise = sourceNet > 0 ? totalCents * row.net / sourceNet : 0;
    return { index, cents: Math.floor(precise), remainder: precise - Math.floor(precise) };
  });
  let undistributed = totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (undistributed <= 0) break;
    share.cents += 1;
    undistributed -= 1;
  }
  const prepared = rows.map((row, index) => invoiceLine(row.name, row.quantity, row.unit, shares[index].cents / 100, totals.taxPercent, index));
  let items = prepared.map((row) => row.item);
  const rowVat = roundMoney(items.reduce((sum, item) => sum + roundMoney(roundMoney(item.quantity * item.price_net) * item.vat_rate / 100), 0));
  let notice = prepared.some((row) => row.bundled)
    ? 'Pozycje, których ceny jednostkowej nie można zapisać dokładnie w groszach, przeniesiono jako pozycje łączne z ilością źródłową w nazwie.'
    : '';
  if (rowVat !== totals.taxAmount) {
    // A single offer VAT rate is calculated on its total. Bundling retains that
    // agreed net/VAT/gross instead of silently adding or removing rounding cents.
    items = [{
      position_number: 1,
      name: `Realizacja wydarzenia ${eventName} — zgodnie z ofertą ${offer.offer_number || ''} (po rabatach)`.trim(),
      unit: 'usł.', quantity: 1, price_net: totals.net,
      vat_rate: totals.taxPercent, vat_code: vatCode(totals.taxPercent),
    }];
    notice = 'Zakres oferty przeniesiono jako jedną usługę, aby zachować dokładne uzgodnione netto, VAT i brutto bez różnic groszowych.';
  }
  return { items, totals, notice };
}

export function getAcceptedCalculationInvoicePrefill(calculation: {
  is_accepted: boolean;
  event_calculation_items?: CalculationItem[] | null;
}) {
  if (!calculation.is_accepted) throw new Error('Kalkulacja nie jest już zaakceptowana. Nie przeniesiono jej cen na fakturę.');
  const sourceItems = [...(calculation.event_calculation_items || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (!sourceItems.length) throw new Error('Zaakceptowana kalkulacja nie zawiera pozycji.');
  const prepared = sourceItems.map((item, index) => {
    const quantity = numeric(item.quantity, 1) * Math.max(1, numeric(item.days, 1));
    const net = roundMoney(quantity * numeric(item.unit_price));
    return invoiceLine(item.name?.trim() || 'Pozycja kalkulacji', quantity, item.unit || 'szt.', net, numeric(item.vat_rate, 23), index);
  });
  const totals = getOfferPricingTotals({
    event: { financial_source: 'calculation', accepted_calculation: { event_calculation_items: sourceItems } },
  });
  return {
    items: prepared.map((row) => row.item), totals,
    notice: prepared.some((row) => row.bundled)
      ? 'Zachowano kwoty i stawki VAT zaakceptowanej kalkulacji; pozycje wymagające ułamkowej ceny jednostkowej zapisano jako pozycje łączne.'
      : 'Kwoty i stawki VAT pochodzą z zaakceptowanej kalkulacji wybranej jako źródło finansowe wydarzenia.',
  };
}
