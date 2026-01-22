import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const supabase = createSupabaseServerClient(cookies());
  const taskId = ctx.params.id;
  const body = await req.json();

  const { employee_id, content } = body;

  if (!employee_id || !content) {
    return NextResponse.json({ error: 'employee_id and content are required' }, { status: 400 });
  }

  const { data: comment, error } = await supabase
    .from('task_comments')
    .insert({
      task_id: taskId,
      employee_id,
      content,
    })
    .select(`
      id, task_id, employee_id, content, created_at,
      employees:employees(name, surname, avatar_url, avatar_metadata)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(comment);
}
