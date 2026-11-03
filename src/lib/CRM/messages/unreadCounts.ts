import type { SupabaseClient } from '@supabase/supabase-js';

export async function readMailboxUnreadCounts(client: SupabaseClient, accountIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(accountIds)];
  if (!ids.length) return {};
  const { data, error } = await client.rpc('crm_mailbox_unread_counts', { p_account_ids: ids });
  if (!error) return Object.fromEntries(ids.map(id => [id, Number((data || []).find((row: any) => row.email_account_id === id)?.unread_count || 0)]));
  if (!['PGRST202', '42883'].includes(error.code)) throw error;
  const counts: Record<string, number> = {};
  // Older database: bounded concurrency, exact original filters and RLS.
  for (const id of ids) {
    const result = await client.from('received_emails').select('id', { count: 'exact', head: true })
      .eq('email_account_id', id).eq('is_read', false).is('deleted_at', null);
    if (result.error) throw result.error;
    counts[id] = result.count || 0;
  }
  return counts;
}
