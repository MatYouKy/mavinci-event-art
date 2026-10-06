import type { FinalInvoiceItemInput } from './createFinalInvoice';
import { calculateFinalInvoice } from './finalInvoiceCalculation';

type SourceItem = Pick<FinalInvoiceItemInput, 'name' | 'quantity' | 'price_net' | 'vat_rate'> & {
  unit?: string | null;
  vat_code?: FinalInvoiceItemInput['vat_code'];
  vat_exemption_reason?: string | null;
  position_number?: number | null;
};

const cents = (value: number) => Math.round(value * 100);
const taxKey = (item: FinalInvoiceItemInput) => JSON.stringify([
  item.vat_rate,
  item.vat_code ?? String(item.vat_rate),
  item.vat_exemption_reason?.trim() || null,
]);

function normalize(items: readonly SourceItem[]): FinalInvoiceItemInput[] {
  return [...items]
    .sort((a, b) => Number(a.position_number ?? 0) - Number(b.position_number ?? 0))
    .map((item) => ({
      name: item.name,
      unit: item.unit || 'szt.',
      quantity: Number(item.quantity),
      price_net: Number(item.price_net),
      vat_rate: Number(item.vat_rate),
      vat_code: item.vat_code ?? String(item.vat_rate) as FinalInvoiceItemInput['vat_code'],
      vat_exemption_reason: item.vat_exemption_reason ?? null,
    }));
}

function valid(items: readonly FinalInvoiceItemInput[]) {
  return items.length > 0 && items.every((item) => item.name.trim()
    && Number.isFinite(item.quantity) && item.quantity > 0
    && cents(item.quantity) / 100 === item.quantity
    && Number.isFinite(item.price_net) && item.price_net >= 0
    && Number.isFinite(item.vat_rate) && item.vat_rate >= 0);
}

function groupTotals(items: readonly FinalInvoiceItemInput[]) {
  const groups = new Map<string, { net: number; vat: number; gross: number }>();
  for (const item of items) {
    const key = taxKey(item);
    const totals = calculateFinalInvoice([item], []).totals;
    const group = groups.get(key) || { net: 0, vat: 0, gross: 0 };
    groups.set(key, {
      net: group.net + cents(totals.net),
      vat: group.vat + cents(totals.vat),
      gross: group.gross + cents(totals.gross),
    });
  }
  return groups;
}

function sameAmounts(left: readonly FinalInvoiceItemInput[], right: readonly FinalInvoiceItemInput[]) {
  const expected = groupTotals(right);
  const actual = groupTotals(left);
  return expected.size === actual.size && [...expected].every(([key, totals]) => {
    const value = actual.get(key);
    return value && value.net === totals.net && value.vat === totals.vat && value.gross === totals.gross;
  });
}

/** Invoice wording is independent of the accepted event's full financial value. */
export function inheritFinalInvoicePresentation({ invoiceItems, fullOrderItems, snapshotItems }: {
  invoiceItems: readonly SourceItem[];
  fullOrderItems: readonly SourceItem[];
  snapshotItems?: readonly SourceItem[] | null;
}): { items: FinalInvoiceItemInput[] | null; error: string | null } {
  const presentation = normalize(invoiceItems);
  const fullOrder = normalize(fullOrderItems);
  const failure = (error: string) => ({ items: null, error });
  if (!valid(presentation) || !valid(fullOrder)) {
    return failure('Nie można odtworzyć pozycji zaliczki lub pełnej wartości zamówienia. Sprawdź dane źródłowe albo jawnie wybierz pozycje pełnego zamówienia.');
  }

  const snapshot = normalize(snapshotItems || []);
  const matchingSnapshot = valid(snapshot) && snapshot.length === presentation.length
    && presentation.every((item, index) => {
      const saved = snapshot[index];
      return item.name === saved.name && item.unit === saved.unit
        && item.quantity === saved.quantity && taxKey(item) === taxKey(saved);
    });
  if (matchingSnapshot && sameAmounts(snapshot, fullOrder)) return { items: snapshot, error: null };
  if (sameAmounts(presentation, fullOrder)) return { items: presentation, error: null };

  const presentationGroups = groupTotals(presentation);
  const fullGroups = groupTotals(fullOrder);
  if (presentationGroups.size !== 1 || fullGroups.size !== 1
    || [...presentationGroups.keys()][0] !== [...fullGroups.keys()][0]) {
    return failure('Nazwy pozycji pochodzą z zaliczki, ale ich podział VAT nie pozwala jednoznacznie przenieść pełnych kwot zamówienia. Wybierz jawnie pozycje źródłowego zamówienia zamiast zmieniać stawki VAT automatycznie.');
  }

  const target = calculateFinalInvoice(fullOrder, []).totals;
  const weights = presentation.map((item) => cents(calculateFinalInvoice([item], []).totals.net));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (weightTotal <= 0 || target.net <= 0) {
    return failure('Brakuje pełnej, dodatniej wartości zamówienia potrzebnej do przeliczenia pozycji zaliczki. Sama kwota zaliczki nie jest wartością całej usługi.');
  }
  const shares = weights.map((weight, index) => {
    const exact = cents(target.net) * weight / weightTotal;
    return { index, netCents: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = cents(target.net) - shares.reduce((sum, share) => sum + share.netCents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining <= 0) break;
    share.netCents += 1;
    remaining -= 1;
  }
  const inherited = presentation.map((item, index) => ({
    ...item,
    price_net: cents(shares[index].netCents / 100 / item.quantity) / 100,
  }));
  if (inherited.some((item, index) => cents(item.quantity * item.price_net) !== shares[index].netCents)
    || !sameAmounts(inherited, fullOrder)) {
    return failure('Nie można zachować jednocześnie pozycji zaliczki, ich ilości i dokładnych kwot netto, VAT oraz brutto pełnego zamówienia. Nie dodano różnic groszowych. Wybierz jawnie pozycje pełnego zamówienia.');
  }
  return { items: inherited, error: null };
}
