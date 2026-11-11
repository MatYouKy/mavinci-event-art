import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { nativeSyncItems } from '@/lib/native/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Synchronizacja, krok 2: `{set, buckets:[…]}` → treść wskazanych koszyków (pusta lista = koszyk zniknął), reszta w `more`. */
export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: any;
  try { body = await readJson(request, 20_000); } catch { return nativeJson({ error: 'Nieprawidłowe dane.' }, 400); }
  const result = await nativeSyncItems(ctx, String(body?.set || ''), Array.isArray(body?.buckets) ? body.buckets.slice(0, 256) : []);
  return result ? nativeJson(result) : nativeJson({ error: 'Brak dostępu do tego zbioru.' }, 403);
}
