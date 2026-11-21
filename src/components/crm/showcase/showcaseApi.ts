import { supabase } from '@/lib/supabase/browser';
import { OFFER_PDF_STEPS } from '@/lib/offer-pdf/progress';
import { readOfferPdfResult } from '@/lib/offer-pdf/readProgress';
import type { ShowcaseItemDetail, ShowcaseMedia, ShowcaseSectionView, ShowcaseUrls } from '@/lib/showcase/showcaseShared';

/*
 * Klient API „Prezentacji” (Strefa sprzedawcy) w CRM — to samo API co Mac i iPad (`/bridge/native/v1/showcase`, token sesji
 * pracownika, `x-mavinci-client: web`). Zdjęcia z dysku idą na serwer (wersje WebP powstają na serwerze Next).
 */

export type ShowcasePhotoSource = 'product' | 'site' | 'material' | 'event' | 'social';
export type ShowcaseProductOption = { id: string; name: string; category: string; priceNet: number | null; unit: string; thumbnailUrl: string | null };
export type ShowcaseRealizationOption = { id: string; title: string; location: string; date: string | null; photos: number; thumbnailUrl: string | null };
export type ShowcaseEventOption = { id: string; name: string; date: string | null };
export type ShowcasePhotoResult = { photo: ShowcaseMedia; urls: ShowcaseUrls };
export type { ShowcaseItemDetail, ShowcaseSectionView };

const ENDPOINT = '/bridge/native/v1/showcase';

async function headers(json: boolean) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Sesja wygasła. Zaloguj się ponownie.'), { status: 401 });
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  // Oferta ze spotkania: zapytanie i klient już zapisane (`inquiryId`, `organizationId`, `contactId`) — ponowna próba dopina do nich ofertę.
  if (!response.ok) {
    throw Object.assign(new Error(body?.error || 'Operacja nie powiodła się.'), {
      status: response.status,
      inquiryId: typeof body?.inquiryId === 'string' ? body.inquiryId : undefined,
      organizationId: typeof body?.organizationId === 'string' ? body.organizationId : undefined,
      contactId: typeof body?.contactId === 'string' ? body.contactId : undefined,
    });
  }
  return body as T;
}

export async function showcaseGet<T>(op: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> {
  const query = new URLSearchParams({ op });
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  return parse<T>(await fetch(`${ENDPOINT}?${query.toString()}`, { headers: await headers(false), cache: 'no-store' }));
}

export async function showcasePost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  return parse<T>(await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) }));
}

/** Zdjęcie z dysku → wersje WebP (serwer) → zdjęcie do dodania w edytorze karty albo okładka działu. */
export async function showcaseUploadPhoto(target: { itemId?: string; sectionId?: string }, file: File): Promise<ShowcasePhotoResult> {
  const query = new URLSearchParams({ op: 'upload' });
  if (target.itemId) query.set('item', target.itemId);
  if (target.sectionId) query.set('section', target.sectionId);
  const response = await fetch(`${ENDPOINT}?${query.toString()}`, {
    method: 'POST', headers: { ...(await headers(false)), 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  });
  return parse<ShowcasePhotoResult>(response);
}

/** PDF oferty jak „Generuj PDF” w CRM (`/bridge/offers/generate-pdf`, postęp krok po kroku w NDJSON). */
export async function showcaseOfferGeneratePdf(offerId: string, onProgress: (label: string) => void): Promise<{ pageCount: number }> {
  const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(300_000) : undefined;
  const response = await fetch('/bridge/offers/generate-pdf', {
    method: 'POST',
    headers: { ...(await headers(true)), Accept: 'application/x-ndjson' },
    body: JSON.stringify({ offerId, language: 'pl' }),
    signal: timeout,
  });
  const result = await readOfferPdfResult(response, (progress) => {
    onProgress(progress.detail || OFFER_PDF_STEPS.find((step) => step.id === progress.step)?.label || 'Generuję PDF…');
  });
  if (!response.ok || !result?.success) {
    const limit = response.status === 546 || ['WORKER_RESOURCE_LIMIT', 'WORKER_LIMIT'].includes(result?.code);
    throw Object.assign(new Error(limit
      ? 'Generator PDF chwilowo przekroczył limit zasobów. Spróbuj ponownie za chwilę.'
      : result?.error || result?.message || 'Nie udało się wygenerować PDF.'), { status: result?.httpStatus || response.status });
  }
  return { pageCount: Number(result.pageCount) || 0 };
}

export const errorMessage = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);
