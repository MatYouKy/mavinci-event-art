import { createServerClient } from '@supabase/ssr';
import type { GetServerSidePropsContext } from 'next';

export function createSupabasePagesServerClient(ctx: GetServerSidePropsContext) {
  const { req, res } = ctx;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Next pages: cookies są w req.headers.cookie (SSR client sam to parsuje),
          // ale @supabase/ssr chce getAll() w formacie [{name,value}]
          // więc najprościej dać pustą listę i polegać na headers...
          // LEPIEJ: użyć gotowych helperów auth-helpers, ale zostajemy w @supabase/ssr:
          const cookieHeader = req.headers.cookie ?? '';
          return cookieHeader
            .split(';')
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => {
              const [name, ...rest] = c.split('=');
              return { name, value: decodeURIComponent(rest.join('=')) };
            });
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // Minimalny Set-Cookie (w praktyce lepiej użyć `cookie` lib)
            const opt = options ?? {};
            const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opt.path ?? '/'}`];
            if (opt.maxAge) parts.push(`Max-Age=${opt.maxAge}`);
            if (opt.expires) parts.push(`Expires=${opt.expires.toUTCString()}`);
            if (opt.httpOnly) parts.push('HttpOnly');
            if (opt.secure) parts.push('Secure');
            if (opt.sameSite) parts.push(`SameSite=${opt.sameSite}`);

            res.setHeader('Set-Cookie', parts.join('; '));
          });
        },
      },
    }
  );
}