import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

const NOTIFICATION_ID_PREFIX = 'inquiry-reminder-';

export async function scheduleInquiryReminders(): Promise<void> {
  try {
    await cancelAllInquiryReminders();

    const { data: inquiries, error } = await supabase
      .from('tasks')
      .select('id, title')
      .eq('is_inquiry', true)
      .neq('board_column', 'completed')
      .neq('status', 'completed');

    if (error || !inquiries || inquiries.length === 0) return;

    for (let dayOfWeek = 2; dayOfWeek <= 6; dayOfWeek++) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Nieobsłużone zapytania',
          body: `Masz ${inquiries.length} ${inquiries.length === 1 ? 'zapytanie' : inquiries.length < 5 ? 'zapytania' : 'zapytań'} do obsłużenia`,
          data: { type: 'inquiry_reminder' },
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: dayOfWeek,
          hour: 10,
          minute: 0,
        },
        identifier: `${NOTIFICATION_ID_PREFIX}${dayOfWeek}`,
      });
    }

    console.log('[InquiryReminders] Scheduled for', inquiries.length, 'pending inquiries');
  } catch (error) {
    console.error('[InquiryReminders] Schedule error:', error);
  }
}

export async function cancelAllInquiryReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith(NOTIFICATION_ID_PREFIX)) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch (error) {
    console.error('[InquiryReminders] Cancel error:', error);
  }
}
