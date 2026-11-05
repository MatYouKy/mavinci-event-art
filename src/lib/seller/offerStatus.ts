'use client';

import { supabase } from '@/lib/supabase/browser';
import { sellerStatusLabel } from './portal';

/** Row of get_seller_offer_delivery_states (review stage of a portal offer). */
export type SellerOfferDelivery = {
  offer_id: string;
  is_realization: boolean;
  review_status: string | null;
  client_confirmed: boolean;
};

export type SellerOfferStageTone = 'action' | 'waiting' | 'success' | 'danger' | 'neutral';
export type SellerOfferStage = {
  value: string;
  label: string;
  next: string;
  tone: SellerOfferStageTone;
  /** The seller is the one who has to act now. */
  needsAction: boolean;
};

/**
 * One dictionary of offer stages for the dashboard and the offer list.
 * The review stage (MAVINCI decision) wins over the raw offer status.
 */
export function sellerOfferStage(offer: { status: string }, delivery?: SellerOfferDelivery | null): SellerOfferStage {
  if (delivery?.is_realization || offer.status === 'accepted') {
    return { value: 'realization', label: 'Przekazana do realizacji', next: 'Dalsze ustalenia znajdziesz w zakładce „Potwierdzone wydarzenia”.', tone: 'success', needsAction: false };
  }
  switch (delivery?.review_status) {
    case 'pending':
      return { value: 'awaiting_mavinci', label: 'Oczekuje na MAVINCI', next: delivery.client_confirmed ? 'Klient zaakceptował ofertę. Czekamy na decyzję opiekuna.' : 'Oferta przekazana opiekunowi. Czekamy na jego decyzję.', tone: 'waiting', needsAction: false };
    case 'changes_requested':
      return { value: 'changes_requested', label: 'Do poprawy', next: 'Opiekun prosi o zmiany. Popraw ofertę i przekaż ją ponownie.', tone: 'action', needsAction: true };
    case 'rejected':
      return { value: 'review_rejected', label: 'Brak akceptacji MAVINCI', next: 'Sprawdź uzasadnienie opiekuna i ustal z nim dalsze kroki.', tone: 'danger', needsAction: true };
    case 'approved':
      return { value: 'approved', label: 'Zaakceptowana przez opiekuna', next: 'Czekamy na potwierdzenie wydarzenia. Otrzymasz powiadomienie.', tone: 'success', needsAction: false };
    default:
      break;
  }
  if (offer.status === 'draft') return { value: 'draft', label: 'Szkic', next: 'Przedstaw ofertę klientowi. Po jego zgodzie przekaż ją do MAVINCI.', tone: 'neutral', needsAction: true };
  if (offer.status === 'sent' || offer.status === 'viewed') {
    return { value: offer.status, label: sellerStatusLabel(offer.status), next: 'Po akceptacji klienta przekaż aktualną ofertę do potwierdzenia MAVINCI.', tone: 'neutral', needsAction: true };
  }
  if (offer.status === 'rejected') return { value: 'rejected', label: 'Odrzucona przez klienta', next: '', tone: 'neutral', needsAction: false };
  if (offer.status === 'expired') return { value: 'expired', label: 'Wygasła', next: 'Zaktualizuj termin ważności, jeśli klient nadal jest zainteresowany.', tone: 'neutral', needsAction: false };
  return { value: offer.status, label: sellerStatusLabel(offer.status), next: '', tone: 'neutral', needsAction: false };
}

export const sellerOfferStageFilters: { value: string; label: string }[] = [
  { value: 'all', label: 'Wszystkie etapy' },
  { value: 'draft', label: 'Szkice' },
  { value: 'sent', label: 'Wysłane' },
  { value: 'viewed', label: 'Wyświetlone' },
  { value: 'awaiting_mavinci', label: 'Oczekuje na MAVINCI' },
  { value: 'changes_requested', label: 'Do poprawy' },
  { value: 'review_rejected', label: 'Brak akceptacji MAVINCI' },
  { value: 'approved', label: 'Zaakceptowane przez opiekuna' },
  { value: 'rejected', label: 'Odrzucone przez klienta' },
];

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
