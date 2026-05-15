import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { api } from './api';

export type MessageType = 'contact_form' | 'sent' | 'received' | 'draft';
export type MessageFolder =
  | 'all'
  | 'contact_form'
  | 'sent'
  | 'received'
  | 'drafts'
  | 'trash';

export interface MessageListItem {
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
}

export interface FetchMessagesParams {
  emailAccountId: string;
  offset?: number;
  limit?: number;
  filterType?: MessageFolder;
  includeBody?: boolean;
  showOnlyOpened?: boolean;
}

export const messagesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMessagesList: builder.query<
      { messages: MessageListItem[]; hasMore: boolean; total: number },
      FetchMessagesParams
    >({
      queryFn: async (
        { emailAccountId, offset = 0, limit = 50, filterType = 'all', showOnlyOpened = false },
        { getState }: any,
      ) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          const allMessages: MessageListItem[] = [];

          const {
            data: { user },
          } = await supabase.auth.getUser();

          const { data: currentEmployee } = user
            ? await supabase
                .from('employees')
                .select('permissions, can_receive_contact_forms')
                .eq('id', user.id)
                .maybeSingle()
            : { data: null };

          const isAdmin = currentEmployee?.permissions?.includes('admin');
          const hasMessagesManage = currentEmployee?.permissions?.includes('messages_manage');
          const hasMessagesView = currentEmployee?.permissions?.includes('messages_view');
          const canViewContactForm =
            isAdmin || hasMessagesManage || currentEmployee?.can_receive_contact_forms;

          const isTrash = filterType === 'trash';
          const isDrafts = filterType === 'drafts';
          const isSentOnly = filterType === 'sent';
          const isReceivedOnly = filterType === 'received';
          const isContactFormOnly = filterType === 'contact_form';

          const includeContactForm =
            !isDrafts &&
            !isSentOnly &&
            !isReceivedOnly &&
            (filterType === 'all' || isContactFormOnly || isTrash) &&
            (emailAccountId === 'all' || emailAccountId === 'contact_form');
          const includeSent =
            !isDrafts &&
            !isReceivedOnly &&
            !isContactFormOnly &&
            emailAccountId !== 'contact_form';
          const includeReceived =
            !isDrafts &&
            !isSentOnly &&
            !isContactFormOnly &&
            emailAccountId !== 'contact_form';

          if (includeContactForm && canViewContactForm) {
            let contactMessagesQuery = supabase
              .from('contact_messages')
              .select(
                `
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
              `,
              )
              .order('created_at', { ascending: false })
              .range(offset, offset + limit);

            if (isTrash) {
              contactMessagesQuery = contactMessagesQuery.not('deleted_at', 'is', null);
            } else {
              contactMessagesQuery = contactMessagesQuery.is('deleted_at', null);
            }

            if (showOnlyOpened) {
              contactMessagesQuery = contactMessagesQuery.neq('status', 'new');
            }

            const { data: contactMessages } = await contactMessagesQuery;

            if (contactMessages) {
              allMessages.push(
                ...contactMessages.map((msg: any) => ({
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
                })),
              );
            }
          }

          if (includeSent) {
            let sentQuery = supabase
              .from('sent_emails')
              .select(
                'id, to_address, subject, body, sent_at, email_account_id, deleted_at, employees!employee_id(name, surname, email, id)',
              )
              .order('sent_at', { ascending: false })
              .range(offset, offset + limit);

            if (isTrash) {
              sentQuery = sentQuery.not('deleted_at', 'is', null);
            } else {
              sentQuery = sentQuery.is('deleted_at', null);
            }

            if (emailAccountId !== 'all') {
              sentQuery = sentQuery.eq('email_account_id', emailAccountId);
            } else if (user) {
              const { data: personalAccounts } = await supabase
                .from('employee_email_accounts')
                .select('id')
                .eq('employee_id', user.id)
                .eq('is_active', true);

              const { data: assignedAccounts } = await supabase
                .from('employee_email_account_assignments')
                .select('email_account_id')
                .eq('employee_id', user.id);

              const accountIds = [
                ...(personalAccounts?.map((acc) => acc.id) || []),
                ...(assignedAccounts?.map((acc) => acc.email_account_id) || []),
              ];

              if (accountIds.length > 0) {
                sentQuery = sentQuery.in('email_account_id', accountIds);
              }
            }

            const { data: sentEmails } = await sentQuery;

            if (sentEmails) {
              allMessages.push(
                ...sentEmails.map((msg: any) => {
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
                }),
              );
            }
          }

          if (includeReceived) {
            let receivedQuery = supabase
              .from('received_emails')
              .select(
                `
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
              `,
              )
              .order('received_date', { ascending: false })
              .range(offset, offset + limit);

            if (isTrash) {
              receivedQuery = receivedQuery.not('deleted_at', 'is', null);
            } else {
              receivedQuery = receivedQuery.is('deleted_at', null);
            }

            if (showOnlyOpened) {
              receivedQuery = receivedQuery.eq('is_read', true);
            }

            if (emailAccountId !== 'all') {
              receivedQuery = receivedQuery.eq('email_account_id', emailAccountId);
            } else if (user) {
              const { data: personalAccounts } = await supabase
                .from('employee_email_accounts')
                .select('id')
                .eq('employee_id', user.id)
                .eq('is_active', true);

              const { data: assignedAccounts } = await supabase
                .from('employee_email_account_assignments')
                .select('email_account_id')
                .eq('employee_id', user.id);

              const accountIds = [
                ...(personalAccounts?.map((acc) => acc.id) || []),
                ...(assignedAccounts?.map((acc) => acc.email_account_id) || []),
              ];

              if (accountIds.length > 0) {
                receivedQuery = receivedQuery.in('email_account_id', accountIds);
              }
            }

            const { data: receivedEmails } = await receivedQuery;

            if (receivedEmails) {
              allMessages.push(
                ...receivedEmails.map((msg: any) => ({
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
                })),
              );
            }
          }

          if (isDrafts && user) {
            let draftsQuery = supabase
              .from('email_drafts')
              .select(
                'id, to_address, subject, body, reply_to, email_account_id, created_at, updated_at, deleted_at',
              )
              .eq('employee_id', user.id)
              .order('updated_at', { ascending: false })
              .range(offset, offset + limit)
              .is('deleted_at', null);

            if (emailAccountId !== 'all') {
              draftsQuery = draftsQuery.eq('email_account_id', emailAccountId);
            }

            const { data: drafts } = await draftsQuery;
            if (drafts) {
              allMessages.push(
                ...drafts.map((msg: any) => {
                  const bodyText = (msg.body || '').replace(/<[^>]*>/g, '');
                  return {
                    id: msg.id,
                    type: 'draft' as const,
                    from: 'Wersja robocza',
                    to: msg.to_address || '',
                    subject: msg.subject || '(Brak tematu)',
                    preview:
                      bodyText.substring(0, 100) + (bodyText.length > 100 ? '...' : ''),
                    date: msg.updated_at || msg.created_at,
                    isRead: true,
                    isStarred: false,
                    email_account_id: msg.email_account_id,
                  };
                }),
              );
            }
          }

          allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          const folderMatchesType = (msg: MessageListItem): boolean => {
            switch (filterType) {
              case 'all':
                return true;
              case 'contact_form':
                return msg.type === 'contact_form';
              case 'sent':
                return msg.type === 'sent';
              case 'received':
                return msg.type === 'received';
              case 'drafts':
                return msg.type === 'draft';
              case 'trash':
                return true;
              default:
                return true;
            }
          };

          const filteredMessages = allMessages.filter(folderMatchesType);

          const hasMore = filteredMessages.length > limit;
          const messages = hasMore ? filteredMessages.slice(0, limit) : filteredMessages;

          return {
            data: {
              messages,
              hasMore,
              total: messages.length,
            },
          };
        } catch (error) {
          console.error('Error fetching messages:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: (result, error, { emailAccountId, filterType }) => {
        const tags: any[] = [
          { type: 'Message', id: 'LIST' },
          { type: 'Message', id: `LIST-${emailAccountId}` },
          { type: 'Message', id: `LIST-${emailAccountId}-${filterType}` },
        ];
        if (result) {
          result.messages.forEach(msg => {
            tags.push({ type: 'Message', id: msg.id });
          });
        }
        return tags;
      },
      keepUnusedDataFor: 7200,
    }),

    getMessageDetails: builder.query<
      MessageDetails,
      { id: string; type: 'contact_form' | 'sent' | 'received' }
    >({
      queryFn: async ({ id, type }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          let messageData: MessageDetails | null = null;

          if (type === 'contact_form') {
            const { data } = await supabase
              .from('contact_messages')
              .select(
                `
                *,
                assigned_employee:employees!assigned_to(name, surname)
              `,
              )
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
                originalData: data,
              };
            }
          } else if (type === 'sent') {
            const { data } = await supabase
              .from('sent_emails')
              .select('*, employees!employee_id(name, surname, email)')
              .eq('id', id)
              .single();

            if (data) {
              const employee = data.employees as any;
              const fromName = employee ? `${employee.name} ${employee.surname}` : 'System';
              const bodyText = data.body.replace(/<[^>]*>/g, '');

              // Fetch attachments for sent emails
              const { data: attachments } = await supabase
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
                originalData: data,
                attachments: attachments || [],
              };
            }
          } else if (type === 'received') {
            const { data } = await supabase
              .from('received_emails')
              .select(
                `
                *,
                assigned_employee:employees!assigned_to(name, surname)
              `,
              )
              .eq('id', id)
              .single();

            if (data) {
              const { data: attachments } = await supabase
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
                originalData: data,
                attachments: attachments || [],
              };
            }
          }

          if (!messageData) {
            const err: FetchBaseQueryError = {
              status: 404,
              data: { message: 'Message not found' },
            };
            return { error: err };
          }

          return { data: messageData };
        } catch (error) {
          console.error('Error fetching message details:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: (result, error, { id }) => [{ type: 'Message', id }],
      keepUnusedDataFor: 7200,
    }),

    markMessageAsRead: builder.mutation<void, { id: string; type: 'contact_form' | 'received' }>({
      queryFn: async ({ id, type }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');

          if (type === 'contact_form') {
            const { error } = await supabase
              .from('contact_messages')
              .update({ status: 'read', read_at: new Date().toISOString() })
              .eq('id', id);

            if (error) {
              console.error('Error marking contact message as read:', error);
              return { error: { status: 'CUSTOM_ERROR', error: error.message } };
            }
          } else if (type === 'received') {
            const { error } = await supabase
              .from('received_emails')
              .update({ is_read: true })
              .eq('id', id);

            if (error) {
              console.error('Error marking email as read:', error);
              return { error: { status: 'CUSTOM_ERROR', error: error.message } };
            }
          }

          return { data: undefined };
        } catch (error) {
          console.error('Exception marking message as read:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: 'Message', id },
        'MessagesList',
      ],
    }),

    toggleStarMessage: builder.mutation<void, { id: string; isStarred: boolean }>({
      queryFn: async ({ id, isStarred }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');

          await supabase.from('received_emails').update({ is_starred: !isStarred }).eq('id', id);

          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: 'Message', id },
      ],
    }),

    deleteMessage: builder.mutation<
      void,
      { id: string; type: MessageType; permanent?: boolean }
    >({
      queryFn: async ({ id, type, permanent = false }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');

          const tableName =
            type === 'contact_form'
              ? 'contact_messages'
              : type === 'received'
                ? 'received_emails'
                : type === 'draft'
                  ? 'email_drafts'
                  : 'sent_emails';

          if (permanent) {
            await supabase.from(tableName).delete().eq('id', id);
          } else {
            await supabase
              .from(tableName)
              .update({ deleted_at: new Date().toISOString() })
              .eq('id', id);
          }

          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      invalidatesTags: [{ type: 'Message', id: 'LIST' }],
    }),

    restoreMessage: builder.mutation<void, { id: string; type: MessageType }>({
      queryFn: async ({ id, type }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');

          const tableName =
            type === 'contact_form'
              ? 'contact_messages'
              : type === 'received'
                ? 'received_emails'
                : type === 'draft'
                  ? 'email_drafts'
                  : 'sent_emails';

          await supabase.from(tableName).update({ deleted_at: null }).eq('id', id);

          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      invalidatesTags: [{ type: 'Message', id: 'LIST' }],
    }),

    searchMessages: builder.query<
      { messages: MessageListItem[]; total: number },
      {
        emailAccountId: string;
        query: string;
        dateFrom?: string;
        dateTo?: string;
        filterType?: 'all' | 'contact_form' | 'sent' | 'received';
      }
    >({
      queryFn: async ({ emailAccountId, query, dateFrom, dateTo, filterType = 'all' }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          const allMessages: MessageListItem[] = [];
          const searchQuery = query.toLowerCase();

          if (emailAccountId === 'all' || emailAccountId === 'contact_form') {
            let contactQuery = supabase
              .from('contact_messages')
              .select(
                `
                id,
                name,
                email,
                subject,
                message,
                created_at,
                status,
                assigned_to,
                assigned_employee:employees!assigned_to(name, surname)
              `,
              )
              .order('created_at', { ascending: false });

            if (dateFrom) {
              contactQuery = contactQuery.gte('created_at', dateFrom);
            }
            if (dateTo) {
              contactQuery = contactQuery.lte('created_at', dateTo);
            }

            const { data: contactMessages } = await contactQuery;

            if (contactMessages) {
              allMessages.push(
                ...contactMessages
                  .filter((msg: any) => {
                    const searchIn =
                      `${msg.name} ${msg.email} ${msg.subject || ''} ${msg.message}`.toLowerCase();
                    return searchIn.includes(searchQuery);
                  })
                  .map((msg: any) => ({
                    id: msg.id,
                    type: 'contact_form' as const,
                    from: `${msg.name} <${msg.email}>`,
                    to: 'Formularz kontaktowy',
                    subject: msg.subject || 'Wiadomość z formularza',
                    preview:
                      msg.message.substring(0, 100) + (msg.message.length > 100 ? '...' : ''),
                    date: msg.created_at,
                    isRead: msg.status !== 'new',
                    isStarred: false,
                    status: msg.status,
                    assigned_to: msg.assigned_to,
                    assigned_employee: msg.assigned_employee,
                  })),
              );
            }
          }

          if (emailAccountId !== 'contact_form') {
            const { supabase } = await import('@/lib/supabase/browser');
            const {
              data: { user },
            } = await supabase.auth.getUser();

            let sentQuery = supabase
              .from('sent_emails')
              .select(
                'id, to_address, subject, body, sent_at, email_account_id, employees!employee_id(name, surname, email, id)',
              )
              .order('sent_at', { ascending: false });

            if (dateFrom) {
              sentQuery = sentQuery.gte('sent_at', dateFrom);
            }
            if (dateTo) {
              sentQuery = sentQuery.lte('sent_at', dateTo);
            }

            if (emailAccountId !== 'all') {
              sentQuery = sentQuery.eq('email_account_id', emailAccountId);
            } else if (user) {
              const { data: personalAccounts } = await supabase
                .from('employee_email_accounts')
                .select('id')
                .eq('employee_id', user.id)
                .eq('is_active', true);

              const { data: assignedAccounts } = await supabase
                .from('employee_email_account_assignments')
                .select('email_account_id')
                .eq('employee_id', user.id);

              const accountIds = [
                ...(personalAccounts?.map((acc) => acc.id) || []),
                ...(assignedAccounts?.map((acc) => acc.email_account_id) || []),
              ];

              if (accountIds.length > 0) {
                sentQuery = sentQuery.in('email_account_id', accountIds);
              }
            }

            const { data: sentEmails } = await sentQuery;

            if (sentEmails) {
              allMessages.push(
                ...sentEmails
                  .filter((msg: any) => {
                    const searchIn =
                      `${msg.to_address} ${msg.subject || ''} ${msg.body || ''}`.toLowerCase();
                    return searchIn.includes(searchQuery);
                  })
                  .map((msg: any) => {
                    const employeeName = msg.employees
                      ? `${msg.employees.name} ${msg.employees.surname}`
                      : msg.employees?.email || 'Nieznany';
                    return {
                      id: msg.id,
                      type: 'sent' as const,
                      from: employeeName,
                      to: msg.to_address,
                      subject: msg.subject || '(Brak tematu)',
                      preview:
                        (msg.body || '').substring(0, 100) +
                        ((msg.body || '').length > 100 ? '...' : ''),
                      date: msg.sent_at,
                      isRead: true,
                      isStarred: false,
                      email_account_id: msg.email_account_id,
                    };
                  }),
              );
            }

            let receivedQuery = supabase
              .from('received_emails')
              .select(
                `
                id,
                from_address,
                to_address,
                subject,
                received_date,
                is_read,
                is_starred,
                assigned_to,
                email_account_id,
                assigned_employee:employees!assigned_to(name, surname)
              `,
              )
              .order('received_date', { ascending: false });

            if (dateFrom) {
              receivedQuery = receivedQuery.gte('received_date', dateFrom);
            }
            if (dateTo) {
              receivedQuery = receivedQuery.lte('received_date', dateTo);
            }

            if (emailAccountId !== 'all') {
              receivedQuery = receivedQuery.eq('email_account_id', emailAccountId);
            } else if (user) {
              const { data: userAccounts } = await supabase
                .from('employee_email_accounts')
                .select('id')
                .eq('employee_id', user.id)
                .eq('is_active', true);

              if (userAccounts && userAccounts.length > 0) {
                const accountIds = userAccounts.map((acc) => acc.id);
                receivedQuery = receivedQuery.in('email_account_id', accountIds);
              }
            }

            const { data: receivedEmails } = await receivedQuery;

            if (receivedEmails) {
              allMessages.push(
                ...receivedEmails
                  .filter((msg: any) => {
                    const searchIn =
                      `${msg.from_address} ${msg.to_address} ${msg.subject || ''}`.toLowerCase();
                    return searchIn.includes(searchQuery);
                  })
                  .map((msg: any) => ({
                    id: msg.id,
                    type: 'received' as const,
                    from: msg.from_address,
                    to: msg.to_address,
                    subject: msg.subject || '(Brak tematu)',
                    preview: '',
                    date: msg.received_date,
                    isRead: msg.is_read,
                    isStarred: msg.is_starred,
                    assigned_to: msg.assigned_to,
                    assigned_employee: msg.assigned_employee,
                    email_account_id: msg.email_account_id,
                  })),
              );
            }
          }

          allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          const filteredMessages =
            filterType === 'all'
              ? allMessages
              : allMessages.filter((msg) => msg.type === filterType);

          return {
            data: {
              messages: filteredMessages,
              total: filteredMessages.length,
            },
          };
        } catch (error) {
          console.error('Error searching messages:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      keepUnusedDataFor: 300,
    }),

    getEmailAccounts: builder.query<{
      accounts: Array<{
        id: string;
        email_address: string;
        account_name: string;
        from_name: string;
        account_type: 'personal' | 'shared' | 'system';
        department?: string;
        display_name: string;
      }>;
      hasContactFormAccess: boolean;
      isAdmin: boolean;
    }, void>({
      queryFn: async () => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');

          const {
            data: { user },
          } = await supabase.auth.getUser();

          if (!user) {
            return { data: { accounts: [], hasContactFormAccess: false, isAdmin: false } };
          }

          // Get personal accounts
          const { data: personalAccounts } = await supabase
            .from('employee_email_accounts')
            .select('*')
            .eq('employee_id', user.id)
            .eq('is_active', true);

          // Get assigned shared accounts
          const { data: assignments } = await supabase
            .from('employee_email_account_assignments')
            .select('email_account_id')
            .eq('employee_id', user.id);

          const assignedAccountIds = assignments?.map((a) => a.email_account_id) || [];

          // Get employee data for contact form access
          const { data: employeeData } = await supabase
            .from('employees')
            .select('can_receive_contact_forms, permissions')
            .eq('id', user.id)
            .maybeSingle();

          const hasContactFormAccess = employeeData?.can_receive_contact_forms || false;
          const isAdmin = employeeData?.permissions?.includes('admin') || false;

          let assignedAccounts: any[] = [];
          if (assignedAccountIds.length > 0) {
            const { data: assignedData } = await supabase
              .from('employee_email_accounts')
              .select('*')
              .in('id', assignedAccountIds)
              .eq('is_active', true);

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
              const order = { system: 0, shared: 1, personal: 2 } as const;
              return order[a.account_type] - order[b.account_type];
            }
            return a.account_name.localeCompare(b.account_name);
          });

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

          const formattedAccounts = sortedAccounts.map((acc) => ({
            ...acc,
            display_name: formatAccountName(acc),
          }));

          // Add special accounts
          const accounts = [
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

          return { data: { accounts, hasContactFormAccess, isAdmin } };
        } catch (error) {
          console.error('Error fetching email accounts:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: ['MessagesList'],
    }),

    getUnreadCount: builder.query<number, void>({
      queryFn: async () => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');

          // Get current user email
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.email) {
            return { data: 0 };
          }

          // Use optimized RPC function
          const { data, error } = await supabase.rpc('get_unread_messages_count', {
            user_email: user.email,
          });

          if (error) {
            console.error('Error fetching unread count via RPC:', error);
            return { data: 0 };
          }

          // Function returns array with one row
          const result = Array.isArray(data) && data.length > 0 ? data[0] : null;
          const total = result?.total_unread || 0;

          return { data: Number(total) };
        } catch (error) {
          console.error('Error fetching unread count:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: ['MessagesList'],
      keepUnusedDataFor: 60,
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetMessagesListQuery,
  useGetMessageDetailsQuery,
  useSearchMessagesQuery,
  useLazySearchMessagesQuery,
  useMarkMessageAsReadMutation,
  useToggleStarMessageMutation,
  useDeleteMessageMutation,
  useRestoreMessageMutation,
  useGetEmailAccountsQuery,
  useGetUnreadCountQuery,
} = messagesApi;
