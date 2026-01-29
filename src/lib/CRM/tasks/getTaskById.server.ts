// lib/CRM/tasks/getTaskById.server.ts
import 'server-only';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import type { IEmployee } from '@/app/(crm)/crm/employees/type';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  board_column: string;
  due_date: string | null;
  event_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  thumbnail_url: string | null;

  task_assignees: Array<{
    employee_id: string;
    employees: IEmployee;
  }>;

  creator?: IEmployee | null;

  // pod RTK Query masz to w task:
  comments?: any[];
  attachments?: any[];
}

// Jeśli nie znasz nazw FK — użyj tych z błędu PostgREST (PGRST201 / hint) albo podejrzyj w DB.
export async function getTaskByIdServer(taskId: string): Promise<Task | null> {
  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase
    .from('tasks')
    .select(
      `
      id,
      title,
      description,
      priority,
      status,
      board_column,
      due_date,
      event_id,
      created_by,
      created_at,
      updated_at,
      thumbnail_url,

      task_assignees (
        employee_id,
        employees:employees!task_assignees_employee_id_fkey (
          id,
          name,
          surname,
          avatar_url,
          avatar_metadata,
          role,
          permissions
        )
      ),

      creator:employees!tasks_created_by_fkey (
        id,
        name,
        surname,
        avatar_url,
        avatar_metadata,
        role,
        permissions
      ),

      comments:task_comments (
        id,
        task_id,
        employee_id,
        content,
        created_at,
        employees:employees!task_comments_employee_id_fkey (
          id,
          name,
          surname,
          avatar_url,
          avatar_metadata,
          role,
          permissions
        )
      ),

      attachments:task_attachments (
        id,
        task_id,
        event_file_id,
        is_linked,
        file_name,
        file_url,
        file_type,
        file_size,
        uploaded_by,
        created_at,
        employees:employees!task_attachments_uploaded_by_fkey (
          id,
          name,
          surname,
          avatar_url,
          avatar_metadata,
          role,
          permissions
        )
      )
    `,
    )
    .eq('id', taskId)
    .maybeSingle();

  if (error) {
    console.error('[getTaskByIdServer]', error);
    return null;
  }

  return data as unknown as Task | null;
}