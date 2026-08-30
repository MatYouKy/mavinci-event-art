import 'server-only';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { getCurrentEmployeeServerCached } from '@/lib/CRM/auth/getCurrentEmployeeServer';
import { getEmailAccounts } from '@/lib/CRM/messages/getEmailAccounts.server';

export async function fetchInquiryWorkspaceServer(inquiryId: string) {
  const supabase = createSupabaseServerClient(cookies());

  const { data: inquiry, error: inquiryError } = await supabase
    .from('tasks')
    .select(`
      id, title, description, priority, status, board_column, due_date, created_at, updated_at,
      inquiry_details, inquiry_stage, inquiry_owner_id, next_action_at, last_contact_at,
      estimated_value, win_probability, lost_reason, linked_offer_id, event_id,
      contact_id, organization_id,
      inquiry_owner:employees!tasks_inquiry_owner_id_fkey(id, name, surname, avatar_url, sales_team_id),
      contact:contacts(id, first_name, last_name, full_name, email, phone, mobile),
      organization:organizations(id, name, alias, email, phone)
    `)
    .eq('id', inquiryId)
    .eq('is_inquiry', true)
    .maybeSingle();

  if (inquiryError) throw inquiryError;
  if (!inquiry) return null;

  const currentEmployee = await getCurrentEmployeeServerCached();
  const emailAccountsPromise = currentEmployee?.id
    ? getEmailAccounts(currentEmployee.id)
    : Promise.resolve({ accounts: [] as any[] });

  const [tasksResult, offersResult, calculationsResult, historyResult, emailAccountsResult, categoriesResult, companiesResult, employeesResult] = await Promise.all([
    supabase
      .from('tasks')
      .select(`
        id, title, description, priority, status, board_column, due_date, created_at, assigned_to,
        task_assignees(
          employee_id,
          employee:employees!task_assignees_employee_id_fkey(id, name, surname)
        )
      `)
      .eq('inquiry_id', inquiryId)
      .eq('is_inquiry', false)
      .order('created_at', { ascending: false }),
    supabase
      .from('offers')
      .select('id, offer_number, status, total_amount, valid_until, created_at, updated_at')
      .eq('inquiry_id', inquiryId)
      .order('created_at', { ascending: false }),
    supabase
      .from('event_calculations')
      .select('id, event_id, inquiry_id, name, notes, created_at, updated_at, generated_pdf_path, is_accepted, event_calculation_items(quantity, unit_price, days)')
      .eq('inquiry_id', inquiryId)
      .order('created_at', { ascending: false }),
    supabase
      .from('inquiry_stage_history')
      .select('id, from_stage, to_stage, reason, metadata, created_at, changed_by_employee:employees!changed_by(id, name, surname)')
      .eq('inquiry_id', inquiryId)
      .order('created_at', { ascending: false })
      .limit(100),
    emailAccountsPromise,
    supabase
      .from('event_categories')
      .select('id, name')
      .eq('is_active', true)
      .order('order_index'),
    supabase
      .from('my_companies')
      .select('id, name, legal_name, is_default')
      .eq('is_active', true)
      .order('is_default', { ascending: false }),
    supabase
      .from('employees')
      .select('id, name, surname, avatar_url')
      .eq('is_active', true)
      .order('surname')
      .order('name'),
  ]);

  for (const result of [tasksResult, offersResult, calculationsResult, historyResult, categoriesResult, companiesResult, employeesResult]) {
    if (result.error) throw result.error;
  }

  return {
    inquiry,
    tasks: (tasksResult.data || []).map((task: any) => {
      const assigned = (task.task_assignees || []).find(
        (entry: any) => entry.employee_id === task.assigned_to,
      ) || task.task_assignees?.[0];
      const taskData = { ...task };
      delete taskData.task_assignees;
      return { ...taskData, assignee: assigned?.employee || null };
    }),
    offers: offersResult.data || [],
    calculations: calculationsResult.data || [],
    history: historyResult.data || [],
    emailAccounts: (emailAccountsResult.accounts || []).filter(
      (account: any) => !['all', 'contact_form'].includes(account.id),
    ),
    categories: categoriesResult.data || [],
    companies: companiesResult.data || [],
    employees: employeesResult.data || [],
  };
}
