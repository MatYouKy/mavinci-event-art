import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';
import { cache } from 'react';

export interface Message {
  id: string;
  type: 'contact_form' | 'sent' | 'received';
  from: string;
  subject: string;
  preview: string;
  date: string;
  is_read: boolean;
  is_starred: boolean;
  assigned_to: string | null;
  has_attachments?: boolean;
  email_account_id?: string;
}

async function fetchMessagesData(
  userId: string,
  emailAccountId: string,
  filterType: 'all' | 'contact_form' | 'sent' | 'received',
  limit: number = 50,
  offset: number = 0,
) {
  const supabase = await createSupabaseServerClient(cookies());

  let messages: Message[] = [];
  let total = 0;

  // permissions / access flags
  const { data: employeeData } = await supabase
    .from('employees')
    .select('can_receive_contact_forms, permissions')
    .eq('id', userId)
    .maybeSingle();

  const hasContactFormAccess = !!employeeData?.can_receive_contact_forms;
  const canManage =
    Array.isArray(employeeData?.permissions) &&
    (employeeData!.permissions.includes('messages_manage') ||
      employeeData!.permissions.includes('admin'));

  // shared accounts assignments
  const { data: assignments } = await supabase
    .from('employee_email_account_assignments')
    .select('email_account_id')
    .eq('employee_id', userId);

  const assignedAccountIds = assignments?.map((a) => a.email_account_id) || [];

  // ----------------------------
  // CONTACT FORM
  // ----------------------------
  if (emailAccountId === 'contact_form') {
    // If user has no access -> return empty (and do not throw)
    if (!hasContactFormAccess && !canManage) {
      return { messages: [], total: 0, hasMore: false };
    }

    let query = supabase
      .from('contact_messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // If not manager -> show only assigned to me OR unassigned
    if (!canManage) {
      query = query.or(`assigned_to.eq.${userId},assigned_to.is.null`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    messages = (data || []).map((msg: any) => ({
      id: msg.id,
      type: 'contact_form',
      from: msg.email || '',
      subject: msg.subject || 'Wiadomość z formularza',
      preview: (msg.message || '').substring(0, 150),
      date: msg.created_at,
      is_read: !!msg.read_at,
      is_starred: false, // brak kolumny w tabeli
      assigned_to: msg.assigned_to ?? null,
      has_attachments: !!(msg.cv_url || msg.attachment_url),
    }));

    total = count || 0;

    return {
      messages,
      total,
      hasMore: total > offset + limit,
    };
  }

  // helper: which accounts can be queried in "all"
  // IMPORTANT: you were previously using [userId, ...assignedAccountIds]
  // but email_account_id is NOT employee_id. So "all" must use actual account IDs:
  // personal accounts (employee_email_accounts where employee_id=userId) + assigned shared/system
  const { data: personalAccounts } = await supabase
    .from('employee_email_accounts')
    .select('id')
    .eq('employee_id', userId)
    .eq('is_active', true);

  const personalAccountIds = personalAccounts?.map((a) => a.id) || [];

  const accountIdsToQuery = Array.from(
    new Set([...personalAccountIds, ...assignedAccountIds]),
  );

  // ----------------------------
  // ALL ACCOUNTS
  // ----------------------------
  if (emailAccountId === 'all') {
    // received
    if (filterType === 'all' || filterType === 'received') {
      if (accountIdsToQuery.length > 0) {
        const { data: receivedData, error: receivedError, count: receivedCount } = await supabase
          .from('received_emails')
          .select('*', { count: 'exact' })
          .in('email_account_id', accountIdsToQuery)
          .order('received_date', { ascending: false })
          .range(offset, offset + limit - 1);

        if (receivedError) throw receivedError;

        const receivedMessages: Message[] = (receivedData || []).map((msg: any) => ({
          id: msg.id,
          type: 'received',
          from: msg.from_address || '',
          subject: msg.subject || '(bez tematu)',
          preview:
            (msg.body_text || '').substring(0, 150) ||
            (msg.body_html || '').substring(0, 150) ||
            '',
          date: msg.received_date,
          is_read: !!msg.is_read,
          is_starred: !!msg.is_starred,
          assigned_to: msg.assigned_to ?? null,
          has_attachments: !!msg.has_attachments,
          email_account_id: msg.email_account_id,
        }));

        messages = [...messages, ...receivedMessages];
        total = receivedCount || 0;
      }
    }

    // sent
    if (filterType === 'all' || filterType === 'sent') {
      if (accountIdsToQuery.length > 0) {
        const { data: sentData, error: sentError, count: sentCount } = await supabase
          .from('sent_emails')
          .select('*', { count: 'exact' })
          .in('email_account_id', accountIdsToQuery)
          .order('sent_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (sentError) throw sentError;

        const sentMessages: Message[] = (sentData || []).map((msg: any) => ({
          id: msg.id,
          type: 'sent',
          from: msg.to_address || '',
          subject: msg.subject || '(bez tematu)',
          preview:
            (msg.body_text || '').substring(0, 150) ||
            (msg.body_html || '').substring(0, 150) ||
            '',
          date: msg.sent_at,
          is_read: true,
          is_starred: false,
          assigned_to: null,
          has_attachments: !!msg.has_attachments,
          email_account_id: msg.email_account_id,
        }));

        messages = [...messages, ...sentMessages];
        total += sentCount || 0;
      }
    }

    messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return {
      messages: messages.slice(0, limit),
      total,
      hasMore: total > offset + limit,
    };
  }

  // ----------------------------
  // SPECIFIC ACCOUNT
  // ----------------------------
  // received
  if (filterType === 'all' || filterType === 'received') {
    const { data: receivedData, error: receivedError, count: receivedCount } = await supabase
      .from('received_emails')
      .select('*', { count: 'exact' })
      .eq('email_account_id', emailAccountId)
      .order('received_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (receivedError) throw receivedError;

    const receivedMessages: Message[] = (receivedData || []).map((msg: any) => ({
      id: msg.id,
      type: 'received',
      from: msg.from_address || '',
      subject: msg.subject || '(bez tematu)',
      preview:
        (msg.body_text || '').substring(0, 150) ||
        (msg.body_html || '').substring(0, 150) ||
        '',
      date: msg.received_date,
      is_read: !!msg.is_read,
      is_starred: !!msg.is_starred,
      assigned_to: msg.assigned_to ?? null,
      has_attachments: !!msg.has_attachments,
      email_account_id: msg.email_account_id,
    }));

    messages = [...messages, ...receivedMessages];
    total = receivedCount || 0;
  }

  // sent
  if (filterType === 'all' || filterType === 'sent') {
    const { data: sentData, error: sentError, count: sentCount } = await supabase
      .from('sent_emails')
      .select('*', { count: 'exact' })
      .eq('email_account_id', emailAccountId)
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (sentError) throw sentError;

    const sentMessages: Message[] = (sentData || []).map((msg: any) => ({
      id: msg.id,
      type: 'sent',
      from: msg.to_address || '',
      subject: msg.subject || '(bez tematu)',
      preview:
        (msg.body_text || '').substring(0, 150) ||
        (msg.body_html || '').substring(0, 150) ||
        '',
      date: msg.sent_at,
      is_read: true,
      is_starred: false,
      assigned_to: null,
      has_attachments: !!msg.has_attachments,
      email_account_id: msg.email_account_id,
    }));

    messages = [...messages, ...sentMessages];
    total += sentCount || 0;
  }

  messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    messages: messages.slice(0, limit),
    total,
    hasMore: total > offset + limit,
  };
}

export const getMessages = cache(
  async (
    userId: string,
    emailAccountId: string,
    filterType: 'all' | 'contact_form' | 'sent' | 'received',
    limit: number = 50,
    offset: number = 0,
  ) => fetchMessagesData(userId, emailAccountId, filterType, limit, offset));