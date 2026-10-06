type OfferSourceInput = {
  inquiry_id?: string | null;
  event_id?: string | null;
  inquiry?: { event_id?: string | null } | null;
};

/** Keep the original inquiry as the source even after it becomes an event. */
export function offerSource(offer: OfferSourceInput) {
  if (offer.inquiry_id) {
    return { kind: 'inquiry' as const, href: `/crm/inquiries/${offer.inquiry_id}`, actionLabel: 'Otwórz zapytanie' };
  }
  const eventId = offer.event_id || offer.inquiry?.event_id;
  return eventId
    ? { kind: 'event' as const, href: `/crm/events/${eventId}`, actionLabel: 'Otwórz wydarzenie' }
    : null;
}
