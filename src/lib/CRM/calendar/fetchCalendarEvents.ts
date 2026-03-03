import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';

export async function fetchCalendarEventsServer() {
  const supabase = createSupabaseServerClient(cookies());

  // Opcjonalnie: upewnij się, że jest user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  // Dopasuj select do tego, co Twoje UI faktycznie czyta:
  // - event.organization?.name
  // - event.category?.name, color
  // - event.assigned_employees (jeśli używasz)
  // - meeting_data.meeting_participants (jeśli używasz)
  const { data, error } = await supabase
    .from('events')
    .select(
      `
      id,
      name,
      status,
      location,
      event_date,
      event_end_date,
      created_by,
      is_meeting,
      organization:organizations(
        id,
        name
      ),
      category:event_categories(
        id,
        name,
        color
      ),
      assigned_employees:employee_assignments(
        employee_id,
        invitation_status,
        employee:employees(
          id,
          name,
          surname,
          nickname
        )
      ),
      meeting_data:meetings(
        id,
        meeting_participants:meeting_participants(
          employee_id
        )
      )
    `,
    )
    .order('event_date', { ascending: true });

  if (error) {
    console.error('[fetchCalendarEventsServer] supabase error:', error);
    return [];
  }

  // 🔧 Normalizacja – żeby front miał prostszy kształt
  const normalized =
    (data || []).map((e: any) => ({
      ...e,
      assigned_employees: (e.assigned_employees || []).map((x: any) => x.employee),
    })) ?? [];

  return normalized;
}