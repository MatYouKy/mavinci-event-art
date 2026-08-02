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
    const { data: recipientEmployee, error: employeeError } = await supabase
      .from('employees')
      .select('auth_user_id')
      .eq('id', recipientEmployeeId)
      .maybeSingle();

    if (employeeError) {
      console.error(employeeError);
      return;
    }

    if (!recipientEmployee?.auth_user_id) {
      console.error('Brak auth_user_id dla pracownika');
      return;
    }

    const { data: notification, error: notificationError } = await supabase
      .from('notifications')
      .insert({
        title,
        message,
        category,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
      })
      .select('id')
      .single();

    if (notificationError) {
      console.error(notificationError);
      return;
    }

    const { error: recipientError } = await supabase
      .from('notification_recipients')
      .insert({
        notification_id: notification.id,
        user_id: recipientEmployee.auth_user_id,
        is_read: false,
      });

    if (recipientError) {
      console.error(recipientError);
      return;
    }

    console.log('Powiadomienie utworzone poprawnie');
  } catch (err) {
    console.error(err);
  }
}