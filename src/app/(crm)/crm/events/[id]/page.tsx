import RealizationWorkspace from '@/components/crm/events/RealizationWorkspace';
import { getOfferPricingTotals } from '@/lib/CRM/Offers/offerTotals';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getCookieStore } from '@/lib/CRM/events/eventsIdData.server';
// src/app/(crm)/crm/events/[id]/page.tsx
import { fetchEventByIdServer } from '@/lib/CRM/events/eventsIdData.server';
import EventDetailPageClient from './EventDetailPageClient';
import type { IEvent, IOffer } from '../type';
import { getLocationById } from '@/lib/CRM/locations/getLocationById';
import { getContactById } from '@/lib/CRM/client/getContactById';
import type { UUID } from '../../contacts/types';
import { fetchEventOffersServer } from '@/lib/CRM/Offers/fetchEventOffers.server';
import { fetchEventCategoriesServer } from '@/lib/CRM/events/eventsData.server';
import { EventWorkspaceProvider } from '@/components/crm/events/EventWorkspaceProvider';
import { notFound } from 'next/navigation';

export default async function EventPage({ params }: { params: { id: string } }) {
  const client = createSupabaseServerClient(getCookieStore());
  const { data: realization } = await client.rpc('get_realization_workspace', { p_event_id: params.id });
  if (realization?.operational_only) return <RealizationWorkspace initialData={realization} />;
  const event = await fetchEventByIdServer(params.id);

  if (!event) {
    notFound();
  }

  const location = await getLocationById(event.location_id);
  const contact = await getContactById(event.contact_person_id as UUID);
  const categories = await fetchEventCategoriesServer();
  const offers = await fetchEventOffersServer(params.id);

  const acceptedOffer = offers.find((offer) => offer.status === 'accepted');
  const updateEventsByOffers = {
    ...event,
    expected_revenue:
      event.financial_source === 'calculation'
        ? event.expected_revenue
        : acceptedOffer
          ? getOfferPricingTotals(acceptedOffer).gross
          : event.expected_revenue,
  };

  return (
    <EventWorkspaceProvider eventId={params.id}>
      <EventDetailPageClient
        categories={categories}
        initialData={updateEventsByOffers as unknown as IEvent}
        initialLocation={{
          id: location?.id,
          name: location?.name,
          formatted_address: location?.formatted_address,
          address: location?.address,
          city: location?.city,
          postal_code: location?.postal_code,
          google_maps_url: location?.google_maps_url,
        }}
        initialContact={{
          organization_name: contact?.organization_name,
          id: contact?.id,
          first_name: contact?.first_name,
          last_name: contact?.last_name,
          full_name: contact?.full_name,
          email: contact?.email,
          phone: contact?.phone,
          business_phone: contact?.business_phone,
          contact_type: contact?.contact_type,
        }}
        initialOffers={offers as unknown as IOffer[]}
      />
    </EventWorkspaceProvider>
  );
}
