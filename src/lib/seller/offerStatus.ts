'use client';

import { supabase } from '@/lib/supabase/browser';
import { SELLER_JOURNEY_FILTERS, sellerJourney, sellerJourneyMatches, type SellerJourney, type SellerJourneyTone } from './offerJourney';

/** Row of get_seller_offer_delivery_states (review stage of a portal offer). */
export type SellerOfferDelivery = {
  offer_id: string;
  is_realization: boolean;
  review_status: string | null;
  client_confirmed: boolean;
  /** Od migracji 20261114230000: offers.partner_approval_status i ostatnia prośba o zgodę na cenę. */
  approval_status?: string | null;
  price_request?: string | null;
};

export type SellerOfferStageTone = SellerJourneyTone;
export type SellerOfferStage = {
  /** Klucz etapu osi (offer, client, manager, event, settlement). */
  value: string;
  /** Stan wewnątrz etapu, np. „Do poprawy”. */
  label: string;
  /** Zdanie „Teraz”. */
  next: string;
  tone: SellerOfferStageTone;
  /** The seller is the one who has to act now. */
  needsAction: boolean;
  journey: SellerJourney;
};

/**
 * Etap oferty na wspólnej osi (src/lib/seller/offerJourney.ts) dla pulpitu i listy ofert.
 * Decyzja opiekuna wygrywa nad surowym statusem oferty.
 */
export function sellerOfferStage(
  offer: { status: string; partner_approval_status?: string | null },
  delivery?: SellerOfferDelivery | null,
  extra: { hasPdf?: boolean; managerName?: string | null } = {},
): SellerOfferStage {
  const journey = sellerJourney({
    offerStatus: offer.status,
    reviewStatus: delivery?.review_status || null,
    clientConfirmed: delivery?.client_confirmed,
    isRealization: delivery?.is_realization,
    priceApprovalRequired: (delivery?.approval_status ?? offer.partner_approval_status) === 'required',
    priceRequest: (delivery?.approval_status ?? offer.partner_approval_status) !== 'required' ? null
      : delivery?.price_request === 'pending' ? 'pending'
      : delivery?.price_request === 'changes_requested' ? 'changes_requested'
      : delivery && 'price_request' in delivery ? 'missing' : null,
    hasPdf: extra.hasPdf,
  }, { viewer: 'seller', managerName: extra.managerName });
  return { value: journey.key, label: journey.state, next: journey.now, tone: journey.tone, needsAction: journey.needsAction, journey };
}

export const sellerOfferStageFilters = SELLER_JOURNEY_FILTERS;
export const sellerOfferStageMatches = (stage: SellerOfferStage, filter: string) => sellerJourneyMatches(stage.journey, filter);

export const sellerOfferToneClass: Record<SellerOfferStageTone, string> = {
  action: 'bg-amber-300/10 text-amber-200',
  waiting: 'bg-sky-300/10 text-sky-200',
  success: 'bg-emerald-300/10 text-emerald-200',
  danger: 'bg-rose-300/10 text-rose-200',
  neutral: 'bg-white/5 text-white/60',
};

/** Loads review stages in batches; a failure returns an error, never empty stages silently. */
export async function loadSellerOfferDeliveries(offerIds: string[]): Promise<{ deliveries: Map<string, SellerOfferDelivery>; error: string }> {
  const deliveries = new Map<string, SellerOfferDelivery>();
  for (let offset = 0; offset < offerIds.length; offset += 200) {
    const response = await supabase.rpc('get_seller_offer_delivery_states', { p_offers: offerIds.slice(offset, offset + 200) });
    if (response.error) return { deliveries, error: 'Nie udało się wczytać etapów akceptacji. Otwórz ofertę, aby sprawdzić aktualną decyzję.' };
    for (const row of (response.data || []) as SellerOfferDelivery[]) deliveries.set(row.offer_id, row);
  }
  return { deliveries, error: '' };
}

/**
 * Które oferty mają zapisany PDF (etap „Oferta” vs „U klienta”).
 * Błąd odczytu zwraca null — wtedy oś nie zgaduje i zostaje przy ogólnym opisie.
 */
export async function loadSellerOfferPdfs(offerIds: string[]): Promise<Set<string> | null> {
  const withPdf = new Set<string>();
  // Kilka wersji PDF na ofertę: małe paczki, aby nie dojść do limitu wierszy odpowiedzi.
  for (let offset = 0; offset < offerIds.length; offset += 50) {
    const response = await supabase.from('seller_offer_documents').select('offer_id').in('offer_id', offerIds.slice(offset, offset + 50));
    if (response.error) return null;
    for (const row of (response.data || []) as { offer_id: string }[]) withPdf.add(row.offer_id);
  }
  return withPdf;
}
