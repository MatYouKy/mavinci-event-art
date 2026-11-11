import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { nativeSyncState } from '@/lib/native/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Synchronizacja aplikacji natywnej, krok 1: `{sets:{nazwa:{hash}}, only?:[…]}` → skróty zbiorów z zakresu konta; dla różniących się — skróty koszyków. */
export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: any;
  try { body = await readJson(request, 20_000); } catch { return nativeJson({ error: 'Nieprawidłowe dane.' }, 400); }
  const sets = body?.sets && typeof body.sets === 'object' ? body.sets : {};
  const only = Array.isArray(body?.only) ? body.only.map(String).slice(0, 20) : undefined;
  return nativeJson(await nativeSyncState(ctx, sets, only));
}
