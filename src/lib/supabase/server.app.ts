// src/lib/supabase/server.app.ts
import 'server-only';
import { createServerClient } from '@supabase/ssr';

export type CookieStoreLike = {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: any) => void;
};

export function createSupabaseServerClient(cookieStore: CookieStoreLike, options?: { fetch?: typeof fetch }) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(options?.fetch ? { global: { fetch: options.fetch } } : {}),
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
