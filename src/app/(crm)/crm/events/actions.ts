'use server';
import { fetchEventsPageSnapshot } from '@/lib/CRM/events/eventsPageSnapshot.server';

export async function refreshEventsPage() {
  return fetchEventsPageSnapshot();
}
