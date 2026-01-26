import 'server-only';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // tylko na serwerze
  { auth: { persistSession: false } },
);

export async function fetchUnreadCountServer() {
  const { count: contactCount, error: contactErr } = await supabaseAdmin
    .from('contact_messages')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'unread');

  if (contactErr) {
    console.error('[fetchUnreadCountServer] contact_messages:', contactErr);
    throw new Error(contactErr.message);
  }

  const { count: emailCount, error: emailErr } = await supabaseAdmin
    .from('received_emails')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);

  if (emailErr) {
    console.error('[fetchUnreadCountServer] received_emails:', emailErr);
    throw new Error(emailErr.message);
  }

  return (contactCount || 0) + (emailCount || 0);
}