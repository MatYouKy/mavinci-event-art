import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';


export async function GET() {
  const supabase = createSupabaseServerClient(cookies());

  // 1) pobierz tasks
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select(`
      id,
      title,
      description,
      priority,
      status,
      board_column,
      order_index,
      due_date,
      created_by,
      created_at,
      updated_at,
      thumbnail_url,
      currently_working_by
    `)
    .eq('is_private', false)
    .is('event_id', null);

  if (tasksError) {
    return NextResponse.json({ error: tasksError.message }, { status: 500 });
  }

  const taskIds = (tasks ?? []).map((t) => t.id);
  if (taskIds.length === 0) return NextResponse.json([]);

  // 2) pobierz assignees dla wszystkich tasków (1 query)
  const { data: assignees, error: assigneesError } = await supabase
    .from('task_assignees')
    .select(`
      task_id,
      employee_id,
      employees:employees!task_assignees_employee_id_fkey(
        name, surname, avatar_url, avatar_metadata
      )
    `)
    .in('task_id', taskIds);

  if (assigneesError) {
    return NextResponse.json({ error: assigneesError.message }, { status: 500 });
  }

  // 3) comments_count dla wszystkich tasków (1 query)
  // bierzemy tylko task_id (bez treści) i zliczamy po stronie serwera
  const { data: comments, error: commentsError } = await supabase
    .from('task_comments')
    .select('task_id')
    .in('task_id', taskIds);

  if (commentsError) {
    return NextResponse.json({ error: commentsError.message }, { status: 500 });
  }

  // 4) working employees (1 query)
  const workingIds = Array.from(
    new Set((tasks ?? []).map((t) => t.currently_working_by).filter(Boolean)),
  ) as string[];

  const workingMap = new Map<string, any>();
  if (workingIds.length) {
    const { data: workingEmployees, error: workingError } = await supabase
      .from('employees')
      .select('id, name, surname, avatar_url, avatar_metadata')
      .in('id', workingIds);

    if (workingError) {
      return NextResponse.json({ error: workingError.message }, { status: 500 });
    }

    (workingEmployees ?? []).forEach((e) => workingMap.set(e.id, e));
  }

  // mapy pomocnicze
  const assigneesByTask = new Map<string, any[]>();
  (assignees ?? []).forEach((a) => {
    const arr = assigneesByTask.get(a.task_id) ?? [];
    arr.push({ employee_id: a.employee_id, employees: a.employees });
    assigneesByTask.set(a.task_id, arr);
  });

  const commentsCountByTask = new Map<string, number>();
  (comments ?? []).forEach((c) => {
    commentsCountByTask.set(c.task_id, (commentsCountByTask.get(c.task_id) ?? 0) + 1);
  });

  // final: złożenie wyników
  const tasksWithDetails = (tasks ?? []).map((t) => ({
    ...t,
    task_assignees: assigneesByTask.get(t.id) ?? [],
    currently_working_employee: t.currently_working_by
      ? workingMap.get(t.currently_working_by) ?? null
      : null,
    comments_count: commentsCountByTask.get(t.id) ?? 0,
  }));

  // sort jak miałeś
  const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
  tasksWithDetails.sort((a: any, b: any) => {
    const priorityDiff = (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
    if (priorityDiff !== 0) return priorityDiff;

    if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
    if (a.due_date) return -1;
    if (b.due_date) return 1;

    return (a.order_index ?? 0) - (b.order_index ?? 0);
  });

  return NextResponse.json(tasksWithDetails);
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient(cookies());
  const body = await req.json();

  const { title, description, priority, board_column, due_date, assigned_employees, created_by } = body;

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      title,
      description: description ?? null,
      priority,
      board_column,
      due_date: due_date ?? null,
      status: 'todo',
      is_private: false,
      event_id: null,
      owner_id: null,
      created_by: created_by ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (Array.isArray(assigned_employees) && assigned_employees.length) {
    const rows = assigned_employees.map((employee_id: string) => ({
      task_id: task.id,
      employee_id,
      assigned_by: created_by ?? null,
    }));

    const { error: assignError } = await supabase.from('task_assignees').insert(rows);
    if (assignError) return NextResponse.json({ error: assignError.message }, { status: 500 });
  }

  return NextResponse.json({ ...task, task_assignees: [], comments_count: 0 });
}