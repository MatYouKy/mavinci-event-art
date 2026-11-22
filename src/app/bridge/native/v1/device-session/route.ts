import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import { DeviceSessionError, createDeviceSession } from '@/lib/native/deviceSession.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/*
 * POST — osobna sesja dla rozszerzenia „Mavinci” w aplikacji Pliki (iPhone, iPad): `{ session }` (JSON sesji Supabase tego
 * samego konta). Token pracownika (Bearer), nagłówek `x-mavinci-client: phone`. Szczegóły: `src/lib/native/deviceSession.server.ts`.
 */

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    return nativeJson(await createDeviceSession(ctx));
  } catch (error) {
    if (error instanceof DeviceSessionError) return nativeJson({ error: error.message }, error.status);
    console.error('[native device-session]', error);
    return nativeJson({ error: 'Nie udało się przygotować dostępu dla aplikacji Pliki.' }, 500);
  }
}
