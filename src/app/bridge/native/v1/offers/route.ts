import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { deleteOffer, offerDetail, offerPdf, offersAccess, offersState, setOfferStatus } from '@/lib/native/offers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Oferty dla aplikacji na Maca (`src/lib/native/offers.ts`): GET op=state (lista ofert do kopii na dysku), op=offer&id=… (strona
 * oferty), op=pdf&id=… (podpisany adres zapisanego PDF); POST op=status (szkic, wysłana, odrzucona, wygasła) | delete.
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!offersAccess(ctx).canView) return failure('Nie masz dostępu do ofert.', 403);
  const url = new URL(request.url);
  try {
    switch (url.searchParams.get('op')) {
      case 'state': return nativeJson(await offersState(ctx));
      case 'offer': return nativeJson(await offerDetail(ctx, url.searchParams.get('id') || ''));
      case 'pdf': return nativeJson(await offerPdf(ctx, url.searchParams.get('id') || ''));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się pobrać ofert.'));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  if (!offersAccess(ctx).canView) return failure('Nie masz dostępu do ofert.', 403);
  let body: Record<string, any>;
  try {
    body = await readJson(request, 100_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'status': return nativeJson(await setOfferStatus(ctx, body));
      case 'delete': return nativeJson(await deleteOffer(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać zmian.'));
  }
}
