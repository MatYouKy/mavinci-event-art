import 'server-only';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { scanPdf } from '@/lib/drive/drive.server';
import { PurchaseScanError, readPurchaseDocument } from './purchaseScan.server';
import {
  PURCHASE_MAX_FILE_BYTES,
  PURCHASE_MAX_PAGE_BYTES,
  PURCHASE_MAX_PAGES,
  type PurchaseAccess,
  type PurchaseCategories,
  type PurchaseDocument,
  type PurchaseEventCosts,
  type PurchaseEventOption,
  type PurchaseMonth,
  type PurchaseReading,
  type PurchaseReviewRow,
  type PurchaseState,
  type PurchaseUpload,
} from './purchaseShared';

/*
 * Zakupy → „Moje wydatki” (`docs/purchases.md`) po stronie serwera CRM — wspólne dla CRM (`/bridge/purchases`, sesja
 * z ciasteczek) i aplikacji (`/bridge/native/v1/purchases`, token pracownika). Dane i uprawnienia — funkcje bazy `purchase_*`
 * wywoływane klientem pracownika (RLS, SECURITY DEFINER z kontrolą dostępu). Pliki dokumentów zapisuje i podpisuje konto
 * serwisowe, ale zawsze po sprawdzeniu prawa w bazie: `purchase_can_record` (wysyłka, odczyt AI), `purchase_document_file`
 * (podgląd), `purchase_save` / `purchase_delete` (plik zastąpiony albo usuniętego dokumentu). Ścieżka pliku:
 * `external-invoices/purchases/<pracownik>/<uuid>.<pdf|jpg|png|webp>` — jak inne dokumenty spoza KSeF, więc Finanse widzą
 * plik dokumentu tak samo jak dodany w CRM.
 */

export class PurchaseError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Client = SupabaseClient;
export type PurchaseFileInput = { bytes: Uint8Array; name: string; mime: string };

const BUCKET = 'external-invoices';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING = 'Zakupy będą dostępne po wdrożeniu migracji bazy 20261130180000 (employee_purchases).';
const AI_LIMIT = 10 * 1024 * 1024;
const SIGNED_SECONDS = 600;

function fail(message: string, status = 400): never {
  throw new PurchaseError(message, status);
}

/** Błąd funkcji bazy po polsku (komunikaty funkcji `purchase_*` są już dla użytkownika). */
function dbError(error: { message?: string; code?: string } | null, fallback: string): never {
  const code = error?.code || '';
  if (code === 'PGRST202' || code === '42883') fail(PENDING, 503);
  const message = String(error?.message || '').trim();
  const status = code === '42501' ? 403 : code === 'P0002' ? 404 : 400;
  fail(message && !/^(permission denied|JWT|new row violates)/i.test(message) ? message : fallback, status);
}

async function rpc<T>(client: Client, name: string, args: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) dbError(error, fallback);
  return data as T;
}

const uuid = (value: unknown, label: string) => (typeof value === 'string' && UUID.test(value) ? value : fail(`Nieprawidłowy identyfikator: ${label}.`));
const intIn = (value: unknown, min: number, max: number, label: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fail(`Nieprawidłowy ${label}.`);
};

export const purchaseAccess = (client: Client) => rpc<PurchaseAccess>(client, 'purchases_access', {}, 'Nie udało się sprawdzić uprawnień.');

/** Stan ekranu: prawa, miesiąc (własny albo pracownika — dla zatwierdzającego) i kategorie. */
export async function purchaseState(client: Client, params: { year: unknown; month: unknown; employee?: unknown }): Promise<PurchaseState> {
  const year = intIn(params.year, 2000, 2100, 'rok');
  const month = intIn(params.month, 1, 12, 'miesiąc');
  const employee = params.employee ? uuid(params.employee, 'pracownik') : null;
  const [access, categories] = await Promise.all([
    purchaseAccess(client),
    rpc<PurchaseCategories>(client, 'purchase_categories', {}, 'Nie udało się wczytać kategorii.'),
  ]);
  if (!access.employee_id) fail('Zaloguj się kontem pracownika CRM.', 403);
  const self = !employee || employee === access.employee_id;
  if (self && !access.record) {
    // Sam zatwierdzający (bez własnych zakupów) widzi tylko rozliczenia pracowników.
    if (!access.approve) fail('Brak uprawnienia „Zakupy — własne wydatki”. Nada je administrator w uprawnieniach pracownika.', 403);
    return { access, month: null, categories: categories || { finance: [], event: [] } };
  }
  const data = await rpc<PurchaseMonth>(client, 'purchase_month', { p_year: year, p_month: month, p_employee: self ? null : employee },
    'Nie udało się wczytać zakupów.');
  return { access, month: data, categories: categories || { finance: [], event: [] } };
}

