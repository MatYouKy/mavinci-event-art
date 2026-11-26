import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import { purchaseFailure, purchasesGet, purchasesPost } from '@/lib/purchases/purchaseRoute.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/*
 * Zakupy → „Moje wydatki” dla Maca i telefonu (`docs/purchases.md`) — te same operacje co trasa CRM `/bridge/purchases`
 * (`src/lib/purchases/purchaseRoute.server.ts`), tokenem pracownika.
 */

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    return nativeJson(await purchasesGet(ctx.supabase, new URL(request.url).searchParams));
  } catch (error) {
    const { message, status } = purchaseFailure(error, 'Nie udało się wczytać zakupów.');
    return nativeJson({ error: message }, status);
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    return nativeJson(await purchasesPost(ctx.supabase, request));
  } catch (error) {
    const { message, status } = purchaseFailure(error, 'Serwer nie wykonał operacji.');
    return nativeJson({ error: message }, status);
  }
}
