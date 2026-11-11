import type { SupabaseClient } from '@supabase/supabase-js';
import { withMessageSalesContext, type MessageSalesContext } from '@/lib/CRM/messages/salesContext';
import { readMailboxUnreadCounts } from '@/lib/CRM/messages/unreadCounts';
import { inboxMailboxIds, mailboxFilter, readMailboxViewPreferences } from '@/lib/CRM/messages/mailboxPreferences';

/*
 * Wiadomości CRM — odczyty wspólne dla przeglądarki (`src/store/api/messagesApi.ts`, klient przeglądarki)
 * i aplikacji na Maca (`/bridge/native/v1/messages/*`, klient z tokenem pracownika). Ta sama logika folderów, skrzynek
 * i uprawnień w obu miejscach; każde zapytanie wykonuje się z uprawnieniami pracownika (RLS).
 */

export type MessageType = 'contact_form' | 'sent' | 'received' | 'draft';
export type MessageFolder = 'all' | 'contact_form' | 'sent' | 'received' | 'drafts' | 'trash';

export interface MessageListItem {
  sales?: MessageSalesContext;
  id: string;
  type: MessageType;
  from: string;
  to: string;
  subject: string;
  preview: string;
  date: string;
  isRead: boolean;
  isStarred: boolean;
  status?: string;
  assigned_to?: string | null;
  assigned_employee?: { name: string; surname: string } | null;
  email_account_id?: string;
  isDeleted?: boolean;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
}

export interface MessageDetails extends MessageListItem {
  body: string;
  bodyHtml?: string;
  originalData: any;
  attachments?: EmailAttachment[];
  attachmentsError?: string;
}

export interface MessageUnreadCounts {
  total: number;
  contactForm: number;
  byAccount: Record<string, number>;
}

export interface FetchMessagesParams {
  emailAccountId: string;
  offset?: number;
  limit?: number;
  filterType?: MessageFolder;
  includeBody?: boolean;
  showOnlyOpened?: boolean;
}

export type MessageSearchParams = {
  emailAccountId: string;
  query: string;
  dateFrom?: string;
  dateTo?: string;
  filterType?: 'all' | 'contact_form' | 'sent' | 'received';
};

export type MessageEmailAccount = {
  id: string;
  email_address: string;
  account_name: string;
  from_name: string;
  account_type: 'personal' | 'shared' | 'system';
  department?: string;
  can_send: boolean;
  display_name: string;
};

type AuthUser = { id: string } | null;

