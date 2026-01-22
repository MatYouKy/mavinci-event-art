import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export async function DELETE(
  _req: Request,
  ctx: { params: { id: string; attachmentId: string } },
) {
  const supabase = createSupabaseServerClient(cookies());
  const { attachmentId } = ctx.params;
  const url = new URL(_req.url);
  const fileUrl = url.searchParams.get('fileUrl');
  const isLinked = url.searchParams.get('isLinked') === 'true';

  // If it's a linked file, just remove the link (set event_file_id to null)
  if (isLinked) {
    const { error } = await supabase
      .from('task_attachments')
      .update({ event_file_id: null, is_linked: false })
      .eq('id', attachmentId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    // Delete the attachment record
    const { error } = await supabase.from('task_attachments').delete().eq('id', attachmentId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // If fileUrl is provided, try to delete the file from storage
    if (fileUrl) {
      try {
        // Extract the file path from the URL
        const urlParts = fileUrl.split('/event-files/');
        if (urlParts.length > 1) {
          const filePath = urlParts[1];
          await supabase.storage.from('event-files').remove([filePath]);
        }
      } catch (storageError) {
        // Log but don't fail if storage deletion fails
        console.error('Error deleting file from storage:', storageError);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
