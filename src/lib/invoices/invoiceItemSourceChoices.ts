import { supabase } from '@/lib/supabase/browser';
import { getAcceptedCalculationInvoicePrefill, getAcceptedOfferInvoicePrefill } from './acceptedOfferPrefill';

export type InvoiceItemSourceChoice = {
  id: 'calculation' | 'offer';
  label: string;
  items: ReturnType<typeof getAcceptedCalculationInvoicePrefill>['items'];
  net: number;
  gross: number;
  discount: number;
  notice: string;
};

/** Only accepted event documents are candidates; catalog prices are never a fallback. */
export async function loadInvoiceItemSourceChoices(eventId: string) {
  const [eventResult, financialResult] = await Promise.all([
    supabase.from('events').select('name,financial_source,accepted_calculation_id').eq('id', eventId).single(),
    supabase.rpc('get_event_financial_info', { p_event_id: eventId }),
  ]);
  if (eventResult.error || financialResult.error) {
    throw new Error('Nie udało się odczytać zaakceptowanych źródeł tego wydarzenia. Nie podstawiono cen.');
  }
  const event = eventResult.data;
  const financial = financialResult.data?.[0];
  const preferredId: InvoiceItemSourceChoice['id'] = event.financial_source === 'calculation' ? 'calculation' : 'offer';
  const results = await Promise.allSettled([
    (async (): Promise<InvoiceItemSourceChoice | null> => {
      if (!event.accepted_calculation_id) return null;
      const { data, error } = await supabase.from('event_calculations')
        .select('name,is_accepted,event_calculation_items(name,quantity,unit,unit_price,days,vat_rate,position)')
        .eq('id', event.accepted_calculation_id).eq('event_id', eventId).eq('is_accepted', true).maybeSingle();
      if (error || !data) throw new Error('Nie można odczytać zaakceptowanej kalkulacji.');
      const prepared = getAcceptedCalculationInvoicePrefill(data);
      return { id: 'calculation', label: `Kalkulacja: ${data.name}`, items: prepared.items,
        net: prepared.totals.net, gross: prepared.totals.gross, discount: 0, notice: prepared.notice };
    })(),
    (async (): Promise<InvoiceItemSourceChoice | null> => {
      if (!financial?.accepted_offer_id) return null;
      const { data, error } = await supabase.from('offers')
        .select('status,offer_number,subtotal,discount_amount,discount_percent,tax_percent,tax_amount,total_amount,offer_items(name,quantity,unit,unit_price,discount_percent,total,display_order)')
        .eq('id', financial.accepted_offer_id).eq('event_id', eventId).eq('status', 'accepted').maybeSingle();
      if (error || !data) throw new Error('Nie można odczytać zaakceptowanej oferty.');
      const prepared = getAcceptedOfferInvoicePrefill(data, event.name || '');
      return { id: 'offer', label: `Oferta ${data.offer_number || financial.accepted_offer_number || ''}`.trim(),
        items: prepared.items, net: prepared.totals.net, gross: prepared.totals.gross,
        discount: prepared.totals.discountAmount, notice: prepared.notice };
    })(),
  ]);
  const choices: InvoiceItemSourceChoice[] = [];
  const warnings: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) choices.push(result.value);
    if (result.status === 'rejected') warnings.push(result.reason instanceof Error ? result.reason.message : 'Nie udało się odczytać źródła pozycji.');
  }
  if (!choices.some((choice) => choice.id === preferredId)) {
    warnings.push('Brak dostępnego zaakceptowanego źródła finansowego wydarzenia. Wybierz świadomie inne dostępne źródło albo wprowadź pozycje ręcznie.');
  }
  return { choices, preferredId, warning: warnings.join(' '), eventName: event.name || '' };
}