export async function listMessages(
  supabase: SupabaseClient,
  user: AuthUser,
  { emailAccountId, offset = 0, limit = 50, filterType = 'all', showOnlyOpened = false }: FetchMessagesParams,
): Promise<{ messages: MessageListItem[]; hasMore: boolean; total: number }> {
  const allMessages: MessageListItem[] = [];

  const { data: currentEmployee } = user
    ? await supabase
        .from('employees')
        .select('permissions, can_receive_contact_forms, preferences')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };

  const isAdmin = currentEmployee?.permissions?.includes('admin');
  const hasMessagesManage = currentEmployee?.permissions?.includes('messages_manage');
  const canViewContactForm = isAdmin || hasMessagesManage || currentEmployee?.can_receive_contact_forms;

  const isTrash = filterType === 'trash';
  const isDrafts = filterType === 'drafts';
  const isSentOnly = filterType === 'sent';
  const isReceivedOnly = filterType === 'received';
  const isContactFormOnly = filterType === 'contact_form';

  const includeContactForm =
    !isDrafts && !isSentOnly && !isReceivedOnly &&
    (filterType === 'all' || isContactFormOnly || isTrash) &&
    (emailAccountId === 'all' || emailAccountId === 'contact_form');
  const includeSent = !isDrafts && !isReceivedOnly && !isContactFormOnly && emailAccountId !== 'contact_form';
  const includeReceived = !isDrafts && !isSentOnly && !isContactFormOnly && emailAccountId !== 'contact_form';

  if (includeContactForm && canViewContactForm) {
    let contactMessagesQuery = supabase
      .from('contact_messages')
      .select(`
        id,
        name,
        email,
        subject,
        message,
        created_at,
        status,
        assigned_to,
        deleted_at,
        assigned_employee:employees!assigned_to(name, surname)
      `)
      .order('created_at', { ascending: false })
      .range(0, offset + limit);
    contactMessagesQuery = isTrash ? contactMessagesQuery.not('deleted_at', 'is', null) : contactMessagesQuery.is('deleted_at', null);
    if (showOnlyOpened) contactMessagesQuery = contactMessagesQuery.neq('status', 'new');
    const { data: contactMessages } = await contactMessagesQuery;
    if (contactMessages) {
      allMessages.push(...contactMessages.map((msg: any) => ({
        id: msg.id,
        type: 'contact_form' as const,
        from: `${msg.name} <${msg.email}>`,
        to: 'Formularz kontaktowy',
        subject: msg.subject || 'Wiadomość z formularza',
        preview: msg.message.substring(0, 100) + (msg.message.length > 100 ? '...' : ''),
        date: msg.created_at,
        isRead: msg.status !== 'new',
        isStarred: false,
        status: msg.status,
        assigned_to: msg.assigned_to,
        assigned_employee: msg.assigned_employee,
      })));
    }
  }

  if (includeSent) {
    let sentQuery = supabase
      .from('sent_emails')
      .select('id, to_address, subject, body, sent_at, email_account_id, deleted_at, employees!employee_id(name, surname, email, id)')
      .order('sent_at', { ascending: false })
      .range(0, offset + limit);
    sentQuery = isTrash ? sentQuery.not('deleted_at', 'is', null) : sentQuery.is('deleted_at', null);
    if (emailAccountId !== 'all') {
      sentQuery = sentQuery.eq('email_account_id', emailAccountId);
    } else if (user) {
      // Własne i przypisane skrzynki bez ukrytych w Ustawieniach; pusta lista = brak wyników.
      const accountIds = await inboxMailboxIds(supabase, user.id);
      sentQuery = sentQuery.in('email_account_id', mailboxFilter(accountIds));
    }
    const { data: sentEmails } = await sentQuery;
    if (sentEmails) {
      allMessages.push(...sentEmails.map((msg: any) => {
        const employee = msg.employees as any;
        const fromName = employee ? `${employee.name} ${employee.surname}` : 'System';
        const bodyText = (msg.body || '').replace(/<[^>]*>/g, '');
        return {
          id: msg.id,
          type: 'sent' as const,
          from: fromName,
          to: msg.to_address,
          subject: msg.subject,
          preview: bodyText.substring(0, 100) + (bodyText.length > 100 ? '...' : ''),
          date: msg.sent_at,
          isRead: true,
          isStarred: false,
          email_account_id: msg.email_account_id,
          isDeleted: !!msg.deleted_at,
        };
      }));
    }
  }

  if (includeReceived) {
    let receivedQuery = supabase
      .from('received_emails')
      .select(`
        id,
        from_address,
        to_address,
        subject,
        received_date,
        is_read,
        is_starred,
        assigned_to,
        email_account_id,
        deleted_at,
        assigned_employee:employees!assigned_to(name, surname)
      `)
      .order('received_date', { ascending: false })
      .range(0, offset + limit);
    receivedQuery = isTrash ? receivedQuery.not('deleted_at', 'is', null) : receivedQuery.is('deleted_at', null);
    if (showOnlyOpened) receivedQuery = receivedQuery.eq('is_read', true);
    if (emailAccountId !== 'all') {
      receivedQuery = receivedQuery.eq('email_account_id', emailAccountId);
    } else if (user) {
      // Własne i przypisane skrzynki bez ukrytych w Ustawieniach; pusta lista = brak wyników.
      const accountIds = await inboxMailboxIds(supabase, user.id);
      receivedQuery = receivedQuery.in('email_account_id', mailboxFilter(accountIds));
    }
    const { data: receivedEmails } = await receivedQuery;
    if (receivedEmails) {
      allMessages.push(...receivedEmails.map((msg: any) => ({
        id: msg.id,
        type: 'received' as const,
        from: msg.from_address,
        to: msg.to_address,
        subject: msg.subject,
        preview: '',
        date: msg.received_date,
        isRead: msg.is_read,
        isStarred: msg.is_starred,
        assigned_to: msg.assigned_to,
        assigned_employee: msg.assigned_employee,
        email_account_id: msg.email_account_id,
        isDeleted: Boolean(msg.deleted_at),
      })));
    }
  }

  if (isDrafts && user) {
    let draftsQuery = supabase
      .from('email_drafts')
      .select('id, to_address, subject, body, reply_to, email_account_id, created_at, updated_at, deleted_at')
      .eq('employee_id', user.id)
      .order('updated_at', { ascending: false })
      .range(0, offset + limit)
      .is('deleted_at', null);
    if (emailAccountId !== 'all') draftsQuery = draftsQuery.eq('email_account_id', emailAccountId);
    const { data: drafts } = await draftsQuery;
    if (drafts) {
      allMessages.push(...drafts.map((msg: any) => {
        const bodyText = (msg.body || '').replace(/<[^>]*>/g, '');
        return {
          id: msg.id,
          type: 'draft' as const,
          from: 'Wersja robocza',
          to: msg.to_address || '',
          subject: msg.subject || '(Brak tematu)',
          preview: bodyText.substring(0, 100) + (bodyText.length > 100 ? '...' : ''),
          date: msg.updated_at || msg.created_at,
          isRead: true,
          isStarred: false,
          email_account_id: msg.email_account_id,
        };
      }));
    }
  }

  allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const folderMatchesType = (msg: MessageListItem): boolean => {
    switch (filterType) {
      case 'contact_form': return msg.type === 'contact_form';
      case 'sent': return msg.type === 'sent';
      case 'received': return msg.type === 'received';
      case 'drafts': return msg.type === 'draft';
      default: return true;
    }
  };
  const filteredMessages = allMessages.filter(folderMatchesType);
  const pageEnd = offset + limit;
  const hasMore = filteredMessages.length > pageEnd;
  const messages = await withMessageSalesContext(supabase, filteredMessages.slice(offset, pageEnd));
  return { messages, hasMore, total: messages.length };
}

