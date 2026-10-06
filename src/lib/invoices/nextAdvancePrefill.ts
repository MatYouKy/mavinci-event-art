import { supabase } from '@/lib/supabase/browser';

export interface AdvanceOrderLine {
  position_number: number;
  name: string;
  unit: string;
  quantity: number;
  price_net: number;
  vat_rate: number;
  vat_code: string;
  vat_exemption_reason?: string;
}

export interface NextAdvanceContext {
  source: Record<string, any>;
  orderItems: AdvanceOrderLine[];
  orderGross: number;
  reservedGross: number;
  remainingGross: number;
}

const money = (value: number) => Math.round(value * 100) / 100;

/** Follow document relations only: the same buyer or event does not identify an order. */
export async function getNextAdvanceContext(sourceId: string): Promise<NextAdvanceContext> {
  const readInvoice = async (id: string) => {
    const { data, error } = await supabase
      .from('invoices')
      .select('*, invoice_order_items(*)')
      .eq('id', id)
      .single();
    if (error || !data) throw new Error('Nie udało się odczytać dokumentu źródłowego zaliczki.');
    return data;
  };

  const source = await readInvoice(sourceId);
  if (source.invoice_type !== 'advance' || ['draft', 'cancelled', 'proforma'].includes(source.status)) {
    throw new Error('Kolejną zaliczkę można przygotować na podstawie wystawionej faktury zaliczkowej.');
  }

  const ancestors = [source];
  const visited = new Set<string>([source.id]);
  let root = source;
  while (root.related_invoice_id) {
    if (visited.has(root.related_invoice_id) || ancestors.length >= 100) {
      throw new Error('Nie można jednoznacznie ustalić powiązań zamówienia.');
    }
    const parent = await readInvoice(root.related_invoice_id);
    if (!['advance', 'proforma'].includes(parent.invoice_type)) break;
    visited.add(parent.id);
    ancestors.push(parent);
    root = parent;
  }

  // An advance's invoice_items contain only the deposit, never the full order.
  const orderSource = ancestors.find((invoice) => invoice.invoice_order_items?.length > 0);
  if (!orderSource) {
    throw new Error('Brak zapisanych pozycji pełnego zamówienia. Uzupełnij zamówienie przed przygotowaniem kolejnej zaliczki.');
  }
  const orderItems = [...orderSource.invoice_order_items]
    .sort((a, b) => a.position_number - b.position_number)
    .map((item, index) => ({
      position_number: index + 1,
      name: item.name,
      unit: item.unit || 'szt.',
      quantity: Number(item.quantity),
      price_net: Number(item.price_net),
      vat_rate: Number(item.vat_rate),
      vat_code: item.vat_code || String(item.vat_rate),
      vat_exemption_reason: item.vat_exemption_reason || undefined,
    }));
  if (orderItems.some((item) => !item.name || !Number.isFinite(item.quantity)
      || item.quantity <= 0 || !Number.isFinite(item.price_net) || item.price_net < 0
      || !Number.isFinite(item.vat_rate))) {
    throw new Error('Zapisane zamówienie zawiera niepełne pozycje. Uzupełnij je przed przygotowaniem zaliczki.');
  }
  const orderGross = money(orderItems.reduce((sum, item) => {
    const net = money(item.quantity * item.price_net);
    return sum + net + money(net * item.vat_rate / 100);
  }, 0));
  if (orderGross <= 0) throw new Error('Pełna wartość zamówienia musi być większa od zera.');

  const chain = new Map<string, Record<string, any>>([[root.id, root]]);
  let frontier = [root.id];
  while (frontier.length > 0) {
    const { data, error } = await supabase
      .from('invoices')
      .select('id,invoice_type,status,related_invoice_id,my_company_id,organization_id,buyer_contact_id,buyer_name,buyer_nip,buyer_is_private_person,currency_code,total_gross')
      .in('related_invoice_id', frontier);
    if (error) throw new Error('Nie udało się sprawdzić wcześniejszych zaliczek tego zamówienia.');
    frontier = [];
    for (const invoice of data || []) {
      if (chain.has(invoice.id)) continue;
      chain.set(invoice.id, invoice);
      frontier.push(invoice.id);
    }
    if (chain.size > 500) throw new Error('Zbyt wiele powiązań dokumentów. Nie można bezpiecznie ustalić salda zamówienia.');
  }

  const advances = [...chain.values()].filter((invoice) => invoice.invoice_type === 'advance' && invoice.status !== 'cancelled');
  const currency = source.currency_code || 'PLN';
  const incompatible = advances.some((invoice) => invoice.my_company_id !== source.my_company_id
    || (invoice.currency_code || 'PLN') !== currency
    || (invoice.organization_id || null) !== (source.organization_id || null)
    || Boolean(invoice.buyer_is_private_person) !== Boolean(source.buyer_is_private_person)
    || (source.buyer_is_private_person
      ? (invoice.buyer_contact_id || invoice.buyer_name) !== (source.buyer_contact_id || source.buyer_name)
      : (invoice.buyer_nip || '') !== (source.buyer_nip || '')));
  if (incompatible) throw new Error('Powiązane zaliczki mają różne dane nabywcy, sprzedawcy lub walutę. Sprawdź powiązania zamówienia.');

  const { data: settlements, error: settlementsError } = await supabase
    .from('invoice_settlements')
    .select('advance_invoice_id')
    .in('advance_invoice_id', advances.map((invoice) => invoice.id))
    .limit(1);
  if (settlementsError) throw new Error('Nie udało się sprawdzić rozliczenia wcześniejszych zaliczek.');
  if (settlements?.length || [...chain.values()].some((invoice) => invoice.invoice_type === 'vat' && invoice.status !== 'cancelled')) {
    throw new Error('To zamówienie ma już fakturę końcową. Otwórz jego powiązane dokumenty.');
  }

  const advanceIds = new Set(advances.map((invoice) => invoice.id));
  const corrections = [...chain.values()].filter((invoice) => invoice.invoice_type === 'corrective'
    && advanceIds.has(invoice.related_invoice_id)
    && !['draft', 'cancelled'].includes(invoice.status));
  const reservedGross = money([...advances, ...corrections].reduce((sum, invoice) => sum + Number(invoice.total_gross || 0), 0));
  if (!Number.isFinite(reservedGross) || reservedGross < 0) throw new Error('Nie można ustalić salda wcześniejszych zaliczek.');
  return { source, orderItems, orderGross, reservedGross, remainingGross: money(Math.max(0, orderGross - reservedGross)) };
}