export const purchaseReview = (client: Client) =>
  rpc<PurchaseReviewRow[]>(client, 'purchase_review', {}, 'Nie udało się wczytać rozliczeń.');

export const purchaseEvents = (client: Client, company: unknown, search: unknown) =>
  rpc<PurchaseEventOption[]>(client, 'purchase_event_options', {
    p_company: uuid(company, 'działalność'),
    p_search: typeof search === 'string' && search.trim() ? search.trim().slice(0, 100) : null,
  }, 'Nie udało się wczytać eventów.');

export const purchaseEventCosts = (client: Client, event: unknown) =>
  rpc<PurchaseEventCosts>(client, 'purchase_event_costs', { p_event: uuid(event, 'event') }, 'Nie udało się wczytać kosztów eventu.');

/** Podpisany adres pliku dokumentu (10 minut); `download` — pobranie zamiast podglądu. */
export async function purchaseFileUrl(client: Client, id: unknown, download = false) {
  const path = await rpc<string | null>(client, 'purchase_document_file', { p_id: uuid(id, 'dokument') }, 'Nie udało się otworzyć pliku.');
  if (!path) fail('Ten dokument nie ma jeszcze pliku.', 404);
  const extension = path.split('.').pop() || 'pdf';
  const { data, error } = await createSupabaseAdminClient().storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_SECONDS, download ? { download: `dokument-zakupu.${extension}` } : undefined);
  if (error || !data?.signedUrl) fail('Nie udało się otworzyć pliku dokumentu.', 500);
  return { url: data.signedUrl, mime: mimeOfExtension(extension) };
}

function mimeOfExtension(extension: string) {
  switch (extension.toLowerCase()) {
    case 'pdf': return 'application/pdf';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    default: return 'image/jpeg';
  }
}

/** Typ pliku z treści (nie z nazwy ani nagłówka klienta). */
function sniff(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return { mime: 'application/pdf', extension: 'pdf' };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: 'image/png', extension: 'png' };
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
}

/**
 * Plik dokumentu zakupu: jeden PDF albo zdjęcie (do 10 MB) albo kilka zdjęć stron JPG / PNG (do 10, każde do 15 MB) —
 * z nich PDF. Zapis w magazynie, potem odczyt AI (błąd odczytu nie przerywa — pola uzupełnia się ręcznie).
 */