/** Szczegóły wiadomości; `null` — brak wiadomości lub brak dostępu. */
export async function messageDetails(
  supabase: SupabaseClient,
  { id, type }: { id: string; type: 'contact_form' | 'sent' | 'received' },
): Promise<MessageDetails | null> {
  let messageData: MessageDetails | null = null;
  if (type === 'contact_form') {
    const { data } = await supabase
      .from('contact_messages')
      .select(`
        *,
        assigned_employee:employees!assigned_to(name, surname)
      `)
      .eq('id', id)
      .single();
    if (data) {
      messageData = {
        id: data.id,
        type: 'contact_form',
        from: `${data.name} <${data.email}>`,
        to: 'Formularz kontaktowy',
        subject: data.subject || 'Wiadomość z formularza',
        preview: data.message.substring(0, 100),
        body: data.message,
        bodyHtml: `<p><strong>Od:</strong> ${data.name} (${data.email})</p>
                   ${data.phone ? `<p><strong>Telefon:</strong> ${data.phone}</p>` : ''}
                   ${data.cv_attachment ? `<p><strong>CV:</strong> <a href="${data.cv_attachment}" target="_blank" class="text-[#d3bb73] hover:underline">Pobierz</a></p>` : ''}
                   <p>${(data.message || '').replace(/\n/g, '<br>')}</p>`,
        date: data.created_at,
        isRead: data.status !== 'new',
        isStarred: false,
        status: data.status,
        assigned_to: data.assigned_to,
        assigned_employee: data.assigned_employee,
        isDeleted: Boolean(data.deleted_at),
        originalData: data,
      };
    }
  } else if (type === 'sent') {
    const { data } = await supabase.from('sent_emails').select('*, employees!employee_id(name, surname, email)').eq('id', id).single();
    if (data) {
      const employee = data.employees as any;
      const fromName = employee ? `${employee.name} ${employee.surname}` : 'System';
      const bodyText = data.body.replace(/<[^>]*>/g, '');
      // Fetch attachments for sent emails
      const { data: attachments, error: attachmentsError } = await supabase
        .from('email_attachments')
        .select('id, filename, content_type, size_bytes, storage_path')
        .eq('email_id', id)
        .eq('email_type', 'sent');
      messageData = {
        id: data.id,
        type: 'sent',
        from: fromName,
        to: data.to_address,
        subject: data.subject,
        preview: bodyText.substring(0, 100),
        body: bodyText,
        bodyHtml: data.body,
        date: data.sent_at,
        isRead: true,
        isStarred: false,
        email_account_id: data.email_account_id,
        isDeleted: Boolean(data.deleted_at),
        originalData: data,
        attachments: attachments || [],
        attachmentsError: attachmentsError ? 'Nie udało się odczytać listy załączników.' : undefined,
      };
    }
  } else if (type === 'received') {
    const { data } = await supabase
      .from('received_emails')
      .select(`
        *,
        assigned_employee:employees!assigned_to(name, surname)
      `)
      .eq('id', id)
      .single();
    if (data) {
      const { data: attachments, error: attachmentsError } = await supabase
        .from('email_attachments')
        .select('id, filename, content_type, size_bytes, storage_path')
        .eq('email_id', id)
        .eq('email_type', 'received');
      messageData = {
        id: data.id,
        type: 'received',
        from: data.from_address,
        to: data.to_address,
        subject: data.subject,
        preview: (data.body_text || '').substring(0, 100),
        body: data.body_text || '',
        bodyHtml: data.body_html || '',
        date: data.received_date,
        isRead: data.is_read,
        isStarred: data.is_starred,
        assigned_to: data.assigned_to,
        assigned_employee: data.assigned_employee,
        email_account_id: data.email_account_id,
        isDeleted: Boolean(data.deleted_at),
        originalData: data,
        attachments: attachments || [],
        attachmentsError: attachmentsError ? 'Nie udało się odczytać listy załączników.' : undefined,
      };
    }
  }
  if (!messageData) return null;
  return (await withMessageSalesContext(supabase, [messageData]))[0];
}

