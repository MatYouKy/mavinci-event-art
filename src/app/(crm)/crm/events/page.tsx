import { fetchEventsInitialServer, fetchEventCategoriesServer } from '@/lib/CRM/events/eventsData.server';
import EventsPageClient from './EventsPageClient';


export default async function EventsPage() {
  const [initialEvents, initialCategories] = await Promise.all([
    fetchEventsInitialServer(),
    fetchEventCategoriesServer(),
  ]);

  console.log('initialEvents', initialEvents);

  return <EventsPageClient initialEvents={initialEvents} initialCategories={initialCategories} />;
}