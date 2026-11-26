import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { RentalNativeError, rentalGet, rentalPost, rentalUpload } from '@/lib/native/rental';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Rental → Wypożyczenia klientom dla aplikacji na Maca i telefonu (`src/lib/native/rental.ts`, `docs/rental.md`). GET `op=list|detail|
 * access|availability|stock|units|conflicts|protocolPdf|fileUrl|clients|catalog|options|invoices`, POST JSON `op=save|items|status|trips|charges|invoice|issue|
 * return|resolve|warehouseNote|removeFile`, POST multipart `?op=upload&id=…&area=…&kind=…[&protocol=…|&protocolPhoto=1]` (pole `file`).
 * Tokenem pracownika — dostęp sprzedaż / magazyn liczy baza.
 */

const failure = (error: unknown, fallback: string) => {
  if (error instanceof RentalNativeError) return nativeJson({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : '';
  if (message && !/fetch failed|ECONN|timeout/i.test(message)) return nativeJson({ error: message }, 400);
  console.error('[native-rental]', error);
  return nativeJson({ error: fallback }, 500);
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  try {
    return nativeJson(await rentalGet(ctx, new URL(request.url).searchParams));
  } catch (error) {
    return failure(error, 'Nie udało się pobrać wypożyczeń.');
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const params = new URL(request.url).searchParams;
  if (params.get('op') === 'upload') {
    try {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return nativeJson({ error: 'Brak pliku.' }, 400);
      return nativeJson(await rentalUpload(ctx, params, file));
    } catch (error) {
      return failure(error, 'Nie udało się przesłać pliku.');
    }
  }
  let body: Record<string, any>;
  try {
    body = await readJson(request, 512_000);
  } catch {
    return nativeJson({ error: 'Nieprawidłowe dane.' }, 400);
  }
  try {
    return nativeJson(await rentalPost(ctx, body));
  } catch (error) {
    return failure(error, 'Serwer nie wykonał operacji.');
  }
}