/** Oznaczenie przeczytania (formularz: status, poczta: is_read i synchronizacja IMAP przez funkcję `sync-email-read-state`). */
export async function markMessageRead(
  supabase: SupabaseClient,
  { id, type, isRead = true }: { id: string; type: 'contact_form' | 'received'; isRead?: boolean },
): Promise<void> {
  if (type === 'contact_form') {
    const { error } = await supabase
      .from('contact_messages')
      .update({ status: isRead ? 'read' : 'new', read_at: isRead ? new Date().toISOString() : null })
      .eq('id', id);
    if (error) throw new Error(error.message);
  } else if (type === 'received') {
    // CRM pozostaje responsywny również podczas chwilowej awarii relay workera.
    // IMAP jest synchronizowany zaraz po zapisie i ponawiany przez cykliczny sync.
    const { error: localError } = await supabase.from('received_emails').update({ is_read: isRead }).eq('id', id);
    if (localError) throw new Error(localError.message);
    const { error: syncError } = await supabase.functions.invoke('sync-email-read-state', {
      body: { messageId: id, mode: isRead ? 'mark_read' : 'mark_unread' },
    });
    if (syncError) console.warn('Email read state saved locally; IMAP sync will retry:', syncError);
  }
}

export async function toggleMessageStar(supabase: SupabaseClient, { id, isStarred }: { id: string; isStarred: boolean }): Promise<void> {
  await supabase.from('received_emails').update({ is_starred: !isStarred }).eq('id', id);
}

