import { createServerClient } from '@/lib/supabase/server.app';
import { unstable_cache } from 'next/cache';

export interface EmailAccount {
  id: string;
  email_address: string;
  account_name: string;
  from_name: string;
  account_type: 'personal' | 'shared' | 'system';
  department?: string;
  display_name: string;
}

async function fetchEmailAccountsData(userId: string) {
  const supabase = await createServerClient();

  // Get personal accounts
  const { data: personalAccounts, error: personalError } = await supabase
    .from('employee_email_accounts')
    .select('*')
    .eq('employee_id', userId)
    .eq('is_active', true);

  if (personalError) throw personalError;

  // Get assigned shared accounts
  const { data: assignments, error: assignmentsError } = await supabase
    .from('employee_email_account_assignments')
    .select('email_account_id')
    .eq('employee_id', userId);

  if (assignmentsError) throw assignmentsError;

  const assignedAccountIds = assignments?.map((a) => a.email_account_id) || [];

  // Get employee data for contact form access
  const { data: employeeData } = await supabase
    .from('employees')
    .select('can_receive_contact_forms, permissions')
    .eq('id', userId)
    .maybeSingle();

  const hasContactFormAccess = employeeData?.can_receive_contact_forms || false;
  const isAdmin = employeeData?.permissions?.includes('admin') || false;

  let assignedAccounts = [];
  if (assignedAccountIds.length > 0) {
    const { data: assignedData, error: assignedError } = await supabase
      .from('employee_email_accounts')
      .select('*')
      .in('id', assignedAccountIds)
      .eq('is_active', true);

    if (assignedError) throw assignedError;
    assignedAccounts = assignedData || [];
  }

  // Combine and deduplicate accounts
  const allUserAccounts = [...(personalAccounts || []), ...assignedAccounts];
  const uniqueAccounts = Array.from(
    new Map(allUserAccounts.map((acc) => [acc.id, acc])).values(),
  );

  // Sort accounts
  const sortedAccounts = uniqueAccounts.sort((a, b) => {
    if (a.account_type !== b.account_type) {
      const order = { system: 0, shared: 1, personal: 2 };
      return (
        order[a.account_type as keyof typeof order] -
        order[b.account_type as keyof typeof order]
      );
    }
    return a.account_name.localeCompare(b.account_name);
  });

  // Format account names
  const getAccountTypeBadge = (accountType: string) => {
    if (accountType === 'system') return '🔧';
    if (accountType === 'shared') return '🏢';
    return '👤';
  };

  const formatAccountName = (account: any) => {
    const badge = getAccountTypeBadge(account.account_type);
    if (account.account_type === 'shared' && account.department) {
      return `${badge} ${account.department} - ${account.account_name}`;
    }
    return `${badge} ${account.account_name}`;
  };

  const formattedAccounts: EmailAccount[] = sortedAccounts.map((acc) => ({
    ...acc,
    display_name: formatAccountName(acc),
  }));

  // Add special accounts
  const accounts: EmailAccount[] = [
    ...(formattedAccounts.length > 0
      ? [
          {
            id: 'all',
            email_address: 'Wszystkie dostępne konta',
            from_name: 'Wszystkie konta',
            account_name: 'Wszystkie konta',
            display_name: '📧 Wszystkie konta',
            account_type: 'system' as const,
          },
        ]
      : []),
    ...(hasContactFormAccess || isAdmin
      ? [
          {
            id: 'contact_form',
            email_address: 'Formularz kontaktowy',
            from_name: 'Formularz',
            account_name: 'Formularz kontaktowy',
            display_name: '📝 Formularz kontaktowy',
            account_type: 'system' as const,
          },
        ]
      : []),
    ...formattedAccounts,
  ];

  return {
    accounts,
    hasContactFormAccess,
    isAdmin,
  };
}

export const getEmailAccounts = unstable_cache(
  async (userId: string) => {
    return fetchEmailAccountsData(userId);
  },
  ['email-accounts'],
  {
    revalidate: 300, // 5 minutes
    tags: ['email-accounts'],
  },
);
