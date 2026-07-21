import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

export function useRealtimePushNotifications(employeeId: string | undefined) {
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!employeeId) return;

    const channel = supabase
      .channel(`push_notifications_${employeeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notification_recipients',
          filter: `user_id=eq.${employeeId}`,
        },
        async (payload) => {
          const recipientRow = payload.new as {
            notification_id: string;
            is_read: boolean;
          };

          if (recipientRow.is_read) return;

          const { data: notification } = await supabase
            .from('notifications')
            .select('title, message, category, related_entity_type, related_entity_id')
            .eq('id', recipientRow.notification_id)
            .maybeSingle();

          if (!notification) return;

          await Notifications.scheduleNotificationAsync({
            content: {
              title: notification.title ?? 'Mavinci CRM',
              body: notification.message ?? '',
              sound: 'default',
              data: {
                type: notification.related_entity_type ?? notification.category,
                entity_id: notification.related_entity_id ?? '',
                notification_id: recipientRow.notification_id,
              },
            },
            trigger: null,
          });
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [employeeId]);
}
