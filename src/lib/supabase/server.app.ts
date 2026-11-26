// src/lib/supabase/server.app.ts
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { isTestModeCookies } from '@/lib/testMode/shared';
import { testModeFetch } from '@/lib/testMode/session.server';

export type CookieStoreLike = {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: any) => void;
};

export function createSupabaseServerClient(cookieStore: CookieStoreLike, options?: { fetch?: typeof fetch }) {
  // Tryb testowy „widok jako” (docs/test-mode.md): zapytania z kluczem zastępczym idą w imieniu oglądanej osoby.
  const fetchImpl = isTestModeCookies(cookieStore.getAll()) ? testModeFetch(options?.fetch) : options?.fetch;
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
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
            // OK
          }
        },
      },
    }
  );
}

export { createServerClient };
