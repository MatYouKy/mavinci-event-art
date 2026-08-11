import { useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { humanizeMessageEnums } from '../lib/messageLabels';

// CRM banners are delivered remotely from the database for every recipient.
// Realtime remains responsible for chat messages only, preventing duplicate
// local + remote banners while the app is open.
const REMOTE_CRM_PUSH_ENABLED = true;

type NotificationRecipientRow = {
  notification_id: string;
  user_id: string;
  is_read: boolean;
};

type EmployeeMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  created_at: string;
};

function htmlToNotificationText(value: string | null | undefined) {
  if (!value) return '';
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useRealtimePushNotifications(
  employeeId: string | undefined
) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const conversationIdsRef = useRef<string[]>([]);

  const fetchConversationIds = useCallback(async () => {
    if (!employeeId) return [];
    const { data } = await supabase
      .from('employee_conversation_participants')
      .select('conversation_id')
      .eq('employee_id', employeeId);
    return (data || []).map((p) => p.conversation_id);
  }, [employeeId]);

  useEffect(() => {
    if (!employeeId) return;

    let isCleanedUp = false;

    const setup = async () => {
      const convIds = await fetchConversationIds();
      if (isCleanedUp) return;
      conversationIdsRef.current = convIds;

      console.log('[Notifications] Setting up realtime for', convIds.length, 'conversations');

      const showLocalNotification = async ({
        title,
        body,
        data,
        categoryIdentifier,
      }: {
        title: string;
        body: string;
        data?: Record<string, string>;
        categoryIdentifier?: string;
      }) => {
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title,
              body,
              sound: 'default',
              data: data ?? {},
              categoryIdentifier,
            },
            trigger: null,
          });
        } catch (error) {
          console.error('[Notifications] Failed to display notification:', error);
        }
      };

      const channel = supabase
        .channel(`realtime_notifications_${employeeId}`)

        // CRM notifications (filtered by user_id - works with default replica identity)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notification_recipients',
            filter: `user_id=eq.${employeeId}`,
          },
          async (payload) => {
            const recipientRow = payload.new as NotificationRecipientRow;
            if (recipientRow.is_read || REMOTE_CRM_PUSH_ENABLED) return;

            const { data: notification, error } = await supabase
              .from('notifications')
              .select('title, message, category, related_entity_type, related_entity_id, action_url, metadata')
              .eq('id', recipientRow.notification_id)
              .maybeSingle();

            if (error || !notification) return;

            const notificationMetadata =
              notification.metadata && typeof notification.metadata === 'object'
                ? notification.metadata as Record<string, unknown>
                : null;

            // Task assignment already sends a native remote push. Avoid showing
            // the same banner twice while the app is in the foreground.
            if (notificationMetadata?.kind === 'task_assignment') return;
            if (notificationMetadata?.kind === 'vehicle_pickup') return;

            const inboundEventId =
              typeof notificationMetadata?.inbound_event_id === 'string'
                ? notificationMetadata.inbound_event_id
                : '';
            const invitationAssignmentId =
              typeof notificationMetadata?.assignment_id === 'string'
                ? notificationMetadata.assignment_id
                : '';
            const invitationEventId =
              typeof notificationMetadata?.event_id === 'string'
                ? notificationMetadata.event_id
                : notification.related_entity_type === 'event'
                  ? notification.related_entity_id ?? ''
                  : '';
            const isEventInvitation =
              invitationAssignmentId.length > 0 &&
              notificationMetadata?.requires_response === true;

            let localTitle = notification.title ?? 'Mavinci CRM';
            let localBody = notification.message ?? '';

            if (
              notification.related_entity_type === 'received_email' &&
              notification.related_entity_id
            ) {
              const { data: email } = await supabase
                .from('received_emails')
                .select('from_address, subject, body_text, body_html')
                .eq('id', notification.related_entity_id)
                .maybeSingle();

              if (email) {
                const preview = (email.body_text?.trim() || htmlToNotificationText(email.body_html)).slice(0, 180);
                localTitle = email.subject?.trim() || 'Nowa wiadomość e-mail';
                localBody = preview
                  ? `Od: ${email.from_address}\n${preview}${preview.length === 180 ? '…' : ''}`
                  : `Od: ${email.from_address}`;
              }
            }

            if (
              notification.related_entity_type === 'contact_messages' &&
              notification.related_entity_id
            ) {
              const { data: contactMessage } = await supabase
                .from('contact_messages')
                .select('name, email, subject, message')
                .eq('id', notification.related_entity_id)
                .maybeSingle();

              if (contactMessage) {
                const preview = (contactMessage.message || '').trim().slice(0, 180);
                localTitle = contactMessage.subject?.trim() || 'Nowa wiadomość z mavinci.pl';
                localBody = preview
                  ? `Od: ${contactMessage.name} (${contactMessage.email})\n${preview}${preview.length === 180 ? '…' : ''}`
                  : `Od: ${contactMessage.name} (${contactMessage.email})`;
              }
            }

            await showLocalNotification({
              title: humanizeMessageEnums(localTitle),
              body: humanizeMessageEnums(localBody),
              data: {
                type: 'crm_notification',
                entity_type: notification.related_entity_type ?? '',
                entity_id: notification.related_entity_id ?? '',
                notification_id: recipientRow.notification_id,
                category: notification.category ?? '',
                action_url: notification.action_url ?? '',
                inbound_event_id: inboundEventId,
                initial_tab:
                  typeof notificationMetadata?.initial_tab === 'string'
                    ? notificationMetadata.initial_tab
                    : '',
                assignment_id: invitationAssignmentId,
                event_id: invitationEventId,
                requires_response: isEventInvitation ? 'true' : 'false',
              },
              categoryIdentifier: isEventInvitation ? 'event_invitation' : undefined,
            });
          }
        )

        // Chat messages: subscribe without filter
        // Requires REPLICA IDENTITY FULL on employee_messages table
        // Falls back: if no realtime events arrive, push notifications via edge function handle it
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'employee_messages',
          },
          async (payload) => {
            const message = payload.new as EmployeeMessageRow;

            // Skip own messages
            if (message.sender_id === employeeId) return;

            // Only notify if user is a participant
            if (!conversationIdsRef.current.includes(message.conversation_id)) {
              // Refresh conversation list in case it changed
              const updatedIds = await fetchConversationIds();
              conversationIdsRef.current = updatedIds;
              if (!updatedIds.includes(message.conversation_id)) return;
            }

            // Get sender info
            const { data: sender } = await supabase
              .from('employees')
              .select('id, name, surname, nickname')
              .eq('id', message.sender_id)
              .maybeSingle();

            const senderName =
              sender?.nickname ||
              [sender?.name, sender?.surname].filter(Boolean).join(' ') ||
              'Nowa wiadomość';

            // Check if group conversation
            const { data: conversation } = await supabase
              .from('employee_conversations')
              .select('title, is_group')
              .eq('id', message.conversation_id)
              .maybeSingle();

            const notificationTitle =
              conversation?.is_group && conversation?.title
                ? conversation.title
                : senderName;

            let notificationBody = 'Nowa wiadomość';
            if (message.message_type === 'text') {
              notificationBody = message.content?.trim() || 'Nowa wiadomość';
            } else if (message.message_type === 'image') {
              notificationBody = 'Przesłano zdjęcie';
            } else if (message.message_type === 'file') {
              notificationBody = 'Przesłano plik';
            }

            await showLocalNotification({
              title: notificationTitle,
              body: notificationBody,
              data: {
                type: 'chat_message',
                conversation_id: message.conversation_id,
                message_id: message.id,
                sender_id: message.sender_id,
              },
            });
          }
        )

        .subscribe((status) => {
          console.log('[Notifications] Realtime channel status:', status);
        });

      channelRef.current = channel;
    };

    setup();

    return () => {
      isCleanedUp = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [employeeId, fetchConversationIds]);
}
