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

export async function fetchUnreadCountServer(userId: string) {

  const [{ data: employee }, { data: personalAccounts }, { data: assignments }] =
    await Promise.all([
      supabaseAdmin
        .from('employees')
        .select('permissions, can_receive_contact_forms')
        .eq('id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('employee_email_accounts')
        .select('id')
        .eq('employee_id', userId)
        .eq('is_active', true),
      supabaseAdmin
        .from('employee_email_account_assignments')
        .select('email_account_id')
        .eq('employee_id', userId),
    ]);

  const accountIds = Array.from(new Set([
    ...(personalAccounts || []).map((account) => account.id),
    ...(assignments || []).map((assignment) => assignment.email_account_id),
  ]));

  const permissions: string[] = employee?.permissions || [];
  const canViewContactForms =
    permissions.includes('admin') ||
    permissions.includes('messages_manage') ||
    employee?.can_receive_contact_forms === true;

  const contactResult = canViewContactForms
    ? await supabaseAdmin
        .from('contact_messages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new')
        .is('deleted_at', null)
    : { count: 0, error: null };

  const { count: contactCount, error: contactErr } = contactResult;

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
  const emailResult = accountIds.length
    ? await supabaseAdmin
        .from('received_emails')
        .select('id', { count: 'exact', head: true })
        .in('email_account_id', accountIds)
        .eq('is_read', false)
        .is('deleted_at', null)
    : { count: 0, error: null };

  const { count: emailCount, error: emailErr } = emailResult;

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
