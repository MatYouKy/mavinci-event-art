type OfferSourceInput = {
  inquiry_id?: string | null;
  event_id?: string | null;
  inquiry?: { event_id?: string | null } | null;
};

/** Once realization exists, it is the primary destination; the inquiry remains accessible separately. */
export function offerSource(offer: OfferSourceInput) {
  const eventId = offer.event_id || offer.inquiry?.event_id;
  if (eventId) {
    return { kind: 'event' as const, href: `/crm/events/${eventId}`, actionLabel: 'Otwórz wydarzenie' };
  }
  return offer.inquiry_id
    ? { kind: 'inquiry' as const, href: `/crm/inquiries/${offer.inquiry_id}`, actionLabel: 'Otwórz zapytanie' }
    : null;
}
