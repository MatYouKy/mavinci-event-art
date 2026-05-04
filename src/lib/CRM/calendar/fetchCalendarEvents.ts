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

  const { data: inquiryTasks } = await supabase
    .from('tasks')
    .select('id, title, description, due_date, inquiry_details, created_by, created_at')
    .eq('is_inquiry', true)
    .eq('created_by', user.id);

  const inquiries = (inquiryTasks || [])
    .filter((t: any) => t.due_date || t.inquiry_details?.termin)
    .map((task: any) => {
      const termin = task.due_date || task.inquiry_details?.termin;
      const clientLabel =
        task.inquiry_details?.client_text ||
        task.inquiry_details?.client_phone ||
        task.inquiry_details?.client_email ||
        'nieznany';
      return {
        id: `inquiry-${task.id}`,
        name: `Zapytanie: ${clientLabel}`,
        event_date: termin,
        event_end_date: termin,
        status: 'inquiry',
        color: '#d3bb73',
        location: task.inquiry_details?.location_text || '',
        organization: null,
        category: { name: 'Zapytanie', color: '#d3bb73' },
        is_meeting: false,
        is_inquiry: true,
        inquiry_data: { ...task, task_id: task.id },
        assigned_employees: [],
        event_vehicles: [],
        event_equipment: [],
      };
    });

  const normalized =
    (data || []).map((e: any) => ({
      ...e,
      assigned_employees: (e.assigned_employees || []).map((x: any) => x.employee),
    })) ?? [];

  return [...normalized, ...inquiries];
}