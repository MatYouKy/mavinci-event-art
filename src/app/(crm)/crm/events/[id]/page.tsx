// src/app/(crm)/crm/events/[id]/page.tsx
import { fetchEventByIdServer } from '@/lib/CRM/events/eventsIdData.server';
import EventDetailPageClient from './EventDetailPageClient';
import EventPageClient from './EventDetailPageClient';
import { IEvent } from '../type';

export default async function EventPage({ params }: { params: { id: string } }) {
  const event = await fetchEventByIdServer(params.id);
  return <EventDetailPageClient initialEvent={event as unknown as IEvent} />;
}