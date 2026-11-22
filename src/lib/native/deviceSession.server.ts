import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import type { NativeContext } from '@/lib/native/auth';

/*
 * Osobna sesja dla rozszerzenia „Mavinci” w aplikacji Pliki na iPhonie i iPadzie (File Provider, osobny proces).
 *
 * Aplikacja na telefonie odświeża swoją sesję Supabase sama, a token odświeżania można użyć tylko raz — gdyby rozszerzenie
 * odświeżało tę samą sesję, jeden z procesów unieważniałby drugiemu tokeny (i wylogowywał aplikację). Dlatego rozszerzenie
 * dostaje własną sesję tego samego konta: serwer tworzy jednorazowy link logowania (bez wysyłki e-maila) i od razu go
 * wymienia na sesję. Uprawnienia są te same co w aplikacji (RLS według konta); wylogowanie w aplikacji unieważnia także tę
 * sesję (moduł natywny `mobile/modules/mavinci-files`). Tylko dla aktywnego pracownika z kontem i adresem e-mail.
 */

export class DeviceSessionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type DeviceSession = { session: Record<string, unknown> };

export async function createDeviceSession(ctx: NativeContext): Promise<DeviceSession> {
  if (ctx.client !== 'phone') throw new DeviceSessionError('Osobną sesję dla aplikacji Pliki tworzy tylko aplikacja na telefon i tablet.', 400);
  const { data: auth, error: authError } = await ctx.supabase.auth.getUser();
  const user = auth?.user;
  if (authError || !user) throw new DeviceSessionError('Sesja wygasła. Zaloguj się ponownie.', 401);
  if (user.id !== ctx.employee.authUserId) throw new DeviceSessionError('Sesja nie należy do tego pracownika.', 403);
  const email = (user.email || '').trim();
  if (!email) throw new DeviceSessionError('Konto bez adresu e-mail — Mavinci w aplikacji Pliki wymaga logowania e-mailem.', 400);

  const admin = createSupabaseAdminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash || link.user?.id !== user.id) {
    console.error('[native device-session] link', linkError?.message || 'brak tokenu');
    throw new DeviceSessionError('Nie udało się przygotować dostępu dla aplikacji Pliki.', 500);
  }
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  const session = verified?.session;
  if (verifyError || !session || session.user?.id !== user.id) {
    console.error('[native device-session] verify', verifyError?.message || 'brak sesji');
    throw new DeviceSessionError('Nie udało się przygotować dostępu dla aplikacji Pliki.', 500);
  }
  return { session: session as unknown as Record<string, unknown> };
}
