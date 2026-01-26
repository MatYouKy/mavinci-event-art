import { fetchEventsInitialServer, fetchEventCategoriesServer } from '@/lib/CRM/events/eventsData.server';
import EventsPageClient from './EventsPageClient';


export default async function EventsPage() {
  const [initialEvents, initialCategories] = await Promise.all([
    fetchEventsInitialServer(),
    fetchEventCategoriesServer(),
  ]);

  return <EventsPageClient initialEvents={initialEvents} initialCategories={initialCategories} />;
}