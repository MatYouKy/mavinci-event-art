import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import MessagesPageClient from './MessagesPageClient';
import { cookies } from 'next/headers';
import { Suspense } from 'react';
import MessagesLoadingScreen from '@/components/crm/MessagesLoadingScreen';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MessagesPage() {
  const supabase = await createSupabaseServerClient(cookies());

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: employeeData } = await supabase
    .from('employees')
    .select('permissions, can_receive_contact_forms')
    .eq('id', user.id)
    .maybeSingle();

  if (!employeeData) redirect('/crm');

  const permissions = employeeData.permissions || [];
  console.log('permissions', permissions);
  const canManage = permissions.includes('messages_manage') || permissions.includes('admin');
  const canView = permissions.includes('messages_view') || canManage;

  if (!canView && !canManage) redirect('/crm');

  return (
    <Suspense fallback={<MessagesLoadingScreen />}>
      <MessagesPageClient
        userId={user.id}
        hasContactFormAccess={employeeData.can_receive_contact_forms || false}
        canManage={canManage}
        canView={canView}
      />
    </Suspense>
  );
}