import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!employeeId) return;

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
        console.error(
          '[Notifications] Failed to display notification:',
          error
        );
      }
    };

    const channel = supabase
      .channel(`realtime_notifications_${employeeId}`)

      // =====================================================
      // ZWYKŁE POWIADOMIENIA CRM
      // =====================================================

      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notification_recipients',
          filter: `user_id=eq.${employeeId}`,
        },
        async (payload) => {
          const recipientRow =
            payload.new as NotificationRecipientRow;

          if (recipientRow.is_read) return;

          const { data: notification, error } = await supabase
            .from('notifications')
            .select(
              `
                title,
                message,
                category,
                related_entity_type,
                related_entity_id
              `
            )
            .eq('id', recipientRow.notification_id)
            .maybeSingle();

          if (error) {
            console.error(
              '[Notifications] Failed to fetch notification:',
              error
            );
            return;
          }

          if (!notification) return;

          await showLocalNotification({
            title: notification.title ?? 'Mavinci CRM',
            body: notification.message ?? '',
            data: {
              type:
                notification.related_entity_type ??
                notification.category ??
                'notification',
              entity_id:
                notification.related_entity_id ?? '',
              notification_id:
                recipientRow.notification_id,
            },
          });
        }
      )

      // =====================================================
      // NOWE WIADOMOŚCI KOMUNIKATORA
      // =====================================================

      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'employee_messages',
        },
        async (payload) => {
          const message = payload.new as EmployeeMessageRow;

          // Nie pokazujemy powiadomienia o własnej wiadomości
          if (message.sender_id === employeeId) return;

          // Sprawdzenie, czy aktualny pracownik uczestniczy
          // w rozmowie, do której przyszła wiadomość
          const { data: participation, error: participationError } =
            await supabase
              .from('employee_conversation_participants')
              .select('id')
              .eq('conversation_id', message.conversation_id)
              .eq('employee_id', employeeId)
              .maybeSingle();

          if (participationError) {
            console.error(
              '[Chat Notifications] Participation check failed:',
              participationError
            );
            return;
          }

          // Wiadomość nie jest przeznaczona dla tego pracownika
          if (!participation) return;

          const [
            { data: sender },
            { data: conversation },
          ] = await Promise.all([
            supabase
              .from('employees')
              .select('id, name, surname, nickname')
              .eq('id', message.sender_id)
              .maybeSingle(),

            supabase
              .from('employee_conversations')
              .select('id, title, is_group')
              .eq('id', message.conversation_id)
              .maybeSingle(),
          ]);

          const senderName =
            sender?.nickname ||
            [sender?.name, sender?.surname]
              .filter(Boolean)
              .join(' ') ||
            'Nowa wiadomość';

          const notificationTitle =
            conversation?.is_group && conversation?.title
              ? conversation.title
              : senderName;

          let notificationBody = 'Nowa wiadomość';

          if (message.message_type === 'text') {
            notificationBody =
              message.content?.trim() ||
              'Nowa wiadomość';
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
        console.log(
          '[Notifications] Realtime status:',
          status
        );
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [employeeId]);
}