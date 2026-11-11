import { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { api } from './api';
import { inboxMailboxIds, mailboxFilter, readMailboxViewPreferences } from '@/lib/CRM/messages/mailboxPreferences';
import {
  emailAccounts,
  listMessages,
  markMessageRead,
  messageDetails,
  searchMessages,
  unreadCountsByAccount,
  type EmailAttachment,
  type FetchMessagesParams,
  type MessageDetails,
  type MessageEmailAccount,
  type MessageFolder,
  type MessageListItem,
  type MessageType,
  type MessageUnreadCounts,
} from '@/lib/CRM/messages/messagesQueries';

// Typy i odczyty wspólne z aplikacją na Maca (`/bridge/native/v1/messages/*`) — `src/lib/CRM/messages/messagesQueries.ts`.
export type {
  MessageType,
  MessageFolder,
  MessageListItem,
  EmailAttachment,
  MessageDetails,
  MessageUnreadCounts,
  FetchMessagesParams,
} from '@/lib/CRM/messages/messagesQueries';

async function changeMessageTrash(id: string, type: MessageType, action: 'trash' | 'restore') {
  if (type === 'received' || type === 'sent') {
    const response = await fetch('/bridge/messages/trash', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, type, action }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) throw new Error(result?.error || 'Serwer nie potwierdził zmiany. Ponów tę samą czynność.');
    return;
  }
  const { supabase } = await import('@/lib/supabase/browser');
  const table = type === 'contact_form' ? 'contact_messages' : type === 'draft' ? 'email_drafts' : null;
  if (!table) throw new Error('Nieprawidłowy typ wiadomości.');
  const { data, error } = await supabase.from(table)
    .update({ deleted_at: action === 'trash' ? new Date().toISOString() : null }).eq('id', id).select('id').maybeSingle();
  if (error || !data) throw new Error(error?.message || 'Brak uprawnień do zmiany tej wiadomości.');
}

