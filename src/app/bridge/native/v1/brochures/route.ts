import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import {
  addBrochureItem,
  brochureClients,
  brochureEditor,
  brochureHotelAssets,
  brochureImageUrls,
  brochureOwnPdf,
  brochurePagePreview,
  brochurePreview,
  brochuresState,
  createBrochure,
  createBrochureCampaign,
  manageBrochure,
  removeBrochureItem,
  saveBrochure,
  uploadBrochureImage,
} from '@/lib/native/brochures';
import { brochureDeliveries, brochureFileUrl, brochureMailCompose, brochureMailSetup, brochureOrganizationMembers } from '@/lib/native/brochureMail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Broszury dla aplikacji na Maca (`src/lib/native/brochures.ts`): GET op=state (lista) | editor&id=… (edytor) |
 * hotelAssets&organization=…&company=… (zdjęcia hotelu z biblioteki organizacji) | clients&mode=contact|organization&q=…
 * (klient wersji PDF) | ownPdf&id=… (ostatni własny PDF); POST op=create | manage (rename, remove, restore) | save | itemAdd |
 * itemRemove | preview (podgląd HTML ze szkicu) | pagePreview (jedna strona graficzna do płótna Studio stron) | imageUrls |
 * imageUpload | campaign. Wysyłka (`src/lib/native/brochureMail.ts`): GET op=mailSetup&id=… | members&organization=… |
 * deliveries&brochure|contact|organization|batch=…&all=…&employee=…&offset=…; POST op=mailCompose | fileUrl.
 * PDF i sprawdzanie broszury generuje `/bridge/brochures/generate-pdf`, przygotowanie i wysyłkę wiadomości —
 * `/bridge/brochures/deliveries` (token pracownika, jak w CRM).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) =>
  (error as { message?: string })?.message || (typeof error === 'string' ? error : fallback);

/** Publiczny adres CRM (font Inter w podglądzie) — za serwerem pośredniczącym liczy się nagłówek hosta. */
function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const protocol = (request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')).split(',')[0].trim();
  return host && /^[a-z0-9.:-]+$/i.test(host) && /^https?$/.test(protocol) ? `${protocol}://${host}` : url.origin;
}

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  const param = (key: string) => url.searchParams.get(key) || '';
  try {
    switch (param('op')) {
      case 'state': return nativeJson(await brochuresState(ctx));
      case 'editor': return nativeJson(await brochureEditor(ctx, param('id')));
      case 'hotelAssets': return nativeJson(await brochureHotelAssets(ctx, param('organization') || null, param('company') || null));
      case 'clients': return nativeJson(await brochureClients(ctx, param('mode'), param('q')));
      case 'ownPdf': return nativeJson(await brochureOwnPdf(ctx, param('id')));
      case 'mailSetup': return nativeJson(await brochureMailSetup(ctx, param('id')));
      case 'members': return nativeJson(await brochureOrganizationMembers(ctx, param('organization')));
      case 'deliveries': return nativeJson(await brochureDeliveries(ctx, url.searchParams));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się pobrać broszur.'));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  let body: Record<string, any>;
  try {
    // Własne zdjęcie broszury (do 10 MB w base64); pozostałe operacje to formularze edytora.
    body = await readJson(request, 15_000_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'create': return nativeJson(await createBrochure(ctx, body));
      case 'manage': return nativeJson(await manageBrochure(ctx, body));
      case 'save': return nativeJson(await saveBrochure(ctx, body));
      case 'itemAdd': return nativeJson(await addBrochureItem(ctx, body));
      case 'itemRemove': return nativeJson(await removeBrochureItem(ctx, body));
      case 'preview': return nativeJson(await brochurePreview(ctx, body, publicOrigin(request)));
      case 'pagePreview': return nativeJson(await brochurePagePreview(ctx, body, publicOrigin(request)));
      case 'imageUrls': return nativeJson(await brochureImageUrls(ctx, body));
      case 'imageUpload': return nativeJson(await uploadBrochureImage(ctx, body));
      case 'campaign': return nativeJson(await createBrochureCampaign(ctx, body));
      case 'mailCompose': return nativeJson(await brochureMailCompose(ctx, body));
      case 'fileUrl': return nativeJson(await brochureFileUrl(ctx, body));
      default: return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się zapisać zmian.'));
  }
}
