import 'server-only';
import { cookies } from 'next/headers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

/*
 * Klient Supabase pracownika dla tras `/bridge/*`: aplikacje natywne (Mac) wysyłają swój token (Bearer), przeglądarka — ciasteczka
 * z tego samego źródła (sprawdzamy Origin). Oba warianty działają z uprawnieniami pracownika (RLS) — jak w `/bridge/messages/trash`.
 * `null` — żądanie przeglądarki z obcego źródła.
 */
export function bridgeUserClient(request: Request): { client: SupabaseClient; token?: string } | null {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  if (token) {
    return {
      token,
      client: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    };
  }
  const origin = request.headers.get('origin');
  if (!origin || new URL(origin).host !== request.headers.get('host')) return null;
  return { client: createSupabaseServerClient(cookies()) as unknown as SupabaseClient };
}
