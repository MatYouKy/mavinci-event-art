import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createSupabaseServerClient(cookies());
  const taskId = ctx.params.id;

  const { data: task, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const [assigneesRes, creatorRes, commentsRes, attachmentsRes, workingRes] = await Promise.all([
    supabase
      .from('task_assignees')
      .select(`
        employee_id,
        employees:employees!task_assignees_employee_id_fkey(name, surname, avatar_url, avatar_metadata)
      `)
      .eq('task_id', taskId),

    task.created_by
      ? supabase.from('employees').select('name, surname, avatar_url, avatar_metadata').eq('id', task.created_by).maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),

    supabase
      .from('task_comments')
      .select(`
        id, task_id, employee_id, content, created_at,
        employees:employees(name, surname, avatar_url, avatar_metadata)
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: true }),

    supabase
      .from('task_attachments')
      .select(`
        id, task_id, event_file_id, is_linked, file_name, file_url, file_type, file_size, uploaded_by, created_at,
        employees:employees(name, surname, avatar_url, avatar_metadata)
      `)
      .eq('task_id', taskId)
      .order('created_at', { ascending: false }),

    task.currently_working_by
      ? supabase.from('employees').select('name, surname, avatar_url, avatar_metadata').eq('id', task.currently_working_by).maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
  ]);

  if (assigneesRes.error) return NextResponse.json({ error: assigneesRes.error.message }, { status: 500 });
  if (commentsRes.error) return NextResponse.json({ error: commentsRes.error.message }, { status: 500 });
  if (attachmentsRes.error) return NextResponse.json({ error: attachmentsRes.error.message }, { status: 500 });

  return NextResponse.json({
    ...task,
    task_assignees: assigneesRes.data ?? [],
    creator: creatorRes.data ?? null,
    comments: commentsRes.data ?? [],
    attachments: attachmentsRes.data ?? [],
    currently_working_employee: workingRes.data ?? null,
    comments_count: (commentsRes.data ?? []).length,
  });
}

export async function PATCH(req: Request, ctx: { params: { id: string } }) {
  const supabase = createSupabaseServerClient(cookies());
  const taskId = ctx.params.id;
  const body = await req.json();

  const { assigned_employees, assigned_by, ...updates } = body ?? {};

  // update task fields
  if (updates && Object.keys(updates).length) {
    const { error } = await supabase.from('tasks').update(updates).eq('id', taskId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // update assignees
  if (assigned_employees !== undefined) {
    const { error: delErr } = await supabase.from('task_assignees').delete().eq('task_id', taskId);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    if (Array.isArray(assigned_employees) && assigned_employees.length) {
      const rows = assigned_employees.map((employee_id: string) => ({
        task_id: taskId,
        employee_id,
        assigned_by: assigned_by ?? null,
      }));
      const { error: insErr } = await supabase.from('task_assignees').insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, ctx: { params: { id: string } }) {
  const supabase = createSupabaseServerClient(cookies());
  const taskId = ctx.params.id;

  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}