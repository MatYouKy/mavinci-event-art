import { nativeContext, nativeJson, nativeUnauthorized, readJson } from '@/lib/native/auth';
import { httpStatus } from '@/lib/social/socialCommon.server';
import { SHOWCASE_LIMITS } from '@/lib/showcase/showcaseShared';
import {
  showcaseCreateItem, showcaseDeleteItem, showcaseDeleteSection, showcaseDuplicateItem, showcaseEvents, showcaseHome, showcaseImport,
  showcaseItem, showcasePhotos, showcaseProducts, showcaseRealizations, showcaseReorderItems, showcaseReorderSections, showcaseSaveItem,
  showcaseSaveSection, showcaseUpload,
} from '@/lib/showcase/showcase.server';
import {
  showcaseOfferApproval, showcaseOfferClientContext, showcaseOfferClients, showcaseOfferCreate, showcaseOfferEmail, showcaseOfferEmailSend,
  showcaseOfferPdf, showcaseOfferPreview, showcaseOfferSetup, showcaseOfferStatus,
} from '@/lib/showcase/showcaseOffer.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/*
 * Strefa sprzedawcy → „Prezentacje” — jedno API dla CRM (`x-mavinci-client: web`), aplikacji na Maca i (etap 2) iPada.
 * Token pracownika (Bearer), RLS i funkcje bazy (`src/lib/showcase/showcase.server.ts`). Podgląd: `presentations_view` albo
 * dostęp do ofert; przygotowanie: `presentations_manage` albo `offers_manage`.
 * GET op=home | item&id | products&q | realizations&q | events&q |
 *   photos&source=product&product | photos&source=site&realization | photos&source=event&event | photos&source=material&q |
 *   photos&source=social&q.
 * POST ?op=upload&item=<karta> | &section=<dział> [&caption] — bajty zdjęcia (JPEG / PNG / WebP do 40 MB) → `{photo, urls}`.
 * POST JSON op=saveSection {id?, version?, title, subtitle, icon, isActive, cover?} | deleteSection {id, withItems} |
 *   reorderSections {ids[]} | reorderItems {sectionId, ids[]} (karta z innego działu przechodzi do tego działu) |
 *   createItem {sectionId, title?, productId?} („Utwórz z produktu” — treść z katalogu) |
 *   saveItem {id, version, title, tagline, isActive, productIds[], content} | duplicateItem {id} | deleteItem {id} |
 *   import {itemId | sectionId, source: product | site | material | event | social, productId+path | realizationId+path | fileId,
 *   caption?} → `{photo, urls}`.
 * Oferta ze spotkania (`src/lib/showcase/showcaseOffer.server.ts`, migracja 20261122120000):
 * GET op=offerSetup | offerClients&q | offerClient&organization|contact (osoby firmy, otwarte zapytania) | offerStatus&id |
 *   offerPdf&id (podpisany adres PDF) | offerEmail&id (okno wysyłki).
 * POST JSON op=offerPreview {draft} | offerCreate {draft} (błąd po zapisaniu zapytania niesie `inquiryId`) |
 *   offerApproval {id, note?} | offerEmailSend {id, to, subject, text, accountId, recipientName}.
 * PDF oferty: `/bridge/offers/generate-pdf` (ten sam token, postęp w NDJSON).
 */

const failure = (message: string, status = 400) => nativeJson({ error: message }, status);
const errorText = (error: unknown, fallback: string) => {
  const status = httpStatus(error);
  if (status >= 500) console.error('[native-showcase]', error);
  return status >= 500 && !(error as { status?: number })?.status ? fallback : (error as Error)?.message || fallback;
};

