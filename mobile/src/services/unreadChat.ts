import type { SupabaseClient } from '@supabase/supabase-js';

export async function fetchUnreadChatCounts(
  client: SupabaseClient, employeeId: string, signal?: AbortSignal,
): Promise<Map<string, number>> {
  let membershipQuery = client.from('employee_conversation_participants')
    .select('conversation_id,last_read_at').eq('employee_id', employeeId);
  if (signal) membershipQuery = membershipQuery.abortSignal(signal);
  const { data: memberships, error } = await membershipQuery;
  if (error) throw error;
  const counts = new Map<string, number>();
  const rows = memberships || [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (next < rows.length) {
      if (signal?.aborted) throw new Error('Odczyt anulowany');
      const row = rows[next++];
      let query = client.from('employee_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', row.conversation_id)
        .neq('sender_id', employeeId);
      // Compare timestamps in PostgreSQL, not as ISO strings on the phone.
      // A missing read marker means all incoming messages are unread.
      if (row.last_read_at) query = query.gt('created_at', row.last_read_at);
      if (signal) query = query.abortSignal(signal);
      const { count, error: countError } = await query;
      if (countError) throw countError;
      counts.set(row.conversation_id, count || 0);
    }
  }));
  return counts;
}
