import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { handleNativeAction } from '@/lib/native/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Czynności z kart natywnych — formularze opisane w kartach (`src/lib/native/protocol.ts`), te same zapisy co CRM. */
export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: unknown;
  try { body = await readJson(request, 150_000); } catch { return nativeJson({ error: 'Nieprawidłowe dane.' }, 400); }
  return handleNativeAction(ctx, body);
}
