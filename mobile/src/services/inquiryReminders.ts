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

    const count = inquiries.length;
    const label = count === 1 ? 'zapytanie' : count < 5 ? 'zapytania' : 'zapytań';

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Nieobsłużone zapytania',
        body: `Masz ${count} ${label} do obsłużenia`,
        data: { type: 'inquiry_reminder' },
        sound: 'default',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 24 * 60 * 60,
        repeats: true,
      },
      identifier: `${NOTIFICATION_ID_PREFIX}daily`,
    });

    console.log('[InquiryReminders] Scheduled daily for', count, 'pending inquiries');
  } catch (error) {
    console.warn('[InquiryReminders] Schedule error (non-critical):', error);
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
    console.warn('[InquiryReminders] Cancel error (non-critical):', error);
  }
}
