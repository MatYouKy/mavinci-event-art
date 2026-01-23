import 'server-only';
import { cookies } from 'next/headers';
import { CookieStoreLike, createSupabaseServerClient } from '@/lib/supabase/server.app';

function getCookieStore(): CookieStoreLike {
  const cookieStore = cookies();
  return {
    getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    set: (name, value, options) => cookieStore.set(name, value, options),
  };
}

export async function fetchTasksServer() {
  const supabase = createSupabaseServerClient(getCookieStore());
  const { data: { user } } = await supabase.auth.getUser();

  // jeśli nie ma usera - zwróć [] (np. public)
  if (!user) return [];

  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select(`
      id, title, description, priority, status, board_column, order_index,
      due_date, created_by, created_at, updated_at, thumbnail_url, currently_working_by
    `)
    .eq('is_private', false)
    .is('event_id', null);

  if (tasksError) throw tasksError;
  if (!tasks?.length) return [];

  const taskIds = tasks.map(t => t.id);

  const [assigneesRes, commentsRes, workingRes] = await Promise.all([
    supabase
      .from('task_assignees')
      .select(`task_id, employee_id, employees:employees!task_assignees_employee_id_fkey(name, surname, avatar_url, avatar_metadata)`)
      .in('task_id', taskIds),

    supabase
      .from('task_comments')
      .select('task_id')
      .in('task_id', taskIds),

    supabase
      .from('employees')
      .select('id, name, surname, avatar_url, avatar_metadata')
      .in('id', Array.from(new Set(tasks.map(t => t.currently_working_by).filter(Boolean))) as string[]),
  ]);

  if (assigneesRes.error) throw assigneesRes.error;
  if (commentsRes.error) throw commentsRes.error;
  if (workingRes.error) throw workingRes.error;

  const workingMap = new Map((workingRes.data ?? []).map(e => [e.id, e]));

  const assigneesByTask = new Map<string, any[]>();
  (assigneesRes.data ?? []).forEach((a: any) => {
    const arr = assigneesByTask.get(a.task_id) ?? [];
    arr.push({ employee_id: a.employee_id, employees: a.employees });
    assigneesByTask.set(a.task_id, arr);
  });

  const commentsCountByTask = new Map<string, number>();
  (commentsRes.data ?? []).forEach((c: any) => {
    commentsCountByTask.set(c.task_id, (commentsCountByTask.get(c.task_id) ?? 0) + 1);
  });

  const tasksWithDetails = tasks.map((t: any) => ({
    ...t,
    task_assignees: assigneesByTask.get(t.id) ?? [],
    currently_working_employee: t.currently_working_by ? (workingMap.get(t.currently_working_by) ?? null) : null,
    comments_count: commentsCountByTask.get(t.id) ?? 0,
  }));

  const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  tasksWithDetails.sort((a: any, b: any) => {
    const p = (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
    if (p !== 0) return p;
    if (a.due_date && b.due_date) return +new Date(a.due_date) - +new Date(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return (a.order_index ?? 0) - (b.order_index ?? 0);
  });

  return tasksWithDetails;
}