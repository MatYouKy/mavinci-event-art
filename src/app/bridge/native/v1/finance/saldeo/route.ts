import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  saldeoClaim,
  saldeoComplete,
  saldeoCsv,
  saldeoDetails,
  saldeoFile,
  saldeoFollowup,
  saldeoMonth,
  saldeoNote,
  saldeoPin,
  saldeoReview,
  saldeoSendCheck,
  saldeoSetup,
} from '@/lib/native/financeSaldeo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Przekazanie księgowej (Saldeo) dla aplikacji na Maca (`src/lib/native/financeSaldeo.ts`) — token pracownika, uprawnienia
 * jak w CRM (`SaldeoDeliveryPanel`). GET op=setup | pin&company | month&company&month&year |
 *   details&company&month&year&key | file&company&month&year&key | csv&company&month&year&kind=reconciliation|followups.
 * POST JSON op=note | followup | review | sendCheck | claim | complete. Dokumenty do Saldeo wysyła trasa CRM
 * `/bridge/integrations/saldeo`, wyciągi do księgowej — funkcja `send-email` (z aplikacji, tym samym tokenem).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => (error as { message?: string })?.message || fallback;
const statusOf = (error: unknown) => {
  const value = error as { status?: number; code?: string } | null;
  if (value?.status) return value.status;
  return value?.code === '42501' ? 403 : value?.code ? 400 : 500;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams.entries());
  try {
    switch (query.op || '') {
      case 'setup':
        return nativeJson(await saldeoSetup(ctx));
      case 'pin':
        return nativeJson(await saldeoPin(ctx, query.company));
      case 'month':
        return nativeJson(await saldeoMonth(ctx, query));
      case 'details':
        return nativeJson(await saldeoDetails(ctx, query));
      case 'file':
        return nativeJson(await saldeoFile(ctx, query));
      case 'csv':
        return nativeJson(await saldeoCsv(ctx, query));
      default:
        return failure('Nieznana operacja.', 404);
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-finance-saldeo]', error);
    return failure(errorText(error, 'Nie można odczytać wszystkich danych miesiąca.'), statusOf(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, unknown>;
  try {
    body = await readJson(request, 256_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  const op = String(body.op || '');
  try {
    switch (op) {
      case 'note':
        return nativeJson(await saldeoNote(ctx, body));
      case 'followup':
        return nativeJson(await saldeoFollowup(ctx, body));
      case 'review':
        return nativeJson(await saldeoReview(ctx, body));
      case 'sendCheck':
        return nativeJson(await saldeoSendCheck(ctx, body));
      case 'claim':
        return nativeJson(await saldeoClaim(ctx, body));
      case 'complete':
        return nativeJson(await saldeoComplete(ctx, body));
      default:
        return failure('Nieznana operacja.', 404);
    }
  } catch (error) {
    if (statusOf(error) >= 500) console.error('[native-finance-saldeo]', error);
    return failure(errorText(error, op === 'review' ? 'Nie udało się przygotować pliku kontrolnego.' : 'Nie udało się zapisać zmian.'), statusOf(error));
  }
}
