import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server.app';
import { getEmailAccounts } from '@/lib/CRM/messages/getEmailAccounts.server';
import { getMessages } from '@/lib/CRM/messages/getMessages.server';
import MessagesPageClient from './MessagesPageClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MessagesPage() {
  const supabase = await createServerClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Get employee permissions
  const { data: employeeData } = await supabase
    .from('employees')
    .select('permissions, can_receive_contact_forms')
    .eq('id', user.id)
    .maybeSingle();

  if (!employeeData) {
    redirect('/crm');
  }

  const permissions = employeeData.permissions || [];
  const canManage = permissions.includes('messages_manage') || permissions.includes('admin');
  const canView = permissions.includes('messages_view') || canManage;

  if (!canView && !canManage) {
    redirect('/crm');
  }

  // Fetch email accounts
  const { accounts, hasContactFormAccess, isAdmin } = await getEmailAccounts(user.id);

  // Fetch initial messages - default to first account
  const defaultAccountId = accounts.length > 0 ? accounts[0].id : 'all';
  const { messages, hasMore, total } = await getMessages(user.id, defaultAccountId, 'all', 50, 0);

  return (
    <MessagesPageClient
      initialAccounts={accounts}
      initialMessages={messages}
      initialHasMore={hasMore}
      initialTotal={total}
      hasContactFormAccess={hasContactFormAccess}
      canManage={canManage}
      canView={canView}
    />
  );
}