export async function GET(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const params = new URL(request.url).searchParams;
  try {
    switch (params.get('op')) {
      case 'home':
        return nativeJson(await showcaseHome(ctx));
      case 'item':
        return nativeJson(await showcaseItem(ctx, params.get('id') || ''));
      case 'products':
        return nativeJson(await showcaseProducts(ctx, params));
      case 'realizations':
        return nativeJson(await showcaseRealizations(ctx, params));
      case 'events':
        return nativeJson(await showcaseEvents(ctx, params));
      case 'photos':
        return nativeJson(await showcasePhotos(ctx, params));
      case 'offerSetup':
        return nativeJson(await showcaseOfferSetup(ctx));
      case 'offerClients':
        return nativeJson(await showcaseOfferClients(ctx, params));
      case 'offerClient':
        return nativeJson(await showcaseOfferClientContext(ctx, params));
      case 'offerStatus':
        return nativeJson(await showcaseOfferStatus(ctx, params.get('id') || ''));
      case 'offerPdf':
        return nativeJson(await showcaseOfferPdf(ctx, params.get('id') || ''));
      case 'offerEmail':
        return nativeJson(await showcaseOfferEmail(ctx, params.get('id') || ''));
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    return failure(errorText(error, 'Nie udało się załadować prezentacji.'), httpStatus(error));
  }
}

export async function POST(request: Request) {
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const url = new URL(request.url);
  if (url.searchParams.get('op') === 'upload') {
    if (Number(request.headers.get('content-length') || 0) > SHOWCASE_LIMITS.uploadBytes) return failure('Zdjęcie może mieć najwyżej 40 MB.', 413);
    try {
      const bytes = Buffer.from(await request.arrayBuffer());
      return nativeJson(await showcaseUpload(ctx, url.searchParams, bytes));
    } catch (error) {
      return failure(errorText(error, 'Nie udało się wgrać zdjęcia.'), httpStatus(error));
    }
  }
  let body: Record<string, any>;
  try {
    body = await readJson(request, 1_500_000);
  } catch {
    return failure('Nieprawidłowe dane.');
  }
  try {
    switch (String(body.op || '')) {
      case 'saveSection':
        return nativeJson(await showcaseSaveSection(ctx, body));
      case 'deleteSection':
        return nativeJson(await showcaseDeleteSection(ctx, body));
      case 'reorderSections':
        return nativeJson(await showcaseReorderSections(ctx, body));
      case 'reorderItems':
        return nativeJson(await showcaseReorderItems(ctx, body));
      case 'createItem':
        return nativeJson(await showcaseCreateItem(ctx, body));
      case 'saveItem':
        return nativeJson(await showcaseSaveItem(ctx, body));
      case 'duplicateItem':
        return nativeJson(await showcaseDuplicateItem(ctx, body));
      case 'deleteItem':
        return nativeJson(await showcaseDeleteItem(ctx, body));
      case 'import':
        return nativeJson(await showcaseImport(ctx, body));
      case 'offerPreview':
        return nativeJson(await showcaseOfferPreview(ctx, body));
      case 'offerCreate':
        return nativeJson(await showcaseOfferCreate(ctx, body));
      case 'offerApproval':
        return nativeJson(await showcaseOfferApproval(ctx, body));
      case 'offerEmailSend': {
        // Wysyłka idzie do funkcji poczty tokenem pracownika (jak „Wyślij ofertę” w CRM).
        const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
        return nativeJson(await showcaseOfferEmailSend(ctx, body, token));
      }
      default:
        return failure('Nieznana operacja.');
    }
  } catch (error) {
    const fallback = String(body.op || '').startsWith('offer') ? 'Nie udało się przygotować oferty.' : 'Nie udało się zapisać prezentacji.';
    const saved = error as { inquiryId?: unknown; organizationId?: unknown; contactId?: unknown } | null;
    const status = httpStatus(error);
    // Zapytanie i klient już zapisane — przy ponownej próbie oferta trafia do nich (bez drugiego zapytania i klienta).
    if (typeof saved?.inquiryId === 'string') {
      return nativeJson({
        error: errorText(error, fallback),
        inquiryId: saved.inquiryId,
        organizationId: typeof saved.organizationId === 'string' ? saved.organizationId : null,
        contactId: typeof saved.contactId === 'string' ? saved.contactId : null,
      }, status);
    }
    return failure(errorText(error, fallback), status);
  }
}
