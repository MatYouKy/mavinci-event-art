import CalendarMain from '@/components/crm/Calendar/CalendarMain';
import { fetchCalendarEventsServer } from '@/lib/CRM/calendar/fetchCalendarEvents';

export default async function CalendarPage() {
  const initialCalendarEvents = await fetchCalendarEventsServer();

  return <CalendarMain initialCalendarEvents={initialCalendarEvents} />;
}