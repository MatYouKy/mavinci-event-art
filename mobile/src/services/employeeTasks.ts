import type { SupabaseClient } from '@supabase/supabase-js';

const PAGE_SIZE = 200;
const TASK_SELECT = `*, task_assignees(employee_id,
  employees!task_assignees_employee_id_fkey(id, name, surname, avatar_url, avatar_metadata))`;

export async function fetchEmployeeTasks(client: SupabaseClient, employeeId: string, ownerId: string) {
  const fetchScope = async (scope: 'private' | 'assigned') => {
    const rows: any[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // A separate, empty join filters tasks without hiding their other assignees.
      let query = client.from('tasks').select(
        scope === 'assigned' ? `${TASK_SELECT}, assigned_filter:task_assignees!inner()` : TASK_SELECT,
      );
      query = scope === 'private'
        ? query.eq('owner_id', ownerId)
        : query.eq('assigned_filter.employee_id', employeeId);
      const { data, error } = await query
        .eq('is_private', scope === 'private')
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  };

  const [created, assigned] = await Promise.all([fetchScope('private'), fetchScope('assigned')]);
  return Array.from(new Map([...created, ...assigned].map((task) => [task.id, task])).values());
}

// The database trigger auto_assign_task_creator creates the self-assignment
// in the same transaction. Inserting it again causes a unique-key violation.
export async function createPrivateEmployeeTask(
  client: SupabaseClient,
  employeeId: string,
  input: { title: string; description: string | null; priority: string; column: string },
) {
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new Error('Nie udało się potwierdzić zalogowanego użytkownika.');
  const { data, error } = await client.from('tasks').insert({
    title: input.title,
    description: input.description,
    priority: input.priority,
    status: input.column,
    board_column: input.column,
    owner_id: user.id,
    created_by: employeeId,
    is_private: true,
    event_id: null,
  }).select('id').single();
  if (error) throw error;
  return data;
}