export async function mailboxTrashPermissions(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_mailbox_trash_permissions');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function searchMessages(
  supabase: SupabaseClient,
  user: AuthUser,
  { emailAccountId, query, dateFrom, dateTo, filterType = 'all' }: MessageSearchParams,
): Promise<{ messages: MessageListItem[]; total: number }> {
  const allMessages: MessageListItem[] = [];
  const searchQuery = query.toLowerCase();

  if (emailAccountId === 'all' || emailAccountId === 'contact_form') {
    let contactQuery = supabase
      .from('contact_messages')
      .select(`
        id,
        name,
        email,
        subject,
        message,
        created_at,
        status,
        assigned_to,
        assigned_employee:employees!assigned_to(name, surname)
      `)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (dateFrom) contactQuery = contactQuery.gte('created_at', dateFrom);
    if (dateTo) contactQuery = contactQuery.lte('created_at', dateTo);
    const { data: contactMessages } = await contactQuery;
    if (contactMessages) {
      allMessages.push(...contactMessages
        .filter((msg: any) => `${msg.name} ${msg.email} ${msg.subject || ''} ${msg.message}`.toLowerCase().includes(searchQuery))
        .map((msg: any) => ({
          id: msg.id,
          type: 'contact_form' as const,
          from: `${msg.name} <${msg.email}>`,
          to: 'Formularz kontaktowy',
          subject: msg.subject || 'Wiadomość z formularza',
          preview: msg.message.substring(0, 100) + (msg.message.length > 100 ? '...' : ''),
          date: msg.created_at,
          isRead: msg.status !== 'new',
          isStarred: false,
          status: msg.status,
          assigned_to: msg.assigned_to,
          assigned_employee: msg.assigned_employee,
        })));
    }
  }

  if (emailAccountId !== 'contact_form') {
    let sentQuery = supabase
      .from('sent_emails')
      .select('id, to_address, subject, body, sent_at, email_account_id, employees!employee_id(name, surname, email, id)')
      .is('deleted_at', null)
      .order('sent_at', { ascending: false });
    if (dateFrom) sentQuery = sentQuery.gte('sent_at', dateFrom);
    if (dateTo) sentQuery = sentQuery.lte('sent_at', dateTo);
    if (emailAccountId !== 'all') {
      sentQuery = sentQuery.eq('email_account_id', emailAccountId);
    } else if (user) {
      // Własne i przypisane skrzynki bez ukrytych w Ustawieniach; pusta lista = brak wyników.
      const accountIds = await inboxMailboxIds(supabase, user.id);
      sentQuery = sentQuery.in('email_account_id', mailboxFilter(accountIds));
    }
    const { data: sentEmails } = await sentQuery;
    if (sentEmails) {
      allMessages.push(...sentEmails
        .filter((msg: any) => `${msg.to_address} ${msg.subject || ''} ${msg.body || ''}`.toLowerCase().includes(searchQuery))
        .map((msg: any) => {
          const employeeName = msg.employees ? `${msg.employees.name} ${msg.employees.surname}` : msg.employees?.email || 'Nieznany';
          return {
            id: msg.id,
            type: 'sent' as const,
            from: employeeName,
            to: msg.to_address,
            subject: msg.subject || '(Brak tematu)',
            preview: (msg.body || '').substring(0, 100) + ((msg.body || '').length > 100 ? '...' : ''),
            date: msg.sent_at,
            isRead: true,
            isStarred: false,
            email_account_id: msg.email_account_id,
          };
        }));
    }

    let receivedQuery = supabase
      .from('received_emails')
      .select(`
        id,
        from_address,
        to_address,
        subject,
        body_text,
        received_date,
        is_read,
        is_starred,
        assigned_to,
        email_account_id,
        assigned_employee:employees!assigned_to(name, surname)
      `)
      .is('deleted_at', null)
      .order('received_date', { ascending: false });
    if (dateFrom) receivedQuery = receivedQuery.gte('received_date', dateFrom);
    if (dateTo) receivedQuery = receivedQuery.lte('received_date', dateTo);
    if (emailAccountId !== 'all') {
      receivedQuery = receivedQuery.eq('email_account_id', emailAccountId);
    } else if (user) {
      // Własne i przypisane skrzynki bez ukrytych w Ustawieniach; pusta lista = brak wyników.
      const accountIds = await inboxMailboxIds(supabase, user.id);
      receivedQuery = receivedQuery.in('email_account_id', mailboxFilter(accountIds));
    }
    const { data: receivedEmails } = await receivedQuery;
    if (receivedEmails) {
      allMessages.push(...receivedEmails
        .filter((msg: any) => `${msg.from_address} ${msg.to_address} ${msg.subject || ''} ${msg.body_text || ''}`.toLowerCase().includes(searchQuery))
        .map((msg: any) => ({
          id: msg.id,
          type: 'received' as const,
          from: msg.from_address,
          to: msg.to_address,
          subject: msg.subject || '(Brak tematu)',
          preview: (msg.body_text || '').substring(0, 100) + ((msg.body_text || '').length > 100 ? '...' : ''),
          date: msg.received_date,
          isRead: msg.is_read,
          isStarred: msg.is_starred,
          assigned_to: msg.assigned_to,
          assigned_employee: msg.assigned_employee,
          email_account_id: msg.email_account_id,
        })));
    }
  }

  allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const filteredMessages = filterType === 'all' ? allMessages : allMessages.filter((msg) => msg.type === filterType);
  return { messages: await withMessageSalesContext(supabase, filteredMessages), total: filteredMessages.length };
}

