import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';

export async function fetchCalendarEventsServer() {
  const supabase = createSupabaseServerClient(cookies());

  // Opcjonalnie: upewnij się, że jest user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

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
        employee:employees!employee_assignments_employee_id_fkey(
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