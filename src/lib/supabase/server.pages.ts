import { createServerClient } from '@supabase/ssr';
import type { GetServerSidePropsContext } from 'next';

export function createSupabasePagesServerClient(ctx: GetServerSidePropsContext) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(ctx.req.cookies).map(([name, value]) => ({ name, value }));
        },
        setAll(cookiesToSet) {
          // w pages router trzeba pisać Set-Cookie na res
          cookiesToSet.forEach(({ name, value, options }) => {
            // minimalna wersja – zwykle wystarcza
            const opt = options ?? {};
            const parts = [`${name}=${value}`, `Path=${opt.path ?? '/'}`];
            if (opt.maxAge) parts.push(`Max-Age=${opt.maxAge}`);
            if (opt.httpOnly) parts.push('HttpOnly');
            if (opt.secure) parts.push('Secure');
            if (opt.sameSite) parts.push(`SameSite=${opt.sameSite}`);

            ctx.res.setHeader('Set-Cookie', parts.join('; '));
          });
        },
      },
    }
  );
}