export const messagesApi = api.injectEndpoints({
  endpoints: (builder) => ({
    getMessagesList: builder.query<
      { messages: MessageListItem[]; hasMore: boolean; total: number },
      FetchMessagesParams
    >({
      queryFn: async (params) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          const { data: { user } } = await supabase.auth.getUser();
          return { data: await listMessages(supabase, user, params) };
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

    getReceivedAttachments: builder.query<
      { attachments: EmailAttachment[]; syncError?: string },
      string
    >({
      queryFn: async (messageId, { signal }) => {
        try {
          const response = await fetch('/bridge/messages/attachments', {
            method: 'POST', credentials: 'same-origin', signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId }),
          });
          const result = await response.json();
          if (!response.ok) return { error: { status: response.status, data: result } };
          return { data: result };
        } catch {
          return { error: { status: 'CUSTOM_ERROR', error: 'Nie udało się pobrać załączników.' } };
        }
      },
      // The server persists completion; dropping the UI cache also allows a new attempt after an error.
      keepUnusedDataFor: 0,
    }),

    getSentAttachments: builder.query<
      { attachments: EmailAttachment[]; syncError?: string },
      string
    >({
      queryFn: async (messageId, { signal }) => {
        try {
          const response = await fetch('/bridge/messages/sent-attachments', {
            method: 'POST', credentials: 'same-origin', signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageId }),
          });
          const result = await response.json();
          if (!response.ok) return { error: { status: response.status, data: result } };
          return { data: result };
        } catch {
          return { error: { status: 'CUSTOM_ERROR', error: 'Nie udało się pobrać załączników.' } };
        }
      },
      // The server persists completion; dropping the UI cache also allows a new attempt after an error.
      keepUnusedDataFor: 0,
    }),

    getMessageDetails: builder.query<
      MessageDetails,
      { id: string; type: 'contact_form' | 'sent' | 'received' }
    >({
      queryFn: async ({ id, type }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          const messageData = await messageDetails(supabase, { id, type });
          if (!messageData) {
            const err: FetchBaseQueryError = { status: 404, data: { message: 'Message not found' } };
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

    markMessageAsRead: builder.mutation<
      void,
      { id: string; type: 'contact_form' | 'received'; isRead?: boolean }
    >({
      queryFn: async ({ id, type, isRead = true }) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          await markMessageRead(supabase, { id, type, isRead });
          return { data: undefined };
        } catch (error) {
          console.error('Exception marking message as read:', error);
          return { error: { status: 'CUSTOM_ERROR', error: error instanceof Error ? error.message : String(error) } };
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

    getMailboxTrashPermissions: builder.query<string[], void>({
      queryFn: async () => {
        const { supabase } = await import('@/lib/supabase/browser');
        const { data, error } = await supabase.rpc('get_mailbox_trash_permissions');
        return error ? { error: { status: 'CUSTOM_ERROR', error: error.message } } : { data: data || [] };
      },
      providesTags: ['MessagesList'],
    }),
    deleteMessage: builder.mutation<void, { id: string; type: MessageType; permanent?: boolean }>({
      queryFn: async ({ id, type, permanent = false }) => {
        try {
          if (permanent) throw new Error('Trwałe usuwanie nie jest dostępne. Użyj kosza.');
          await changeMessageTrash(id, type, 'trash');
          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: error instanceof Error ? error.message : 'Nie udało się przenieść wiadomości.' } };
        }
      },
      invalidatesTags: (result, error, { id }) => [{ type: 'Message', id }, { type: 'Message', id: 'LIST' }, 'MessagesList'],
    }),
    restoreMessage: builder.mutation<void, { id: string; type: MessageType }>({
      queryFn: async ({ id, type }) => {
        try {
          await changeMessageTrash(id, type, 'restore');
          return { data: undefined };
        } catch (error) {
          return { error: { status: 'CUSTOM_ERROR', error: error instanceof Error ? error.message : 'Nie udało się przywrócić wiadomości.' } };
        }
      },
      invalidatesTags: (result, error, { id }) => [{ type: 'Message', id }, { type: 'Message', id: 'LIST' }, 'MessagesList'],
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
      queryFn: async (params) => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          const { data: { user } } = await supabase.auth.getUser();
          return { data: await searchMessages(supabase, user, params) };
        } catch (error) {
          console.error('Error searching messages:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      keepUnusedDataFor: 300,
    }),

    getEmailAccounts: builder.query<{
      accounts: MessageEmailAccount[];
      hasContactFormAccess: boolean;
      isAdmin: boolean;
    }, void>({
      queryFn: async () => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          const { data: { user } } = await supabase.auth.getUser();
          return { data: await emailAccounts(supabase, user) };
        } catch (error) {
          console.error('Error fetching email accounts:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: ['MessagesList'],
    }),

    getUnreadCountsByAccount: builder.query<MessageUnreadCounts, void>({
      queryFn: async () => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');
          const { data: { user } } = await supabase.auth.getUser();
          return { data: await unreadCountsByAccount(supabase, user) };
        } catch (error) {
          console.error('Error fetching unread counts by account:', error);
          return { error: { status: 'CUSTOM_ERROR', error: String(error) } };
        }
      },
      providesTags: ['MessagesList'],
      keepUnusedDataFor: 60,
    }),

    getUnreadCount: builder.query<number, void>({
      queryFn: async () => {
        try {
          const { supabase } = await import('@/lib/supabase/browser');

          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            return { data: 0 };
          }

          // Counting is read-only. IMAP refresh runs on its own bounded timer;
          // otherwise Realtime UPDATE -> count -> IMAP UPDATE forms a feedback loop.
          const [{ data: employee }, { data: personalAccounts }, { data: assignments }] =
            await Promise.all([
              supabase
                .from('employees')
                .select('permissions, can_receive_contact_forms, preferences')
                .eq('id', user.id)
                .maybeSingle(),
              supabase
                .from('employee_email_accounts')
                .select('id')
                .eq('employee_id', user.id)
                .eq('is_active', true),
              supabase
                .from('employee_email_account_assignments')
                .select('email_account_id')
                .eq('employee_id', user.id),
            ]);

          // Licznik w menu: bez skrzynek ukrytych i wyciszonych w Ustawieniach → Powiadomienia.
          const mailboxPreferences = readMailboxViewPreferences(employee?.preferences);
          const accountIds = Array.from(new Set([
            ...(personalAccounts || []).map((account) => account.id),
            ...(assignments || []).map((assignment) => assignment.email_account_id),
          ])).filter((accountId) => !mailboxPreferences.hidden.has(accountId) && !mailboxPreferences.muted.has(accountId));

          const permissions: string[] = employee?.permissions || [];
          const canViewContactForms =
            permissions.includes('admin') ||
            permissions.includes('messages_manage') ||
            employee?.can_receive_contact_forms === true;

          const emailCountPromise = accountIds.length
            ? supabase
                .from('received_emails')
                .select('id', { count: 'exact', head: true })
                .in('email_account_id', accountIds)
                .eq('is_read', false)
                .is('deleted_at', null)
            : Promise.resolve({ count: 0, error: null });

          const contactCountPromise = canViewContactForms
            ? supabase
                .from('contact_messages')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'new')
                .is('deleted_at', null)
            : Promise.resolve({ count: 0, error: null });

          const [emailResult, contactResult] = await Promise.all([
            emailCountPromise,
            contactCountPromise,
          ]);

          if (emailResult.error || contactResult.error) {
            const error = emailResult.error || contactResult.error;
            console.error('Error fetching exact unread count:', error);
            return { error: { status: 'CUSTOM_ERROR', error: error?.message || 'Unknown error' } };
          }

          return { data: (emailResult.count || 0) + (contactResult.count || 0) };
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
  useGetMailboxTrashPermissionsQuery,
  useGetMessagesListQuery,
  useGetMessageDetailsQuery,
  useGetReceivedAttachmentsQuery,
  useGetSentAttachmentsQuery,
  useLazyGetMessageDetailsQuery,
  useSearchMessagesQuery,
  useLazySearchMessagesQuery,
  useMarkMessageAsReadMutation,
  useToggleStarMessageMutation,
  useDeleteMessageMutation,
  useRestoreMessageMutation,
  useGetEmailAccountsQuery,
  useGetUnreadCountsByAccountQuery,
  useGetUnreadCountQuery,
} = messagesApi;
