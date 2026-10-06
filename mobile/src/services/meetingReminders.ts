import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';
import { createRefreshQueue } from '../lib/refreshQueue';
import { useForegroundEffect } from '../hooks/useForegroundEffect';

// Retire local alerts after a web/mobile edit transfers delivery to the server,
// or after an occurrence is cancelled or the user loses access to it.
export async function cancelObsoleteMeetingAlerts(signal?: AbortSignal) {
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync())
    .filter((notification) => notification.content.data?.type === 'meeting_reminder');
  const ids = [...new Set(scheduled.map((item) => item.content.data?.meetingId)
    .filter((id): id is string => typeof id === 'string'))];
  for (let offset = 0; offset < ids.length; offset += 100) {
    if (signal?.aborted) return;
    const batch = ids.slice(offset, offset + 100);
    const { data, error } = await supabase.from('meetings').select('id,server_reminders,deleted_at').in('id', batch);
    if (error) throw error;
    if (signal?.aborted) return;
    const localIds = new Set((data || []).filter((row) => !row.server_reminders && !row.deleted_at).map((row) => row.id));
    for (const notification of scheduled) {
      const id = notification.content.data?.meetingId;
      if (typeof id === 'string' && batch.includes(id) && !localIds.has(id)) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }
  }
}

export function useMeetingReminderCleanup(employeeId?: string) {
  useForegroundEffect((signal) => {
    if (!employeeId) return;
    const queue = createRefreshQueue(signal, cancelObsoleteMeetingAlerts);
    void queue.refresh();
    const channel = supabase.channel(`meeting-alert-cleanup-${employeeId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'meetings' }, queue.schedule)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [employeeId]);
}
