import type { SellerArrangements } from './arrangements';
import { buildSellerEventSchedule, hasLegacySellerEventRange, sellerEventDaysFrom, validSellerDay } from './eventSchedule';

export type SellerReviewContext = {
  key: string;
  date_error: string | null;
  past_date: boolean;
};

// Only facts that affect the assessment. Contacts, installation, materials and
// notes are preparation details; changing them must not reset the decision form.
export function sellerReviewFacts(sourceKey: string, arrangements: SellerArrangements) {
  const values = arrangements.values;
  return {
    source_key: sourceKey,
    event_date: arrangements.offer.event_date || null,
    event_days: values.event_days || [],
    starts_at: values.starts_at || null,
    ends_at: values.ends_at || null,
    room: values.room || '',
    location: arrangements.offer.location || '',
    venue: values.venue_snapshot ? {
      organization_id: values.venue_snapshot.organization_id,
      location_id: values.venue_snapshot.location_id,
      room_id: values.venue_snapshot.room.id,
    } : null,
    participant_count: values.participant_count ?? null,
    base_net: arrangements.offer.base_net ?? null,
    client_net: arrangements.offer.client_net ?? null,
  };
}

export function sellerReviewDate(arrangements: SellerArrangements, now = new Date()) {
  const date = String(arrangements.offer.event_date || '').slice(0, 10);
  if (!validSellerDay(date)) return { date_error: 'Brakuje poprawnej daty wydarzenia. Poproś sprzedawcę o uzupełnienie oferty.', past_date: false };
  const legacy = hasLegacySellerEventRange(arrangements.values);
  const schedule = buildSellerEventSchedule(sellerEventDaysFrom(arrangements.values, date));
  if (!legacy && schedule.error) return { date_error: schedule.error, past_date: false };
  const firstDay = legacy ? arrangements.values.starts_at?.slice(0, 10) : schedule.days[0]?.date;
  if (firstDay && firstDay !== date) {
    return { date_error: 'Data oferty różni się od harmonogramu. Poproś sprzedawcę o uzgodnienie terminu i nowy PDF.', past_date: false };
  }
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value || '';
  const today = [part('year'), part('month'), part('day')].join('-');
  return { date_error: null, past_date: date < today };
}
