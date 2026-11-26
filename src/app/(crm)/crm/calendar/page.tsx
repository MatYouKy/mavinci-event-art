import { redirect } from 'next/navigation';
import CalendarMain from '@/components/crm/Calendar/CalendarMain';
import { fetchCalendarEventsServer } from '@/lib/CRM/calendar/fetchCalendarEvents';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export default async function CalendarPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  // Starsze powiadomienia i odnośniki (`/crm/calendar?meeting=<id>`) — szczegóły spotkania na stronie Spotkań.
  const meeting = typeof searchParams?.meeting === 'string' ? searchParams.meeting : null;
  if (meeting && UUID.test(meeting)) redirect(`/crm/meetings?meetingId=${meeting}`);

  const initialCalendarEvents = await fetchCalendarEventsServer();

  return <CalendarMain initialCalendarEvents={initialCalendarEvents} />;
}