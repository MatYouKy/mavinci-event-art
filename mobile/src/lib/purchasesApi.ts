import { supabase } from './supabase';
import {
  PURCHASE_MAX_FILE_BYTES, PURCHASE_MAX_PAGE_BYTES, PURCHASE_MAX_PAGES,
  type PurchaseDocument, type PurchaseEventCosts, type PurchaseEventOption, type PurchaseMonth, type PurchaseReviewRow, type PurchaseState,
  type PurchaseUpload,
} from './purchaseShared';

/*
 * Zakupy → „Moje wydatki” w telefonie (`docs/purchases.md`) — te same operacje co CRM i Mac przez serwer CRM
 * (`/bridge/native/v1/purchases`, `src/lib/purchases/purchaseRoute.server.ts`), tokenem pracownika; dostęp sprawdzają funkcje
 * bazy `purchase_*`. Zdjęcia paragonu (strony) i PDF idą multipartem — serwer zapisuje plik (kilka zdjęć składa w PDF)
 * i odczytuje dokument przez AI.
 */

const CRM_URL = (process.env.EXPO_PUBLIC_CRM_URL || 'https://mavinci.pl').replace(/\/+$/, '');
const ENDPOINT = `${CRM_URL}/bridge/native/v1/purchases`;

/** Zdjęcie z aparatu / galerii albo plik z „Plików” (strona dokumentu zakupu). */
export type PurchaseAsset = { uri: string; name: string; mimeType: string; size: number };

async function headers(json: boolean): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Zaloguj się ponownie.');
  return {
    Authorization: `Bearer ${session.access_token}`, 'x-mavinci-client': 'phone', Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || `Operacja nie powiodła się (HTTP ${response.status}).`);
  return body as T;
}

async function purchasesGet<T>(op: string, params: Record<string, string> = {}): Promise<T> {
  const query = Object.entries({ op, ...params }).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?${query}`, { headers: await headers(false) });
  } catch {
    throw new Error('Brak połączenia z serwerem CRM. Spróbuj ponownie.');
  }
  return parse<T>(response);
}

async function purchasesPost<T>(body: Record<string, unknown>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify(body) });
  } catch {
    throw new Error('Brak połączenia z serwerem CRM. Spróbuj ponownie.');
  }
  return parse<T>(response);
}

/** Stan ekranu: prawa, miesiąc (własny albo pracownika — dla zatwierdzającego) i kategorie. */
export const loadPurchaseState = (year: number, month: number, employee?: string | null) =>
  purchasesGet<PurchaseState>('state', { year: String(year), month: String(month), ...(employee ? { employee } : {}) });

/** „Rozliczenia pracowników” (zatwierdzający). */
export const loadPurchaseReview = async () => (await purchasesGet<{ rows: PurchaseReviewRow[] }>('review')).rows;

/** Eventy do przypisania zakupu (najbliższe dziś albo wyszukane po nazwie). */
export const searchPurchaseEvents = async (company: string, query: string) =>
  (await purchasesGet<{ events: PurchaseEventOption[] }>('events', { company, ...(query ? { q: query } : {}) })).events;

/** Wszystkie koszty eventu i ich suma. */
export const loadPurchaseEventCosts = (event: string) => purchasesGet<PurchaseEventCosts>('costs', { event });

/** Plik dokumentu — podpisany adres na 10 minut. */
export const purchaseFileUrl = (id: string) => purchasesGet<{ url: string; mime: string }>('file', { id });

/**
 * Plik dokumentu: jedno zdjęcie / PDF albo kilka zdjęć stron (JPG, PNG) — serwer składa PDF, zapisuje go i odczytuje AI.
 * React Native wysyła pliki z dysku po adresie (`uri`), bez wczytywania ich do pamięci.
 */
export async function uploadPurchaseFiles(company: string, files: PurchaseAsset[]): Promise<PurchaseUpload> {
  if (!files.length) throw new Error('Dodaj zdjęcie albo plik dokumentu.');
  if (files.length > PURCHASE_MAX_PAGES) throw new Error(`Dokument może mieć najwyżej ${PURCHASE_MAX_PAGES} stron (zdjęć).`);
  if (files.length > 1 && files.some((file) => file.mimeType !== 'image/jpeg' && file.mimeType !== 'image/png')) {
    throw new Error('Kilka stron dodaje się jako zdjęcia JPG albo PNG (PDF — jako jeden plik).');
  }
  const limit = files.length > 1 ? PURCHASE_MAX_PAGE_BYTES : PURCHASE_MAX_FILE_BYTES;
  const tooBig = files.find((file) => file.size > limit);
  if (tooBig) throw new Error(`Plik „${tooBig.name}” jest za duży — najwyżej ${files.length > 1 ? 15 : 10} MB.`);
  const form = new FormData();
  form.append('company', company);
  for (const file of files) {
    form.append('files', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  }
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?op=upload`, { method: 'POST', headers: await headers(false), body: form });
  } catch {
    throw new Error('Nie udało się wysłać zdjęcia. Sprawdź połączenie i spróbuj ponownie.');
  }
  return parse<PurchaseUpload>(response);
}

/** Plik wysłany, ale zakup niezapisany — serwer usuwa go, jeśli nie należy do żadnego dokumentu. */
export const discardPurchaseFile = (path: string) => purchasesPost<{ ok: boolean }>({ op: 'discard', path }).catch(() => undefined);

/** Zapis zakupu (nowy albo poprawka) — dokument po zapisie. */
export const savePurchase = async (id: string | null, data: Record<string, unknown>) =>
  (await purchasesPost<{ document: PurchaseDocument }>({ op: 'save', id, data })).document;

export const deletePurchase = (id: string) => purchasesPost<{ ok: boolean }>({ op: 'delete', id });

/** „Wyślij rozliczenie” miesiąca działalności — miesiąc po zmianie. */
export const submitPurchaseMonth = (companyId: string, year: number, month: number, note: string) =>
  purchasesPost<PurchaseMonth>({ op: 'submit', companyId, year, month, note: note.trim() || null });

/** „Zatwierdź” / „Zwróć do poprawy” / „Cofnij zatwierdzenie” — miesiąc pracownika po zmianie. */
export const decidePurchaseMonth = (settlementId: string, approve: boolean, note: string) =>
  purchasesPost<PurchaseMonth>({ op: 'decide', settlementId, approve, note: note.trim() || null });