export async function purchaseUpload(client: Client, companyId: unknown, files: PurchaseFileInput[]): Promise<PurchaseUpload> {
  const company = uuid(companyId, 'działalność');
  if (!files.length) fail('Dodaj zdjęcie albo plik dokumentu.');
  if (files.length > PURCHASE_MAX_PAGES) fail(`Dokument może mieć najwyżej ${PURCHASE_MAX_PAGES} stron (zdjęć).`);
  const [access, allowed] = await Promise.all([
    purchaseAccess(client),
    rpc<boolean>(client, 'purchase_can_record', { p_company: company }, 'Nie udało się sprawdzić uprawnień.'),
  ]);
  if (!allowed || !access.employee_id) fail('Nie możesz wprowadzać zakupów tej działalności.', 403);
  const kinds = files.map((file) => sniff(file.bytes));
  let content: Uint8Array;
  let type: { mime: string; extension: string };
  if (files.length === 1) {
    const kind = kinds[0];
    if (!kind) fail('Obsługiwane są pliki PDF i zdjęcia JPG, PNG albo WebP.', 415);
    if (files[0].bytes.length > PURCHASE_MAX_FILE_BYTES) fail('Plik jest za duży — najwyżej 10 MB.', 413);
    content = files[0].bytes;
    type = kind!;
  } else {
    if (kinds.some((kind) => !kind || (kind.mime !== 'image/jpeg' && kind.mime !== 'image/png'))) {
      fail('Kilka stron dodaje się jako zdjęcia JPG albo PNG (PDF — jako jeden plik).', 415);
    }
    if (files.some((file) => !file.bytes.length || file.bytes.length > PURCHASE_MAX_PAGE_BYTES)) fail('Zdjęcie strony jest puste albo za duże (do 15 MB).', 413);
    content = await scanPdf(files.map((file) => file.bytes));
    type = { mime: 'application/pdf', extension: 'pdf' };
  }
  const admin = createSupabaseAdminClient();
  const path = `purchases/${access.employee_id}/${randomUUID()}.${type.extension}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, Buffer.from(content), { contentType: type.mime, upsert: false });
  if (error) fail('Nie udało się zapisać pliku dokumentu. Spróbuj ponownie.', 500);

  let reading: PurchaseReading | null = null;
  let readingError: string | null = null;
  const aiBytes = content.length <= AI_LIMIT ? content : files[0].bytes;
  const aiMime = content.length <= AI_LIMIT ? type.mime : (kinds[0]?.mime || 'image/jpeg');
  if (aiBytes.length > AI_LIMIT) {
    readingError = 'Plik jest za duży do odczytu AI — uzupełnij dane ręcznie.';
  } else {
    try {
      const { data: row } = await admin.from('my_companies').select('nip').eq('id', company).maybeSingle();
      reading = await readPurchaseDocument(aiBytes, aiMime, (row as { nip?: string | null } | null)?.nip || null);
    } catch (failure) {
      readingError = failure instanceof PurchaseScanError ? failure.message : 'Nie udało się odczytać dokumentu — uzupełnij dane ręcznie.';
      if (!(failure instanceof PurchaseScanError)) console.error('[purchases] reading', failure instanceof Error ? failure.message : 'error');
    }
  }
  return { file: { path, mime: type.mime, size: content.length, pages: files.length }, reading, readingError };
}

/** Plik wysłany, ale dokument nie został zapisany (okno zamknięte) — usunięcie, jeśli to własny plik bez dokumentu. */
export async function purchaseDiscard(client: Client, path: unknown) {
  const access = await purchaseAccess(client);
  if (typeof path !== 'string' || !access.employee_id
      || !new RegExp(`^purchases/${access.employee_id}/[0-9a-f-]{36}\\.(pdf|jpg|jpeg|png|webp)$`).test(path)) {
    return { ok: true };
  }
  const admin = createSupabaseAdminClient();
  const { count } = await admin.from('external_invoices').select('id', { count: 'exact', head: true }).eq('file_url', path);
  if ((count ?? 0) === 0) await admin.storage.from(BUCKET).remove([path]);
  return { ok: true };
}

/** Zapis zakupu (nowy albo poprawka); plik zastąpiony nowym znika z magazynu. */
export async function purchaseSave(client: Client, id: unknown, data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Brak danych zakupu.');
  const result = await rpc<{ document: PurchaseDocument; replaced_file: string | null }>(client, 'purchase_save', {
    p_id: id ? uuid(id, 'dokument') : null,
    p_data: data,
  }, 'Nie udało się zapisać zakupu.');
  if (result?.replaced_file && result.replaced_file.startsWith('purchases/')) {
    const { error } = await createSupabaseAdminClient().storage.from(BUCKET).remove([result.replaced_file]);
    if (error) console.error('[purchases] replaced file', error.message);
  }
  return { document: result.document };
}

export async function purchaseDelete(client: Client, id: unknown) {
  const path = await rpc<string | null>(client, 'purchase_delete', { p_id: uuid(id, 'dokument') }, 'Nie udało się usunąć zakupu.');
  if (path && path.startsWith('purchases/')) {
    const { error } = await createSupabaseAdminClient().storage.from(BUCKET).remove([path]);
    if (error) console.error('[purchases] deleted file', error.message);
  }
  return { ok: true };
}

export const purchaseSubmit = (client: Client, body: Record<string, unknown>) =>
  rpc<PurchaseMonth>(client, 'purchase_submit', {
    p_company: uuid(body.companyId, 'działalność'),
    p_year: intIn(body.year, 2000, 2100, 'rok'),
    p_month: intIn(body.month, 1, 12, 'miesiąc'),
    p_note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null,
  }, 'Nie udało się wysłać rozliczenia.');

export const purchaseDecide = (client: Client, body: Record<string, unknown>) =>
  rpc<PurchaseMonth>(client, 'purchase_decide', {
    p_settlement: uuid(body.settlementId, 'rozliczenie'),
    p_approve: body.approve === true,
    p_note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null,
  }, 'Nie udało się zapisać decyzji.');
