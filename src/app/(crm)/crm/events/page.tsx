import { fetchEventsInitialServer, fetchEventCategoriesServer } from '@/lib/CRM/events/eventsData.server';
import EventsPageClient from './EventsPageClient';
import { getEmployeePreferences } from '@/lib/CRM/employees/getEmployeePreferences';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';


export default async function EventsPage() {
  const [initialEvents, initialCategories, initialPreferences] = await Promise.all([
    fetchEventsInitialServer(),
    fetchEventCategoriesServer(),
    getCurrentEmployeeServerCached().then((employee) => getEmployeePreferences(employee?.id)),
  ]);


  return <EventsPageClient initialEvents={initialEvents} initialCategories={initialCategories} initialViewMode={initialPreferences?.events?.viewMode || 'list'} />;
}