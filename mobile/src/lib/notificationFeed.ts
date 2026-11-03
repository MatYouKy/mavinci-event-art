import type { SupabaseClient } from '@supabase/supabase-js';

export const NOTIFICATION_PAGE_SIZE = 50;
const fields = `id,is_read,read_at,created_at,notifications!inner(id,title,message,type,category,action_url,created_at,related_entity_type,related_entity_id,metadata)`;

// Both joins and counts use the caller's RLS, including mailbox membership.
export async function readNotificationFeed(client: SupabaseClient, userId: string, pages: number,
  unreadOnly: boolean, hidePhase: boolean, signal: AbortSignal) {
  const query = (selection: string, head = false) => {
    let q = client.from('notification_recipients').select(selection, head ? { count: 'exact', head: true } : {}).eq('user_id', userId);
    if (hidePhase) q = q.or('related_entity_type.is.null,related_entity_type.neq.event_phase_assignment', { foreignTable: 'notifications' });
    return q.abortSignal(signal);
  };
  const countFields = 'id,notifications!inner(id,related_entity_type)';
  const counts = await client.rpc('crm_notification_counts', { p_hide_phase: hidePhase }).abortSignal(signal);
  let total: number;
  let unread: number;
  if (!counts.error) {
    total = Number(counts.data?.total || 0);
    unread = Number(counts.data?.unread || 0);
  } else {
    if (!['PGRST202', '42883'].includes(counts.error.code)) throw counts.error;
    const [allCount, unreadCount] = await Promise.all([
      query(countFields, true), query(countFields, true).eq('is_read', false),
    ]);
    if (allCount.error) throw allCount.error;
    if (unreadCount.error) throw unreadCount.error;
    total = allCount.count || 0;
    unread = unreadCount.count || 0;
  }
  const rows: any[] = [];
  // A range per page also supports histories larger than the API row cap.
  for (let page = 0; page < pages && !signal.aborted; page++) {
    let q = query(fields).order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(page * NOTIFICATION_PAGE_SIZE, (page + 1) * NOTIFICATION_PAGE_SIZE - 1);
    if (unreadOnly) q = q.eq('is_read', false);
    const result = await q;
    if (result.error) throw result.error;
    rows.push(...(result.data || []).map((row: any) => ({ ...row, notifications: row.notifications?.metadata?.kind === 'event_workflow_digest'
      ? { ...row.notifications, action_url: '/crm/events/actions' } : row.notifications })));
    if ((result.data || []).length < NOTIFICATION_PAGE_SIZE) break;
  }
  return { rows, total, unread, hasMore: rows.length < (unreadOnly ? unread : total) };
}

export async function readRecentUnreadNotifications(client: SupabaseClient, userId: string, since: string, signal: AbortSignal) {
  const rows: any[] = [];
  for (let page = 0; !signal.aborted; page++) {
    const result = await client.from('notification_recipients').select(fields).eq('user_id', userId)
      .eq('is_read', false).gte('created_at', since).order('created_at').order('id')
      .range(page * NOTIFICATION_PAGE_SIZE, (page + 1) * NOTIFICATION_PAGE_SIZE - 1).abortSignal(signal);
    if (result.error) throw result.error;
    rows.push(...(result.data || []).map((row: any) => ({ ...row, notifications: row.notifications?.metadata?.kind === 'event_workflow_digest'
      ? { ...row.notifications, action_url: '/crm/events/actions' } : row.notifications })));
    if ((result.data || []).length < NOTIFICATION_PAGE_SIZE) break;
  }
  return rows;
}