export async function emailAccounts(
  supabase: SupabaseClient,
  user: AuthUser,
): Promise<{ accounts: MessageEmailAccount[]; hasContactFormAccess: boolean; isAdmin: boolean }> {
  if (!user) return { accounts: [], hasContactFormAccess: false, isAdmin: false };
  const { data: actor, error: actorError } = await supabase
    .from('employees')
    .select('id,permissions,can_receive_contact_forms,role,access_level,preferences')
    .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
    .eq('is_active', true)
    .maybeSingle();
  if (actorError) throw actorError;
  if (!actor) return { accounts: [], hasContactFormAccess: false, isAdmin: false };
  // Get personal accounts
  const { data: personalAccounts, error: personalError } = await supabase
    .from('employee_email_accounts')
    .select('id,email_address,account_name,from_name,account_type,department,is_default,employee_id')
    .eq('employee_id', actor.id)
    .eq('is_active', true);
  if (personalError) throw personalError;
  // Get assigned shared accounts
  const { data: assignments, error: assignmentsError } = await supabase
    .from('employee_email_account_assignments')
    .select('email_account_id,can_send')
    .eq('employee_id', actor.id);
  if (assignmentsError) throw assignmentsError;
  const assignedAccountIds = assignments?.map((a) => a.email_account_id) || [];
  const hasContactFormAccess = actor.can_receive_contact_forms || false;
  const isAdmin = actor.permissions?.includes('admin') || actor.role === 'admin' || actor.access_level === 'admin';
  const hasMessagesAccess = isAdmin || actor.permissions?.some((permission: string) => ['messages_view', 'messages_manage'].includes(permission));
  let assignedAccounts: any[] = [];
  if (assignedAccountIds.length > 0) {
    const { data: assignedData, error: assignedError } = await supabase
      .from('employee_email_accounts')
      .select('id,email_address,account_name,from_name,account_type,department,is_default,employee_id')
      .in('id', assignedAccountIds)
      .eq('is_active', true);
    if (assignedError) throw assignedError;
    assignedAccounts = assignedData || [];
  }
  // Combine and deduplicate accounts
  const allUserAccounts = [...(personalAccounts || []), ...assignedAccounts];
  // Skrzynki ukryte w Ustawieniach → Powiadomienia nie pojawiają się w Wiadomościach.
  const mailboxPreferences = readMailboxViewPreferences(actor.preferences);
  const uniqueAccounts = Array.from(new Map(allUserAccounts.map((acc) => [acc.id, acc])).values()).filter((acc) => !mailboxPreferences.hidden.has(acc.id));
  // Sort accounts
  const sortedAccounts = uniqueAccounts.sort((a, b) => {
    if (a.account_type !== b.account_type) {
      const order = { system: 0, shared: 1, personal: 2 } as const;
      const aOrder = order[a.account_type as keyof typeof order] ?? 99;
      const bOrder = order[b.account_type as keyof typeof order] ?? 99;
      return aOrder - bOrder;
    }
    return a.account_name.localeCompare(b.account_name);
  });
  const getAccountTypeBadge = (accountType: string) => (accountType === 'system' ? '🔧' : accountType === 'shared' ? '🏢' : '👤');
  const formatAccountName = (account: any) => {
    const badge = getAccountTypeBadge(account.account_type);
    if (account.account_type === 'shared' && account.department) return `${badge} ${account.department} - ${account.account_name}`;
    return `${badge} ${account.account_name}`;
  };
  const formattedAccounts = sortedAccounts.map((acc) => ({
    ...acc,
    can_send: Boolean(hasMessagesAccess && (acc.employee_id === actor.id || assignments?.some((a) => a.email_account_id === acc.id && a.can_send === true))),
    display_name: formatAccountName(acc),
  }));
  // Add special accounts
  const accounts = [
    ...(formattedAccounts.length > 0
      ? [{ id: 'all', email_address: 'Wszystkie dostępne konta', from_name: 'Wszystkie konta', account_name: 'Wszystkie konta', display_name: '📧 Wszystkie konta', account_type: 'system' as const, can_send: false }]
      : []),
    ...(hasContactFormAccess || isAdmin
      ? [{ id: 'contact_form', email_address: 'Formularz kontaktowy', from_name: 'Formularz', account_name: 'Formularz kontaktowy', display_name: '📝 Formularz kontaktowy', account_type: 'system' as const, can_send: false }]
      : []),
    ...formattedAccounts,
  ];
  return { accounts, hasContactFormAccess, isAdmin };
}

