import { createServerClient } from '@/lib/supabase/server.app';
import { unstable_cache } from 'next/cache';

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
  const supabase = await createServerClient();

  let messages: Message[] = [];
  let total = 0;

  // Get employee permissions
  const { data: employeeData } = await supabase
    .from('employees')
    .select('can_receive_contact_forms, permissions')
    .eq('id', userId)
    .maybeSingle();

  const hasContactFormAccess = employeeData?.can_receive_contact_forms || false;
  const canManage = employeeData?.permissions?.includes('messages_manage') || false;

  // Get assigned account IDs
  const { data: assignments } = await supabase
    .from('employee_email_account_assignments')
    .select('email_account_id')
    .eq('employee_id', userId);

  const assignedAccountIds = assignments?.map((a) => a.email_account_id) || [];

  if (emailAccountId === 'contact_form' && (hasContactFormAccess || canManage)) {
    // Fetch contact form messages
    let query = supabase
      .from('contact_messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (!canManage) {
      query = query.or(`assigned_to.eq.${userId},assigned_to.is.null`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    messages = (data || []).map((msg: any) => ({
      id: msg.id,
      type: 'contact_form' as const,
      from: msg.email,
      subject: msg.subject || 'Wiadomość z formularza',
      preview: msg.message?.substring(0, 150) || '',
      date: msg.created_at,
      is_read: msg.is_read || false,
      is_starred: msg.is_starred || false,
      assigned_to: msg.assigned_to,
      has_attachments: !!msg.cv_attachment_path,
    }));

    total = count || 0;
  } else if (emailAccountId === 'all') {
    // Fetch from all accounts user has access to
    const accountIdsToQuery = [userId, ...assignedAccountIds];

    // Fetch received emails
    let receivedQuery = supabase
      .from('received_emails')
      .select('*', { count: 'exact' })
      .in('email_account_id', accountIdsToQuery)
      .order('received_at', { ascending: false });

    if (filterType === 'all' || filterType === 'received') {
      const { data: receivedData, count: receivedCount } = await receivedQuery.range(
        offset,
        offset + limit - 1,
      );

      const receivedMessages: Message[] = (receivedData || []).map((msg: any) => ({
        id: msg.id,
        type: 'received' as const,
        from: msg.from_address,
        subject: msg.subject || '(bez tematu)',
        preview: msg.text_body?.substring(0, 150) || msg.html_body?.substring(0, 150) || '',
        date: msg.received_at,
        is_read: msg.is_read || false,
        is_starred: msg.is_starred || false,
        assigned_to: msg.assigned_to,
        has_attachments: msg.has_attachments,
        email_account_id: msg.email_account_id,
      }));

      messages = [...messages, ...receivedMessages];
      total = receivedCount || 0;
    }

    // Fetch sent emails if needed
    if (filterType === 'all' || filterType === 'sent') {
      const { data: sentData, count: sentCount } = await supabase
        .from('sent_emails')
        .select('*', { count: 'exact' })
        .in('email_account_id', accountIdsToQuery)
        .order('sent_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const sentMessages: Message[] = (sentData || []).map((msg: any) => ({
        id: msg.id,
        type: 'sent' as const,
        from: msg.to_address,
        subject: msg.subject || '(bez tematu)',
        preview: msg.text_body?.substring(0, 150) || msg.html_body?.substring(0, 150) || '',
        date: msg.sent_at,
        is_read: true,
        is_starred: false,
        assigned_to: null,
        has_attachments: msg.has_attachments,
        email_account_id: msg.email_account_id,
      }));

      messages = [...messages, ...sentMessages];
      total += sentCount || 0;
    }

    // Sort combined messages by date
    messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } else {
    // Fetch from specific account
    if (filterType === 'all' || filterType === 'received') {
      const { data: receivedData, count: receivedCount } = await supabase
        .from('received_emails')
        .select('*', { count: 'exact' })
        .eq('email_account_id', emailAccountId)
        .order('received_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const receivedMessages: Message[] = (receivedData || []).map((msg: any) => ({
        id: msg.id,
        type: 'received' as const,
        from: msg.from_address,
        subject: msg.subject || '(bez tematu)',
        preview: msg.text_body?.substring(0, 150) || msg.html_body?.substring(0, 150) || '',
        date: msg.received_at,
        is_read: msg.is_read || false,
        is_starred: msg.is_starred || false,
        assigned_to: msg.assigned_to,
        has_attachments: msg.has_attachments,
        email_account_id: msg.email_account_id,
      }));

      messages = [...messages, ...receivedMessages];
      total = receivedCount || 0;
    }

    if (filterType === 'all' || filterType === 'sent') {
      const { data: sentData, count: sentCount } = await supabase
        .from('sent_emails')
        .select('*', { count: 'exact' })
        .eq('email_account_id', emailAccountId)
        .order('sent_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const sentMessages: Message[] = (sentData || []).map((msg: any) => ({
        id: msg.id,
        type: 'sent' as const,
        from: msg.to_address,
        subject: msg.subject || '(bez tematu)',
        preview: msg.text_body?.substring(0, 150) || msg.html_body?.substring(0, 150) || '',
        date: msg.sent_at,
        is_read: true,
        is_starred: false,
        assigned_to: null,
        has_attachments: msg.has_attachments,
        email_account_id: msg.email_account_id,
      }));

      messages = [...messages, ...sentMessages];
      total += sentCount || 0;
    }

    // Sort combined messages by date
    messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  return {
    messages: messages.slice(0, limit),
    total,
    hasMore: total > offset + limit,
  };
}

export const getMessages = unstable_cache(
  async (
    userId: string,
    emailAccountId: string,
    filterType: 'all' | 'contact_form' | 'sent' | 'received',
    limit: number = 50,
    offset: number = 0,
  ) => {
    return fetchMessagesData(userId, emailAccountId, filterType, limit, offset);
  },
  ['messages-list'],
  {
    revalidate: 60, // 1 minute
    tags: ['messages-list'],
  },
);
