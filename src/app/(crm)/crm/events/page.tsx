import { fetchEventsPageSnapshot } from '@/lib/CRM/events/eventsPageSnapshot.server';
import EventsPageClient from './EventsPageClient';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';

export default async function EventsPage() {
  const [initialData, currentEmployee] = await Promise.all([
    fetchEventsPageSnapshot(), getCurrentEmployeeServerCached(),
  ]);
  return <EventsPageClient initialData={initialData} currentEmployee={currentEmployee} />;
}