export async function unreadCountsByAccount(supabase: SupabaseClient, user: AuthUser): Promise<MessageUnreadCounts> {
  if (!user) return { total: 0, contactForm: 0, byAccount: {} };
  const [{ data: employee }, { data: personalAccounts }, { data: assignments }] = await Promise.all([
    supabase.from('employees').select('permissions, can_receive_contact_forms, preferences').eq('id', user.id).maybeSingle(),
    supabase.from('employee_email_accounts').select('id').eq('employee_id', user.id).eq('is_active', true),
    supabase.from('employee_email_account_assignments').select('email_account_id').eq('employee_id', user.id),
  ]);
  const mailboxPreferences = readMailboxViewPreferences(employee?.preferences);
  const accountIds = Array.from(new Set([
    ...(personalAccounts || []).map((account) => account.id),
    ...(assignments || []).map((assignment) => assignment.email_account_id),
  ])).filter((accountId) => !mailboxPreferences.hidden.has(accountId));
  const permissions: string[] = employee?.permissions || [];
  const canViewContactForms = permissions.includes('admin') || permissions.includes('messages_manage') || employee?.can_receive_contact_forms === true;
  const [accountCounts, contactResult] = await Promise.all([
    readMailboxUnreadCounts(supabase, accountIds),
    canViewContactForms
      ? supabase.from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'new').is('deleted_at', null)
      : Promise.resolve({ count: 0, error: null }),
  ]);
  if (contactResult.error) console.warn('Could not count unread contact messages:', contactResult.error);
  const byAccount: Record<string, number> = accountCounts;
  const contactForm = contactResult.count || 0;
  // Skrzynki wyciszone mają własny licznik, ale nie wchodzą do sumy.
  const total = contactForm + Object.entries(byAccount)
    .filter(([accountId]) => !mailboxPreferences.muted.has(accountId))
    .reduce((sum, [, count]) => sum + count, 0);
  return { total, contactForm, byAccount };
}
