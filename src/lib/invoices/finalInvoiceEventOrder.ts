import { supabase } from '@/lib/supabase/browser';
import { getAcceptedCalculationInvoicePrefill, getAcceptedOfferInvoicePrefill } from '@/lib/invoices/acceptedOfferPrefill';
import type { FinalInvoiceItemInput } from '@/lib/invoices/createFinalInvoice';

export interface FinalInvoiceEventOrder {
  items: FinalInvoiceItemInput[];
  eventName: string;
  eventIds: string[];
  currencyCode: string;
  myCompanyId: string | null;
  sourceLabel: string;
  notice: string;
}

type SourceRow = Record<string, any>;
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function sourceCurrency(source: SourceRow) {
  // Offers and event calculations use PLN unless the source explicitly stores
  // another currency. Never relabel their numbers with the advance's currency.
  const stored = source.currency_code ?? source.currency ?? 'PLN';
  if (typeof stored !== 'string' || !/^[A-Z]{3}$/.test(stored.trim().toUpperCase())) {
    throw new Error('Źródło cen wydarzenia ma nieprawidłową walutę. Popraw ją przed wystawieniem faktury końcowej.');
  }
  return stored.trim().toUpperCase();
}

function payerId(event: SourceRow, group: SourceRow | null) {
  const arrangement = group?.billing_arrangement || event.billing_arrangement || 'direct';
  return arrangement === 'direct'
    ? event.organization_id || null
    : group?.billing_organization_id || event.billing_organization_id || null;
}

