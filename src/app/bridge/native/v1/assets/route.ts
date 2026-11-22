import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { AssetsError, assetDocuments, deleteAcquisition, equipmentAssets, saveAcquisition } from '@/lib/assets/assets.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Własność sprzętu i dokument zakupu (CRM i Mac: Magazyn → sprzęt → „Zakup”; typy — `src/lib/assets/assetsShared.ts`).
 * Token pracownika (Bearer), RLS `equipment_acquisitions`: widzą osoby z dostępem do faktur firmy, zmienia „Finanse — zarządzanie”.
 * GET op=equipment&id=<sprzęt> → własność i partie | documents&company=<firma>&q=<fraza>&contracts=1 → dokumenty zakupu do wyboru.
 * POST JSON op=save {id?, equipmentId, quantity, ownership, companyId, acquiredOn, netAmount, grossAmount, currency,
 *   document: {type: ksef|external|contract, id} | null, documentNote, notes} → własność sprzętu | delete {id} → własność sprzętu.
 */

function failure(error: unknown, fallback: string) {
  if (error instanceof AssetsError) {
    if (error.status >= 500) console.error('[native-assets]', error.message);
    return nativeJson({ error: error.message, ...error.extra }, error.status);
  }
  console.error('[native-assets]', error);
  return nativeJson({ error: fallback }, 500);
}

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const params = new URL(request.url).searchParams;
  try {
    switch (params.get('op')) {
      case 'equipment':
        return nativeJson(await equipmentAssets(ctx, params.get('id')));
      case 'documents':
        return nativeJson(await assetDocuments(ctx, { company: params.get('company'), query: params.get('q'), contracts: params.get('contracts') === '1' }));
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error, 'Nie udało się pobrać własności sprzętu.');
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    body = await readJson(request, 50_000);
  } catch {
    return nativeJson({ error: 'Nieprawidłowe dane.' }, 400);
  }
  try {
    switch (String(body.op || '')) {
      case 'save':
        return nativeJson(await saveAcquisition(ctx, body));
      case 'delete':
        return nativeJson(await deleteAcquisition(ctx, body));
      default:
        return nativeJson({ error: 'Nieznana operacja.' }, 400);
    }
  } catch (error) {
    return failure(error, 'Nie udało się zapisać własności sprzętu.');
  }
}
