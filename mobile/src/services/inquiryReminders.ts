import { supabase } from '../lib/supabase';

const NOTIFICATION_ID_PREFIX = 'inquiry-reminder-';

export async function scheduleInquiryReminders(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');

    await cancelAllInquiryReminders();

    const { data: inquiries, error } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('is_inquiry', true)
      .neq('board_column', 'completed')
      .neq('status', 'completed');

    if (error || !inquiries || inquiries.length === 0) return;

    const count = inquiries.length;
    const label = count === 1 ? 'zapytanie' : count < 5 ? 'zapytania' : 'zapytań';

    for (let dayOfWeek = 2; dayOfWeek <= 6; dayOfWeek++) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Nieobsłużone zapytania',
          body: `Masz ${count} ${label} do obsłużenia`,
          data: { type: 'inquiry_reminder' },
          sound: 'default',
        },
        trigger: {
          type: 'weekly' as any,
          weekday: dayOfWeek,
          hour: 10,
          minute: 0,
        },
        identifier: `${NOTIFICATION_ID_PREFIX}${dayOfWeek}`,
      });
    }

    console.log('[InquiryReminders] Scheduled for', count, 'pending inquiries');
  } catch (error) {
    console.warn('[InquiryReminders] Schedule error (non-critical):', error);
  }
}

export async function cancelAllInquiryReminders(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith(NOTIFICATION_ID_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch (error) {
    console.warn('[InquiryReminders] Cancel error (non-critical):', error);
  }
}