/** Full agreed scope, never the reduced lines of an advance or catalogue prices. */
export async function loadFinalInvoiceEventOrder(eventId: string): Promise<FinalInvoiceEventOrder> {
  const { data: membership, error: membershipError } = await supabase
    .from('event_settlement_group_members')
    .select('group_id')
    .eq('event_id', eventId)
    .maybeSingle();
  if (membershipError) throw new Error('Nie udało się odczytać wspólnego rozliczenia wydarzenia. Spróbuj ponownie.');

  let group: SourceRow | null = null;
  let eventIds = [eventId];
  if (membership?.group_id) {
    const { data, error } = await supabase
      .from('event_settlement_groups')
      .select('id,name,primary_event_id,billing_arrangement,billing_organization_id,status')
      .eq('id', membership.group_id)
      .maybeSingle();
    if (error || !data) throw new Error('Nie udało się odczytać grupy rozliczeniowej wydarzenia.');
    if (data.status === 'active') {
      group = data;
      const { data: members, error: membersError } = await supabase
        .from('event_settlement_group_members')
        .select('event_id')
        .eq('group_id', data.id);
      if (membersError || !members?.length) throw new Error('Nie udało się odczytać wydarzeń wspólnego rozliczenia.');
      eventIds = [...new Set(members.map((member) => member.event_id as string))];
      if (!eventIds.includes(eventId) || !eventIds.includes(data.primary_event_id)) {
        throw new Error('Powiązania wspólnego rozliczenia są niepełne. Sprawdź je w wydarzeniu.');
      }
    }
  }

  const { data: rows, error: eventsError } = await supabase
    .from('events')
    .select('*')
    .in('id', eventIds)
    .order('event_date', { ascending: true });
  if (eventsError || !rows || rows.length !== eventIds.length) {
    throw new Error('Nie udało się odczytać wszystkich powiązanych wydarzeń. Nie pobrano częściowej wartości zamówienia.');
  }
  const events = rows as SourceRow[];
  const primaryEvent = events.find((event) => event.id === (group?.primary_event_id || eventId));
  if (!primaryEvent) throw new Error('Nie odnaleziono głównego wydarzenia rozliczenia.');
  const expectedPayer = payerId(primaryEvent, group);
  if (events.some((event) => payerId(event, group) !== expectedPayer)) {
    throw new Error('Wydarzenia wspólnego rozliczenia mają różnych nabywców. Sprawdź sposób rozliczenia wydarzeń.');
  }

  const prepared = await Promise.all(events.map(async (event) => {
    let source: SourceRow;
    let prefill: ReturnType<typeof getAcceptedOfferInvoicePrefill> | ReturnType<typeof getAcceptedCalculationInvoicePrefill>;
    let label: string;
    if (event.financial_source === 'calculation') {
      if (!event.accepted_calculation_id) {
        throw new Error(`Wydarzenie „${event.name}” nie ma wybranej zaakceptowanej kalkulacji. Uzupełnij źródło cen w wydarzeniu.`);
      }
      const { data, error } = await supabase
        .from('event_calculations')
        .select('*,event_calculation_items(name,quantity,unit,unit_price,days,vat_rate,position)')
        .eq('id', event.accepted_calculation_id)
        .eq('event_id', event.id)
        .eq('is_accepted', true)
        .maybeSingle();
      if (error || !data) throw new Error(`Nie odczytano zaakceptowanej kalkulacji wydarzenia „${event.name}”. Sprawdź źródło cen w wydarzeniu.`);
      source = data;
      prefill = getAcceptedCalculationInvoicePrefill(data);
      label = `Kalkulacja: ${data.name}`;
    } else {
      const { data: financialRows, error: financialError } = await supabase.rpc('get_event_financial_info', { p_event_id: event.id });
      if (financialError) throw new Error(`Nie udało się odczytać uzgodnionych cen wydarzenia „${event.name}”.`);
      const financialInfo = financialRows?.[0];
      if (!financialInfo?.accepted_offer_id) {
        throw new Error(`Wydarzenie „${event.name}” nie ma zaakceptowanej oferty. Zaakceptuj właściwą ofertę lub kalkulację w wydarzeniu.`);
      }
      const { data, error } = await supabase
        .from('offers')
        .select('*,offer_items(name,quantity,unit,unit_price,discount_percent,total,display_order)')
        .eq('id', financialInfo.accepted_offer_id)
        .eq('event_id', event.id)
        .eq('status', 'accepted')
        .maybeSingle();
      if (error || !data) throw new Error(`Nie odczytano zaakceptowanej oferty wydarzenia „${event.name}”. Sprawdź źródło cen w wydarzeniu.`);
      source = data;
      prefill = getAcceptedOfferInvoicePrefill(data, event.name || '');
      label = `Oferta ${data.offer_number || financialInfo.accepted_offer_number || ''}`.trim();
    }

    const currencyCode = sourceCurrency(source);
    if ((event.currency_code || event.currency) && sourceCurrency(event) !== currencyCode) {
      throw new Error(`Waluta wydarzenia „${event.name}” różni się od waluty jego uzgodnionych cen.`);
    }
    if (event.my_company_id && source.my_company_id && event.my_company_id !== source.my_company_id) {
      throw new Error(`Wydarzenie „${event.name}” i jego źródło cen wskazują różne firmy wystawiające fakturę.`);
    }
    const calculatedNet = money(prefill.items.reduce((sum, item) => sum + money(item.quantity * item.price_net), 0));
    const calculatedVat = money(prefill.items.reduce((sum, item) => sum + money(money(item.quantity * item.price_net) * item.vat_rate / 100), 0));
    if (calculatedNet !== prefill.totals.net || calculatedVat !== prefill.totals.taxAmount
      || money(calculatedNet + calculatedVat) !== prefill.totals.gross) {
      throw new Error(`Kwoty pozycji wydarzenia „${event.name}” nie odpowiadają jego uzgodnionemu podsumowaniu. Popraw źródło cen w wydarzeniu.`);
    }
    return {
      ...prefill,
      label,
      currencyCode,
      myCompanyId: (event.my_company_id || source.my_company_id || null) as string | null,
    };
  }));

  const currencies = new Set(prepared.map((entry) => entry.currencyCode));
  const companies = new Set(prepared.map((entry) => entry.myCompanyId).filter((id): id is string => Boolean(id)));
  if (currencies.size !== 1 || companies.size > 1) {
    throw new Error('Wspólne rozliczenie obejmuje różne waluty lub firmy wystawiające fakturę. Nie można połączyć tych kwot.');
  }
  const items: FinalInvoiceItemInput[] = prepared.flatMap((entry) => entry.items.map((item) => ({
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    price_net: item.price_net,
    vat_rate: item.vat_rate,
    vat_code: item.vat_code,
  })));
  if (!items.length || money(prepared.reduce((sum, entry) => sum + entry.totals.gross, 0)) <= 0) {
    throw new Error('Pełna wartość zamówienia wydarzenia musi być większa od zera. Uzupełnij zaakceptowane źródło cen.');
  }
  return {
    items,
    eventName: group?.name || primaryEvent.name || 'Powiązane wydarzenie',
    eventIds,
    currencyCode: prepared[0].currencyCode,
    myCompanyId: [...companies][0] || null,
    sourceLabel: prepared.map((entry) => entry.label).join(' · '),
    notice: [...new Set(prepared.map((entry) => entry.notice).filter(Boolean))].join(' '),
  };
}
