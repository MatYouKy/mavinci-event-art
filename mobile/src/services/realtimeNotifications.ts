import { useEffect, useRef, useCallback } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

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
      }: {
        title: string;
        body: string;
        data?: Record<string, string>;
      }) => {
        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title,
              body,
              sound: 'default',
              data: data ?? {},
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
            if (recipientRow.is_read) return;

            const { data: notification, error } = await supabase
              .from('notifications')
              .select('title, message, category, related_entity_type, related_entity_id')
              .eq('id', recipientRow.notification_id)
              .maybeSingle();

            if (error || !notification) return;

            await showLocalNotification({
              title: notification.title ?? 'Mavinci CRM',
              body: notification.message ?? '',
              data: {
                type: notification.related_entity_type ?? notification.category ?? 'notification',
                entity_id: notification.related_entity_id ?? '',
                notification_id: recipientRow.notification_id,
              },
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
