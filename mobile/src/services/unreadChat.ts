import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Nieprzeczytane wiadomości komunikatora według rozmowy — liczy serwer (get_chat_unread_counts),
 * tak samo jak CRM: tylko wiadomości od innych osób, nowsze niż mój znacznik odczytu.
 * Własna wiadomość, której ktoś jeszcze nie przeczytał, nie zwiększa mojego licznika.
 * Konto bierze serwer z sesji; employeeId zostaje w podpisie dla wywołujących.
 */
export async function fetchUnreadChatCounts(
  client: SupabaseClient, _employeeId: string, signal?: AbortSignal,
): Promise<Map<string, number>> {
  let query = client.rpc('get_chat_unread_counts');
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as { conversation_id: string; unread_count: number | string }[];
  return new Map(rows.map((row) => [row.conversation_id, Number(row.unread_count) || 0]));
}
