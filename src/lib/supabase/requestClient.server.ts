import 'server-only';
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { bearerTestToken } from '@/lib/testMode/shared';
import { testModeFetch } from '@/lib/testMode/session.server';

/**
 * Klient Supabase pracownika dla trasy CRM: sesja przeglądarki (ciasteczka) albo — gdy żądanie ma nagłówek
 * `Authorization: Bearer <token sesji>` — token aplikacji natywnej (Mac). W obu przypadkach ten sam RLS i uprawnienia konta;
 * bez nagłówka zachowanie jest takie jak wcześniej (`createSupabaseServerClient(cookies())`).
 */
export async function requestSupabaseClient(req: Request): Promise<{ client: SupabaseClient<any, any, any>; user: User | null }> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  if (bearer) {
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      // Klucz zastępczy trybu testowego (docs/test-mode.md) — w imieniu oglądanej osoby.
      global: { headers: { Authorization: `Bearer ${bearer}` }, ...(bearerTestToken(`Bearer ${bearer}`) ? { fetch: testModeFetch() } : {}) },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await client.auth.getUser(bearer);
    return { client, user: data.user ?? null };
  }
  const client = createSupabaseServerClient(await cookies()) as unknown as SupabaseClient<any, any, any>;
  const { data } = await client.auth.getUser();
  return { client, user: data.user ?? null };
}
