import { fetchEventsInitialServer, fetchEventCategoriesServer } from '@/lib/CRM/events/eventsData.server';
import EventsPageClient from './EventsPageClient';
import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';


export default async function EventsPage() {
  const initialEvents = await fetchEventsInitialServer();
  const currentEmployee = await getCurrentEmployeeServerCached();
  return <EventsPageClient initialData={initialEvents} currentEmployee={currentEmployee} />;
}