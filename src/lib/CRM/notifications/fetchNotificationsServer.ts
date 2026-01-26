import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';
import { Notification } from '@/components/crm/NotificationCenter';

export async function fetchNotificationsServer(limit = 100): Promise<{
  notifications: Notification[];
  unreadCount: number;
}> {
  const supabase = createSupabaseServerClient(cookies());

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { notifications: [], unreadCount: 0 };

  const { data, error } = await supabase
    .from('notification_recipients')
    .select(
      `
      id,
      is_read,
      read_at,
      notifications (
        id,
        title,
        message,
        type,
        category,
        action_url,
        created_at,
        related_entity_type,
        related_entity_id,
        metadata
      )
    `,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[fetchNotificationsServer] supabase error:', error);
    return { notifications: [], unreadCount: 0 };
  }

  const notifications: Notification[] =
    (data || []).map((recipient: any) => ({
      ...recipient.notifications,
      recipient_id: recipient.id,
      is_read: recipient.is_read,
      read_at: recipient.read_at,
    })) ?? [];

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return { notifications, unreadCount };
}