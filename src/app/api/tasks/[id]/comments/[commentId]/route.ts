import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export async function DELETE(
  _req: Request,
  ctx: { params: { id: string; commentId: string } },
) {
  const supabase = createSupabaseServerClient(cookies());
  const { commentId } = ctx.params;

  const { error } = await supabase.from('task_comments').delete().eq('id', commentId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
