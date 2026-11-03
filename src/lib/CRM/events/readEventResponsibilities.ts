import type { SupabaseClient } from '@supabase/supabase-js';
const pending = new Map<string, Promise<any>>();
export async function readEventResponsibilities(client: SupabaseClient, eventId: string) {
  const { data: { session } } = await client.auth.getSession();
  if (!session?.user.id || !eventId) return { data: [], error: null };
  const key = `${session.user.id}:${eventId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const request = Promise.resolve(client.rpc('get_event_responsibility_team', { p_event_id: eventId }).abortSignal(controller.signal))
    .finally(() => { clearTimeout(timeout); if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}
