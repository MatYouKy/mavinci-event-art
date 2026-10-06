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
      organization:organizations!events_organization_id_fkey(
        id,
        name,
        alias
      ),
      contact_person:contact_person_id(id, first_name, last_name, full_name),
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
    .select(`
      id,
      title,
      description,
      due_date,
      inquiry_details,
      inquiry_stage,
      inquiry_owner_id,
      win_probability,
      event_id,
      created_by,
      created_at,
      organizations:organizations!tasks_organization_id_fkey(id, name, alias),
      contacts:contacts!tasks_contact_id_fkey(id, first_name, last_name, full_name)
    `)
    .eq('is_inquiry', true);

  const inquiries = (inquiryTasks || [])
    .filter(
      (task: any) =>
        (task.due_date || task.inquiry_details?.termin) &&
        !task.event_id &&
        !['won', 'lost'].includes(task.inquiry_stage),
    )
    .map((task: any) => {
      const termin = task.inquiry_details?.termin || task.due_date;
      const contactName =
        task.contacts?.full_name ||
        [task.contacts?.first_name, task.contacts?.last_name].filter(Boolean).join(' ');
      const clientLabel =
        task.organizations?.alias ||
        task.organizations?.name ||
        contactName ||
        task.inquiry_details?.client_text ||
        task.inquiry_details?.client_phone ||
        task.inquiry_details?.client_email ||
        'nieznany';
      const subject = String(task.title || 'Zapytanie').replace(/^Zapytanie:\s*/i, '');
      return {
        id: `inquiry-${task.id}`,
        name: `Potencjalne · ${subject}`,
        event_date: termin,
        event_end_date: termin,
        status: 'inquiry',
        created_by: task.created_by,
        color: '#f59e0b',
        location: task.inquiry_details?.location_text || '',
        organization: task.organizations
          ? { name: task.organizations.name, alias: task.organizations.alias }
          : null,
        contact_person: contactName ? { full_name: contactName } : null,
        category: { name: 'Potencjalne zapytanie', color: '#f59e0b' },
        is_meeting: false,
        is_inquiry: true,
        inquiry_data: { ...task, task_id: task.id, client_label: clientLabel },
        assigned_employees: task.inquiry_owner_id
          ? [{ id: task.inquiry_owner_id, name: '', surname: '' }]
          : [],
        event_vehicles: [],
        event_equipment: [],
      };
    });

  const normalized =
    (data || []).map((e: any) => ({
      ...e,
      contact_person: e.contact_person
        ? { full_name: e.contact_person.full_name || [e.contact_person.first_name, e.contact_person.last_name].filter(Boolean).join(' ') }
        : null,
      assigned_employees: (e.assigned_employees || []).map((x: any) => x.employee),
    })) ?? [];

  return [...normalized, ...inquiries];
}
