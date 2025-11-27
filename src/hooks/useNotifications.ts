import { supabase } from '@/lib/supabase';

interface NotificationData {
  title: string;
  message: string;
  category: 'client' | 'event' | 'offer' | 'employee' | 'system' | 'global' | 'contact_form' | 'tasks' | 'event_assignment' | 'event_update' | 'message_assignment';
  type?: 'info' | 'success' | 'warning' | 'error';
  relatedEntityType?: 'client' | 'event' | 'offer' | 'employee' | 'equipment' | 'contact_messages' | 'task' | 'vehicle' | 'maintenance_record' | 'insurance_policy' | 'fuel_entry';
  relatedEntityId?: string;
  actionUrl?: string;
}

export function useNotifications() {
  const sendToAll = async (data: NotificationData) => {
    try {
      const { data: notification, error: notificationError } = await supabase
        .from('notifications')
        .insert({
          title: data.title,
          message: data.message,
          category: data.category,
          type: data.type || 'info',
          related_entity_type: data.relatedEntityType,
          related_entity_id: data.relatedEntityId,
          action_url: data.actionUrl,
        })
        .select('id')
        .single();

      if (notificationError) throw notificationError;

      const { data: employees, error: employeesError } = await supabase
        .from('employees')
        .select('id')
        .eq('is_active', true);

      if (employeesError) throw employeesError;

      if (!employees || employees.length === 0) {
        return { success: true, notificationId: notification.id, recipientsCount: 0 };
      }

      const recipients = employees.map((emp) => ({
        notification_id: notification.id,
        user_id: emp.id,
        is_read: false,
      }));

      const { error: recipientsError } = await supabase
        .from('notification_recipients')
        .insert(recipients);

      if (recipientsError) throw recipientsError;

      return {
        success: true,
        notificationId: notification.id,
        recipientsCount: recipients.length
      };
    } catch (error) {
      console.error('Error sending notification to all:', error);
      return { success: false, error };
    }
  };

  const sendToPermission = async (
    permission: string,
    data: NotificationData
  ) => {
    try {
      const { data: notification, error: notificationError } = await supabase
        .from('notifications')
        .insert({
          title: data.title,
          message: data.message,
          category: data.category,
          type: data.type || 'info',
          related_entity_type: data.relatedEntityType,
          related_entity_id: data.relatedEntityId,
          action_url: data.actionUrl,
        })
        .select('id')
        .single();

      if (notificationError) throw notificationError;

      const { data: employees, error: employeesError } = await supabase
        .from('employees')
        .select('id')
        .contains('permissions', [permission])
        .eq('is_active', true);

      if (employeesError) throw employeesError;

      if (!employees || employees.length === 0) {
        return {
          success: true,
          notificationId: notification.id,
          recipientsCount: 0,
          warning: `No active employees found with permission: ${permission}`
        };
      }

      const recipients = employees.map((emp) => ({
        notification_id: notification.id,
        user_id: emp.id,
        is_read: false,
      }));

      const { error: recipientsError } = await supabase
        .from('notification_recipients')
        .insert(recipients);

      if (recipientsError) throw recipientsError;

      return {
        success: true,
        notificationId: notification.id,
        recipientsCount: recipients.length
      };
    } catch (error) {
      console.error('Error sending notification to permission:', error);
      return { success: false, error };
    }
  };

  const sendToUsers = async (
    userIds: string | string[],
    data: NotificationData
  ) => {
    try {
      const ids = Array.isArray(userIds) ? userIds : [userIds];

      if (ids.length === 0) {
        return {
          success: false,
          error: 'No user IDs provided'
        };
      }

      const { data: notification, error: notificationError } = await supabase
        .from('notifications')
        .insert({
          title: data.title,
          message: data.message,
          category: data.category,
          type: data.type || 'info',
          related_entity_type: data.relatedEntityType,
          related_entity_id: data.relatedEntityId,
          action_url: data.actionUrl,
        })
        .select('id')
        .single();

      if (notificationError) throw notificationError;

      const recipients = ids.map((userId) => ({
        notification_id: notification.id,
        user_id: userId,
        is_read: false,
      }));

      const { error: recipientsError } = await supabase
        .from('notification_recipients')
        .insert(recipients);

      if (recipientsError) throw recipientsError;

      return {
        success: true,
        notificationId: notification.id,
        recipientsCount: recipients.length
      };
    } catch (error) {
      console.error('Error sending notification to users:', error);
      return { success: false, error };
    }
  };

  return {
    sendToAll,
    sendToPermission,
    sendToUsers,
  };
}
