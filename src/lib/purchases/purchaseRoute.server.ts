import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PurchaseError,
  purchaseDecide,
  purchaseDelete,
  purchaseDiscard,
  purchaseEventCosts,
  purchaseEvents,
  purchaseFileUrl,
  purchaseReview,
  purchaseSave,
  purchaseState,
  purchaseSubmit,
  purchaseUpload,
  type PurchaseFileInput,
} from './purchases.server';
import { PURCHASE_MAX_PAGES, PURCHASE_MAX_PAGE_BYTES } from './purchaseShared';

/*
 * Wspólna obsługa tras Zakupów: `/bridge/purchases` (CRM — sesja z ciasteczek albo Bearer) i `/bridge/native/v1/purchases`
 * (Mac, telefon). GET `op=state&year=&month=[&employee=]` | `review` | `events&company=&q=` | `costs&event=` |
 * `file&id=[&download=1]`. POST JSON `op=save {id?, data}` | `delete {id}` | `submit {companyId, year, month, note}` |
 * `decide {settlementId, approve, note}` | `discard {path}` | `upload {company, files: [{name, mime, data (base64)}]}`;
 * POST multipart `op=upload` (pola `company` i `files` — jeden PDF / zdjęcie albo kilka zdjęć stron).
 */

type Row = Record<string, unknown>;
const JSON_LIMIT = Math.ceil((PURCHASE_MAX_PAGES * PURCHASE_MAX_PAGE_BYTES * 4) / 3) + 64_000;

export async function purchasesGet(client: SupabaseClient, params: URLSearchParams) {
  switch (params.get('op') || 'state') {
    case 'state':
      return purchaseState(client, { year: params.get('year'), month: params.get('month'), employee: params.get('employee') });
    case 'review':
      return { rows: await purchaseReview(client) };
    case 'events':
      return { events: await purchaseEvents(client, params.get('company'), params.get('q')) };
    case 'costs':
      return purchaseEventCosts(client, params.get('event'));
    case 'file':
      return purchaseFileUrl(client, params.get('id'), params.get('download') === '1');
    default:
      throw new PurchaseError('Nieznana operacja.');
  }
}

function base64Files(value: unknown): PurchaseFileInput[] {
  if (!Array.isArray(value)) throw new PurchaseError('Dodaj zdjęcie albo plik dokumentu.');
  return value.map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Row;
    const data = typeof row.data === 'string' ? row.data.replace(/^data:[^,]*,/, '') : '';
    if (!data) throw new PurchaseError('Pusty plik dokumentu.');
    return {
      bytes: new Uint8Array(Buffer.from(data, 'base64')),
      name: typeof row.name === 'string' ? row.name.slice(0, 200) : 'dokument',
      mime: typeof row.mime === 'string' ? row.mime.slice(0, 100) : '',
    };
  });
}

export async function purchasesPost(client: SupabaseClient, request: Request) {
  const params = new URL(request.url).searchParams;
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('multipart/form-data')) {
    if ((params.get('op') || '') !== 'upload') throw new PurchaseError('Nieznana operacja.');
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new PurchaseError('Nie udało się odczytać przesłanych plików. Dodaj je ponownie.');
    }
    const files: PurchaseFileInput[] = [];
    for (const entry of form.getAll('files')) {
      if (!(entry instanceof File)) continue;
      if (entry.size > PURCHASE_MAX_PAGE_BYTES) throw new PurchaseError('Plik jest za duży — najwyżej 15 MB na stronę (PDF do 10 MB).', 413);
      files.push({ bytes: new Uint8Array(await entry.arrayBuffer()), name: entry.name, mime: entry.type });
    }
    return purchaseUpload(client, form.get('company'), files);
  }
  const text = await request.text();
  if (text.length > JSON_LIMIT) throw new PurchaseError('Za duże dane — dodaj mniej stron albo mniejsze zdjęcia.', 413);
  let body: Row;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new PurchaseError('Nieprawidłowe dane.');
  }
  switch (String(body.op || params.get('op') || '')) {
    case 'upload':
      return purchaseUpload(client, body.company, base64Files(body.files));
    case 'discard':
      return purchaseDiscard(client, body.path);
    case 'save':
      return purchaseSave(client, body.id, body.data);
    case 'delete':
      return purchaseDelete(client, body.id);
    case 'submit':
      return purchaseSubmit(client, body);
    case 'decide':
      return purchaseDecide(client, body);
    default:
      throw new PurchaseError('Nieznana operacja.');
  }
}

/** Błąd do odpowiedzi: komunikat dla użytkownika i status (nieznany błąd — ogólny komunikat, szczegóły w logu). */
export function purchaseFailure(error: unknown, fallback: string): { message: string; status: number } {
  if (error instanceof PurchaseError) return { message: error.message, status: error.status };
  console.error('[purchases]', error instanceof Error ? error.message : error);
  return { message: fallback, status: 500 };
}
