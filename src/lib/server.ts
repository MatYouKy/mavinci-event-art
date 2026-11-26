import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { isTestModeCookies } from '@/lib/testMode/shared';
import { testModeFetch } from '@/lib/testMode/session.server';

export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Tryb testowy „widok jako” (docs/test-mode.md): zapytania z kluczem zastępczym — w imieniu oglądanej osoby.
      ...(isTestModeCookies(cookieStore.getAll()) ? { global: { fetch: testModeFetch() } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // w Server Components nie zawsze można ustawiać cookies
          }
        },
      },
    }
  );
}