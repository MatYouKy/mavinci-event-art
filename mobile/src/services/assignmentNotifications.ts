import { supabase } from '../lib/supabase';

interface NotifyAssignmentParams {
  recipientEmployeeId: string;
  senderName: string;
  title: string;
  message: string;
  category: string;
  relatedEntityType: string;
  relatedEntityId: string;
}

export async function sendAssignmentNotification({
  recipientEmployeeId,
  senderName,
  title,
  message,
  category,
  relatedEntityType,
  relatedEntityId,
}: NotifyAssignmentParams): Promise<void> {
  try {
    const { data: notification, error: notifError } = await supabase
      .from('notifications')
      .insert({
        title,
        message,
        category,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
        created_by_name: senderName,
      })
      .select('id')
      .single();

    if (notifError || !notification) return;

    await supabase.from('notification_recipients').insert({
      notification_id: notification.id,
      user_id: recipientEmployeeId,
      is_read: false,
    });
  } catch {
    // Silently fail - notification is non-critical
  }
}
