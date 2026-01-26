// src/app/(crm)/crm/events/[id]/page.tsx
import { fetchEventByIdServer } from '@/lib/CRM/events/eventsIdData.server';
import EventDetailPageClient from './EventDetailPageClient';
import { IEvent, IOffer } from '../type';
import { getLocationById } from '@/lib/CRM/locations/getLocationById';
import { getContactById } from '@/lib/CRM/client/getContactById';
import { UUID } from '../../contacts/types';
import { fetchEventOffersServer } from '@/lib/CRM/Offers/fetchEventOffers.server';

export default async function EventPage({ params }: { params: { id: string } }) {
  const event = await fetchEventByIdServer(params.id);
  const location = await getLocationById(event.location_id) ;
  const contact = await getContactById(event.contact_person_id as UUID);

  const offers = await fetchEventOffersServer(params.id);

  const updateEventsByOffers = {
    ...event,
    expected_revenue: offers.reduce((acc, offer) => acc + offer.total_amount, 0),
  }

  return <EventDetailPageClient initialEvent={updateEventsByOffers as unknown as IEvent} initialLocation={{
    id: location?.id,
    name: location?.name,
    formatted_address: location?.formatted_address,
    address: location?.address,
    city: location?.city,
    postal_code: location?.postal_code,
    google_maps_url: location?.google_maps_url,
  }} initialContact={{
    organization_name: contact?.organization_name,
    id: contact?.id,
    first_name: contact?.first_name,
    last_name: contact?.last_name,
    full_name: contact?.full_name,
    email: contact?.email,
    phone: contact?.phone,
    business_phone: contact?.business_phone,
    contact_type: contact?.contact_type,
  }} initialOffers={offers as unknown as IOffer[]} />;
}