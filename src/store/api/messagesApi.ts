import { api } from './api';

export interface MessageListItem {
  id: string;
  type: 'contact_form' | 'sent' | 'received';
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
}

export interface MessageDetails extends MessageListItem {
  body: string;
  bodyHtml?: string;
  originalData: any;
}

export interface FetchMessagesParams {
  emailAccountId: string;
  offset?: number;
  limit?: number;
  filterType?: 'all' | 'contact_form' | 'sent' | 'received';
  includeBody?: boolean;
}

export const messagesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMessagesList: builder.query<
      { messages: MessageListItem[]; hasMore: boolean; total: number },
      FetchMessagesParams
    >({
      queryFn: async ({ emailAccountId, offset = 0, limit = 50, filterType = 'all' }, { getState }: any) => {
        try {
          const { supabase } = await import('@/lib/supabase');
          const allMessages: MessageListItem[] = [];

          if (emailAccountId === 'all' || emailAccountId === 'contact_form') {
            const { data: contactMessages } = await supabase
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
              .order('created_at', { ascending: false })
              .range(offset, offset + limit - 1);

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
                }))
              );
            }
          }

          if (emailAccountId !== 'contact_form') {
            let sentQuery = supabase
              .from('sent_emails')
              .select('id, to_address, subject, body, sent_at, email_account_id, employees!employee_id(name, surname, email)')
              .order('sent_at', { ascending: false })
              .range(offset, offset + limit - 1);

            if (emailAccountId !== 'all') {
              sentQuery = sentQuery.eq('email_account_id', emailAccountId);
            }

            const { data: sentEmails } = await sentQuery;

            if (sentEmails) {
              allMessages.push(
                ...sentEmails.map((msg: any) => {
                  const employee = msg.employees as any;
                  const fromName = employee ? `${employee.name} ${employee.surname}` : 'System';
                  const bodyText = msg.body.replace(/<[^>]*>/g, '');
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
                  };
                })
              );
            }

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
                assigned_employee:employees!assigned_to(name, surname)
              `)
              .order('received_date', { ascending: false })
              .range(offset, offset + limit - 1);

            if (emailAccountId !== 'all') {
              receivedQuery = receivedQuery.eq('email_account_id', emailAccountId);
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
                }))
              );
            }
          }

          allMessages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          const filteredMessages = filterType === 'all'
            ? allMessages
            : allMessages.filter(msg => msg.type === filterType);

          return {
            data: {
              messages: filteredMessages,
              hasMore: filteredMessages.length >= limit,
              total: filteredMessages.length,
            },
          };
        } catch (error) {
          console.error('Error fetching messages:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: (result, error, { emailAccountId }) => [
        { type: 'Message', id: 'LIST' },
        { type: 'Message', id: emailAccountId },
      ],
      keepUnusedDataFor: 300,
    }),

    getMessageDetails: builder.query<MessageDetails, { id: string; type: 'contact_form' | 'sent' | 'received' }>({
      queryFn: async ({ id, type }) => {
        try {
          const { supabase } = await import('@/lib/supabase');
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
              };
            }
          }

          if (!messageData) {
            return { error: { status: 404, error: 'Message not found' } };
          }

          return { data: messageData };
        } catch (error) {
          console.error('Error fetching message details:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: (result, error, { id }) => [{ type: 'Message', id }],
      keepUnusedDataFor: 600,
    }),

    markMessageAsRead: builder.mutation<void, { id: string; type: 'contact_form' | 'received' }>({
      queryFn: async ({ id, type }) => {
        try {
          const { supabase } = await import('@/lib/supabase');

          if (type === 'contact_form') {
            await supabase
              .from('contact_messages')
              .update({ status: 'read', read_at: new Date().toISOString() })
              .eq('id', id);
          } else if (type === 'received') {
            await supabase
              .from('received_emails')
              .update({ is_read: true })
              .eq('id', id);
          }

          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      invalidatesTags: (result, error, { id }) => [{ type: 'Message', id }, { type: 'Message', id: 'LIST' }],
    }),

    toggleStarMessage: builder.mutation<void, { id: string; isStarred: boolean }>({
      queryFn: async ({ id, isStarred }) => {
        try {
          const { supabase } = await import('@/lib/supabase');

          await supabase
            .from('received_emails')
            .update({ is_starred: !isStarred })
            .eq('id', id);

          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      invalidatesTags: (result, error, { id }) => [{ type: 'Message', id }, { type: 'Message', id: 'LIST' }],
    }),

    deleteMessage: builder.mutation<void, { id: string; type: 'contact_form' | 'sent' | 'received' }>({
      queryFn: async ({ id, type }) => {
        try {
          const { supabase } = await import('@/lib/supabase');

          const tableName =
            type === 'contact_form' ? 'contact_messages' : type === 'received' ? 'received_emails' : 'sent_emails';

          await supabase.from(tableName).delete().eq('id', id);

          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      invalidatesTags: [{ type: 'Message', id: 'LIST' }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetMessagesListQuery,
  useGetMessageDetailsQuery,
  useMarkMessageAsReadMutation,
  useToggleStarMessageMutation,
  useDeleteMessageMutation,
} = messagesApi;
