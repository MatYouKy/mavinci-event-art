import 'server-only';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventTab } from './eventTabs';
import { fetchEventOffersServer } from '@/lib/CRM/Offers/fetchEventOffers.server';
import { getOfferPricingTotals } from '@/lib/CRM/Offers/offerTotals';

/**
 * Zakładka „Oferta” (`EventTabOffer`): oferty wydarzenia z wartościami brutto / netto (`getOfferPricingTotals`), status
 * wydarzenia (przycisk „Wyślij ofertę” przy „Oferta do wysłania”) i usuwanie oferty jak `deleteEventOffer` (z weryfikacją).
 */

function fail(message: string): never {
  throw new Error(message);
}

async function offerTab(ctx: NativeContext, eventId: string) {
  const [offers, event] = await Promise.all([
    fetchEventOffersServer(ctx.supabase, eventId),
    ctx.supabase.from('events').select('status').eq('id', eventId).maybeSingle(),
  ]);
  return {
    isAdmin: ctx.employee.isAdmin,
    eventStatus: (event.data as any)?.status || 'inquiry',
    offers: (offers as any[]).map((offer) => {
      const totals = getOfferPricingTotals(offer);
      const contact = offer.contact || {};
      const client = contact.full_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
        || offer.organization?.alias || offer.organization?.name || 'Brak klienta';
      return {
        id: offer.id, number: offer.offer_number || null, status: offer.status || 'draft', client,
        gross: Number(totals.gross || 0), net: Number(totals.net || 0), validUntil: offer.valid_until ?? null,
        createdAt: offer.created_at ?? null, updatedAt: offer.updated_at ?? null, notes: offer.notes ?? null,
      };
    }),
  };
}

registerEventTab('offer', offerTab);

/** `handleDeleteOffer` + `deleteEventOffer`: tylko szkic / wysłana / odrzucona, potem sprawdzenie, że oferty już nie ma. */
async function remove(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const id = String(body.offerId || '');
  const { data: offer } = await ctx.supabase.from('offers').select('id,status').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (!offer || !['draft', 'sent', 'rejected'].includes(String((offer as any).status))) fail('Nie można usunąć tej oferty w tym statusie.');
  const { error } = await ctx.supabase.from('offers').delete().eq('id', id);
  if (error) {
    const message = error.message || '';
    if (message.includes('policy') || message.includes('uprawnienia')) fail('Nie masz uprawnień do usunięcia tej oferty');
    if (message.includes('status') || message.includes('draft/sent') || message.includes('tylko draft') || message.includes('Nie można usunąć tej oferty')) {
      fail('Nie można usunąć tej oferty. Usuwać można tylko oferty w statusie draft lub sent.');
    }
    fail(message || 'Błąd podczas usuwania oferty');
  }
  const { data: existing } = await ctx.supabase.from('offers').select('id').eq('id', id).maybeSingle();
  if (existing) fail('Oferta nie została usunięta. Najpewniej blokuje to policy RLS albo trigger bazy danych.');
  return { ok: true };
}

registerEventActions('offer', { delete: remove });
