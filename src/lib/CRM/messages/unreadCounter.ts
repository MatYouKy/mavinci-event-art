import 'server-only';
import { createClient } from '@supabase/supabase-js';

type SupabaseErr = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
  status?: number;
};

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // tylko na serwerze
  { auth: { persistSession: false } },
);

export async function fetchUnreadCountServer() {
  // CONTACTS
  const { count: contactCount, error: contactErr } = await supabaseAdmin
    .from('contact_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'unread');

  if (contactErr) {
    const e = contactErr as SupabaseErr;
    console.error('[fetchUnreadCountServer] contact_messages error:', {
      message: e.message,
      code: e.code,
      details: e.details,
      hint: e.hint,
      status: e.status,
      raw: contactErr,
    });
  }

  // EMAILS
  const { count: emailCount, error: emailErr } = await supabaseAdmin
    .from('received_emails')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  if (emailErr) {
    const e = emailErr as SupabaseErr;
    console.error('[fetchUnreadCountServer] received_emails error:', {
      message: e.message,
      code: e.code,
      details: e.details,
      hint: e.hint,
      status: e.status,
      raw: emailErr,
    });

    // ✅ KLUCZ: nie rozwalaj layoutu przez licznik
    return (contactCount || 0) + 0;
  }

  return (contactCount || 0) + (emailCount || 0);
}